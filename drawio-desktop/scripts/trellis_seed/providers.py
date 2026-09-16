from __future__ import annotations

import json
import random
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError, URLError
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

    def geocode(self, name: str, qualifiers: dict[str, Any] | None = None) -> tuple[dict[str, Any], ProviderTrace]:
        query, qualifier_tokens = self._split_location_query(name)
        qualifier_tokens.update(self._explicit_qualifiers(qualifiers or {}))
        attempts = [query]
        display_name = str(qualifiers.get("display_name") or name) if qualifiers else name
        if query != display_name:
            attempts.append(display_name)
        if query != name and name not in attempts:
            attempts.append(name)
        traces: list[dict[str, Any]] = []
        for attempt in attempts:
            url = self._url(self.config["geocoding_url"], {"name": attempt, "count": 10, "language": "en", "format": "json"})
            data = self._get_json(url)
            traces.append({"url": url, "result_count": len(data.get("results") or [])})
            match = self._best_geocode_match(data.get("results") or [], qualifier_tokens)
            if match:
                return match, ProviderTrace("open-meteo", {"input": name, "qualifiers": qualifiers or {}, "attempts": traces}, data)
        raise ProviderError(f"Open-Meteo did not verify location '{display_name}'. Try a city name plus country, such as 'Vancouver, Canada'.")

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

    def _get_json(self, url: str) -> dict[str, Any]:
        last_error: Exception | None = None
        max_attempts = int(self.config.get("rate_limit_max_attempts", 8))
        for attempt in range(1, max_attempts + 1):
            try:
                with urllib.request.urlopen(url, timeout=30) as response:
                    return json.loads(response.read().decode("utf-8"))
            except HTTPError as exc:
                last_error = exc
                if exc.code != 429 or attempt == max_attempts:
                    break
                wait_seconds = self._rate_limit_wait_seconds(exc, attempt)
                print(f"Open-Meteo rate limited; waiting {wait_seconds:.0f}s before retry {attempt + 1}/{max_attempts}", flush=True)
                time.sleep(wait_seconds)
            except (ConnectionResetError, TimeoutError, URLError) as exc:
                last_error = exc
                if attempt == max_attempts:
                    break
                time.sleep(attempt * 2)
        raise ProviderError(f"Open-Meteo request failed after {max_attempts} attempts: {last_error}") from last_error

    def _rate_limit_wait_seconds(self, exc: HTTPError, attempt: int) -> float:
        max_wait = float(self.config.get("rate_limit_max_wait_seconds", 900))
        retry_after = exc.headers.get("Retry-After") if exc.headers else None
        if retry_after:
            try:
                return min(float(retry_after), max_wait)
            except ValueError:
                pass
        base = float(self.config.get("rate_limit_base_wait_seconds", 60))
        wait = base * (2 ** max(0, attempt - 1))
        jitter = random.uniform(0, min(5.0, base))
        return min(wait + jitter, max_wait)

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
    def _explicit_qualifiers(qualifiers: dict[str, Any]) -> set[str]:
        tokens: set[str] = set()
        for key in ("admin1", "country", "country_code"):
            value = str(qualifiers.get(key) or "").strip()
            if not value:
                continue
            token = _normalize_location_token(value)
            tokens.add(token)
            tokens.update(PROVINCE_ALIASES.get(token, set()))
        return tokens

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
    "ab": {"alberta", "ca", "canada"},  # Canadian city suggestions
    "alberta": {"ab", "ca", "canada"},
    "sk": {"saskatchewan", "ca", "canada"},
    "saskatchewan": {"sk", "ca", "canada"},
    "mb": {"manitoba", "ca", "canada"},
    "manitoba": {"mb", "ca", "canada"},
    "on": {"ontario", "ca", "canada"},
    "ontario": {"on", "ca", "canada"},
    "qc": {"quebec", "québec", "ca", "canada"},
    "quebec": {"qc", "québec", "ca", "canada"},
    "québec": {"qc", "quebec", "ca", "canada"},
    "nb": {"new brunswick", "ca", "canada"},
    "new brunswick": {"nb", "ca", "canada"},
    "ns": {"nova scotia", "ca", "canada"},
    "nova scotia": {"ns", "ca", "canada"},
    "pe": {"prince edward island", "pei", "ca", "canada"},
    "pei": {"prince edward island", "pe", "ca", "canada"},
    "prince edward island": {"pe", "pei", "ca", "canada"},
    "nl": {"newfoundland and labrador", "ca", "canada"},
    "newfoundland and labrador": {"nl", "ca", "canada"},
    "yt": {"yukon", "ca", "canada"},
    "yukon": {"yt", "ca", "canada"},
    "nt": {"northwest territories", "ca", "canada"},
    "northwest territories": {"nt", "ca", "canada"},
    "nu": {"nunavut", "ca", "canada"},
    "nunavut": {"nu", "ca", "canada"},
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


class NasaPowerClient:
    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config

    def preflight(self) -> ProviderTrace:
        data, trace = self.monthly_history(latitude=49.2827, longitude=-123.1207, start_year=2025, end_year=2025)
        trace.request["action"] = "monthly history preflight"
        trace.response = {"ok": bool((data.get("properties") or {}).get("parameter"))}
        return trace

    def monthly_history(self, *, latitude: float, longitude: float, start_year: int, end_year: int) -> tuple[dict[str, Any], ProviderTrace]:
        params = {
            "parameters": self.config.get("parameters", "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR"),
            "community": self.config.get("community", "AG"),
            "longitude": longitude,
            "latitude": latitude,
            "format": "JSON",
            "start": int(start_year),
            "end": int(end_year),
        }
        url = OpenMeteoClient._url(str(self.config["monthly_url"]), params)
        data = self._get_json(url)
        parameter = (data.get("properties") or {}).get("parameter") or {}
        return data, ProviderTrace("nasa-power", {"url": url}, {"parameter_keys": sorted(parameter.keys())})

    def _get_json(self, url: str) -> dict[str, Any]:
        last_error: Exception | None = None
        max_attempts = int(self.config.get("rate_limit_max_attempts", 8))
        for attempt in range(1, max_attempts + 1):
            try:
                with urllib.request.urlopen(url, timeout=60) as response:
                    return json.loads(response.read().decode("utf-8"))
            except HTTPError as exc:
                last_error = exc
                if exc.code != 429 or attempt == max_attempts:
                    break
                wait_seconds = self._rate_limit_wait_seconds(exc, attempt)
                print(f"NASA POWER rate limited; waiting {wait_seconds:.0f}s before retry {attempt + 1}/{max_attempts}", flush=True)
                time.sleep(wait_seconds)
            except (ConnectionResetError, TimeoutError, URLError) as exc:
                last_error = exc
                if attempt == max_attempts:
                    break
                time.sleep(attempt * 2)
        raise ProviderError(f"NASA POWER request failed after {max_attempts} attempts: {last_error}") from last_error

    def _rate_limit_wait_seconds(self, exc: HTTPError, attempt: int) -> float:
        max_wait = float(self.config.get("rate_limit_max_wait_seconds", 900))
        retry_after = exc.headers.get("Retry-After") if exc.headers else None
        if retry_after:
            try:
                return min(float(retry_after), max_wait)
            except ValueError:
                pass
        base = float(self.config.get("rate_limit_base_wait_seconds", 60))
        wait = base * (2 ** max(0, attempt - 1))
        jitter = random.uniform(0, min(5.0, base))
        return min(wait + jitter, max_wait)


class FoodDataCentralClient:
    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config

    def search(self, query: str) -> tuple[dict[str, Any], ProviderTrace]:
        params = {
            "api_key": self.config.get("api_key") or "DEMO_KEY",
            "query": query,
            "dataType": self.config.get("data_types", "Foundation,SR Legacy,Survey (FNDDS)"),
            "pageSize": int(self.config.get("page_size", 10)),
        }
        url = OpenMeteoClient._url(str(self.config["search_url"]), params)
        data = self._get_json(url)
        foods = data.get("foods") or []
        return data, ProviderTrace("fdc", {"url": url, "query": query}, {"result_count": len(foods)})

    def food(self, fdc_id: int) -> tuple[dict[str, Any], ProviderTrace]:
        params = {"api_key": self.config.get("api_key") or "DEMO_KEY"}
        url = OpenMeteoClient._url(str(self.config["food_url"]).rstrip("/") + f"/{int(fdc_id)}", params)
        data = self._get_json(url)
        return data, ProviderTrace("fdc", {"url": url, "fdc_id": int(fdc_id)}, {"description": data.get("description"), "data_type": data.get("dataType")})

    def _get_json(self, url: str) -> dict[str, Any]:
        last_error: Exception | None = None
        max_attempts = int(self.config.get("rate_limit_max_attempts", 5))
        for attempt in range(1, max_attempts + 1):
            try:
                with urllib.request.urlopen(url, timeout=45) as response:
                    return json.loads(response.read().decode("utf-8"))
            except HTTPError as exc:
                last_error = exc
                if exc.code != 429 or attempt == max_attempts:
                    break
                wait_seconds = self._rate_limit_wait_seconds(exc, attempt)
                print(f"FoodData Central rate limited; waiting {wait_seconds:.0f}s before retry {attempt + 1}/{max_attempts}", flush=True)
                time.sleep(wait_seconds)
            except (ConnectionResetError, TimeoutError, URLError) as exc:
                last_error = exc
                if attempt == max_attempts:
                    break
                time.sleep(attempt * 2)
        raise ProviderError(f"FoodData Central request failed after {max_attempts} attempts: {last_error}") from last_error

    def _rate_limit_wait_seconds(self, exc: HTTPError, attempt: int) -> float:
        max_wait = float(self.config.get("rate_limit_max_wait_seconds", 300))
        retry_after = exc.headers.get("Retry-After") if exc.headers else None
        if retry_after:
            try:
                return min(float(retry_after), max_wait)
            except ValueError:
                pass
        base = float(self.config.get("rate_limit_base_wait_seconds", 30))
        wait = base * (2 ** max(0, attempt - 1))
        jitter = random.uniform(0, min(5.0, base))
        return min(wait + jitter, max_wait)
