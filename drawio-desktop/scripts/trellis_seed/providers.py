from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from .jsonio import redact_secrets


class ProviderError(RuntimeError):
    pass


@dataclass
class ProviderTrace:
    provider: str
    request: dict[str, Any]
    response: dict[str, Any] | None = None
    error: str | None = None

    def redacted(self) -> dict[str, Any]:
        return redact_secrets({
            "provider": self.provider,
            "request": self.request,
            "response": self.response,
            "error": self.error,
        })


class OpenAIJsonClient:
    def __init__(self, api_key: str, model: str, reasoning_effort: str = "high") -> None:
        self.api_key = api_key
        self.model = model
        self.reasoning_effort = reasoning_effort

    def preflight(self) -> ProviderTrace:
        if not self.api_key:
            raise ProviderError("OPENAI_API_KEY is missing. Set it as an environment variable.")
        result, trace = self.generate_json(
            system="Return only the requested JSON object.",
            user="Return {\"ok\": true} for a Trellis OpenAI preflight check.",
            schema_name="trellis_openai_preflight",
            json_schema={
                "type": "object",
                "additionalProperties": False,
                "required": ["ok"],
                "properties": {"ok": {"type": "boolean"}},
            },
        )
        if result.get("ok") is not True:
            raise ProviderError("OpenAI preflight returned an unexpected payload.")
        trace.request["action"] = "structured output preflight"
        return trace

    def generate_json(self, *, system: str, user: str, schema_name: str, json_schema: dict[str, Any]) -> tuple[dict[str, Any], ProviderTrace]:
        if not self.api_key:
            raise ProviderError("OPENAI_API_KEY is missing.")
        request = {"model": self.model, "reasoning_effort": self.reasoning_effort, "schema_name": schema_name, "system": system, "user": user}
        trace = ProviderTrace("openai", request)
        try:
            from openai import OpenAI  # type: ignore
        except Exception as exc:
            trace.error = str(exc)
            raise ProviderError("Python package 'openai' is required. Install requirements-trellis-seed.txt.") from exc

        client = OpenAI(api_key=self.api_key)
        try:
            try:
                response = client.responses.create(
                    model=self.model,
                    reasoning={"effort": self.reasoning_effort},
                    input=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    text={
                        "format": {
                            "type": "json_schema",
                            "name": schema_name,
                            "schema": json_schema,
                            "strict": True,
                        }
                    },
                )
                text = getattr(response, "output_text", "")
                if not text:
                    text = response.output[0].content[0].text  # type: ignore[attr-defined]
            except (AttributeError, TypeError) as compat_exc:
                if str(self.model).startswith("gpt-5"):
                    raise ProviderError(
                        "The installed OpenAI Python SDK could not make a Responses API structured-output call. "
                        "Upgrade it with: python -m pip install -U openai"
                    ) from compat_exc
                response = client.chat.completions.create(
                    model=self.model,
                    reasoning_effort=self.reasoning_effort,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    response_format={
                        "type": "json_schema",
                        "json_schema": {"name": schema_name, "schema": json_schema, "strict": True},
                    },
                )
                text = response.choices[0].message.content or "{}"
            parsed = json.loads(text)
            trace.response = {"json": parsed}
            return parsed, trace
        except Exception as exc:
            trace.error = str(exc)
            if "invalid model ID" in str(exc):
                raise ProviderError(
                    f"OpenAI model '{self.model}' was rejected by the API. "
                    "Set OPENAI_MODEL to a model ID available to your API key, for example 'gpt-5'."
                ) from exc
            raise ProviderError(f"OpenAI generation failed: {exc}") from exc


class OpenMeteoClient:
    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config

    def preflight(self) -> ProviderTrace:
        url = self._url(self.config["geocoding_url"], {"name": "Vancouver", "count": 1, "language": "en", "format": "json"})
        data = self._get_json(url)
        return ProviderTrace("open-meteo", {"url": url}, {"ok": bool(data)})

    def geocode(self, name: str) -> tuple[dict[str, Any], ProviderTrace]:
        query, qualifiers = self._split_location_query(name)
        attempts = [query]
        if query != name:
            attempts.append(name)
        traces: list[dict[str, Any]] = []
        for attempt in attempts:
            url = self._url(self.config["geocoding_url"], {"name": attempt, "count": 10, "language": "en", "format": "json"})
            data = self._get_json(url)
            traces.append({"url": url, "result_count": len(data.get("results") or [])})
            match = self._best_geocode_match(data.get("results") or [], qualifiers)
            if match:
                return match, ProviderTrace("open-meteo", {"input": name, "attempts": traces}, data)
        raise ProviderError(f"Open-Meteo did not find location '{name}'. Try a city name plus country, such as 'Vancouver, Canada'.")

    def historical_daily(self, *, latitude: float, longitude: float, timezone: str, start_date: str, end_date: str) -> tuple[dict[str, Any], ProviderTrace]:
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "start_date": start_date,
            "end_date": end_date,
            "daily": "temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,rain_sum,snowfall_sum",
            "timezone": timezone,
        }
        url = self._url(self.config["archive_url"], params)
        data = self._get_json(url)
        return data, ProviderTrace("open-meteo", {"url": url}, {"daily_keys": sorted((data.get("daily") or {}).keys())})

    def forecast_daily(self, *, latitude: float, longitude: float, timezone: str, forecast_days: int) -> tuple[dict[str, Any], ProviderTrace]:
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "forecast_days": forecast_days,
            "daily": "temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,rain_sum,precipitation_probability_max,et0_fao_evapotranspiration",
            "timezone": timezone,
        }
        url = self._url(self.config["forecast_url"], params)
        data = self._get_json(url)
        return data, ProviderTrace("open-meteo", {"url": url}, {"daily_keys": sorted((data.get("daily") or {}).keys())})

    @staticmethod
    def _url(base: str, params: dict[str, Any]) -> str:
        return base + "?" + urllib.parse.urlencode(params)

    @staticmethod
    def _get_json(url: str) -> dict[str, Any]:
        with urllib.request.urlopen(url, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))

    @staticmethod
    def _split_location_query(name: str) -> tuple[str, set[str]]:
        parts = [part.strip() for part in str(name or "").split(",") if part.strip()]
        if not parts:
            return "", set()
        qualifiers = {_normalize_location_token(part) for part in parts[1:]}
        expanded: set[str] = set()
        for token in qualifiers:
            expanded.add(token)
            expanded.update(PROVINCE_ALIASES.get(token, set()))
        return parts[0], expanded

    @staticmethod
    def _best_geocode_match(results: list[dict[str, Any]], qualifiers: set[str]) -> dict[str, Any] | None:
        if not results:
            return None
        if not qualifiers:
            return results[0]
        scored: list[tuple[int, dict[str, Any]]] = []
        for result in results:
            tokens = {
                _normalize_location_token(result.get(key))
                for key in ("admin1", "admin2", "admin3", "country", "country_code", "timezone")
                if result.get(key)
            }
            tokens |= set().union(*(PROVINCE_ALIASES.get(token, set()) for token in list(tokens)))
            score = len(tokens & qualifiers)
            scored.append((score, result))
        scored.sort(key=lambda item: item[0], reverse=True)
        return scored[0][1] if scored and scored[0][0] > 0 else None


PROVINCE_ALIASES = {
    "bc": {"british columbia", "ca", "canada"},
    "b c": {"british columbia", "ca", "canada"},
    "british columbia": {"bc", "ca", "canada"},
    "ca": {"canada"},
    "canada": {"ca"},
    "wa": {"washington", "us", "usa", "united states"},
    "or": {"oregon", "us", "usa", "united states"},
    "us": {"usa", "united states"},
    "usa": {"us", "united states"},
    "united states": {"us", "usa"},
}


def _normalize_location_token(value: Any) -> str:
    return " ".join(str(value or "").replace(".", " ").strip().casefold().split())
