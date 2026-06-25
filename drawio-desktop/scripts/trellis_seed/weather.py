from __future__ import annotations

import hashlib
from collections import defaultdict
from datetime import date, datetime, timezone
from statistics import mean
from typing import Any


def last_complete_year(today: date | None = None) -> int:
    today = today or date.today()
    return today.year - 1


def history_window(years: int, today: date | None = None) -> tuple[str, str, int, int]:
    end_year = last_complete_year(today)
    start_year = end_year - int(years) + 1
    return f"{start_year}-01-01", f"{end_year}-12-31", start_year, end_year


def summarize_city_weather(city_name: str, geocode: dict[str, Any], daily_payload: dict[str, Any], gdd_base_c: float) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    daily = daily_payload.get("daily") or {}
    times = daily.get("time") or []
    tmin = daily.get("temperature_2m_min") or []
    tmax = daily.get("temperature_2m_max") or []
    tmean = daily.get("temperature_2m_mean") or []
    precipitation = daily.get("precipitation_sum") or []
    rain = daily.get("rain_sum") or []
    snowfall = daily.get("snowfall_sum") or []
    timezone_name = str(daily_payload.get("timezone") or geocode.get("timezone") or "UTC")
    provider = "open-meteo"
    dataset = "open-meteo-archive"
    fetched_at = datetime.now(timezone.utc).isoformat()

    monthly_lows: dict[int, list[float]] = defaultdict(list)
    monthly_highs: dict[int, list[float]] = defaultdict(list)
    spring_frosts: dict[int, list[int]] = defaultdict(list)
    fall_frosts: dict[int, list[int]] = defaultdict(list)
    gdd_by_year: dict[int, float] = defaultdict(float)
    weather_rows: list[dict[str, Any]] = []

    for i, raw_day in enumerate(times):
        day = date.fromisoformat(raw_day)
        lo = _num_at(tmin, i)
        hi = _num_at(tmax, i)
        avg = _num_at(tmean, i)
        if avg is None and lo is not None and hi is not None:
            avg = (lo + hi) / 2
        gdd = max(0.0, (avg or 0.0) - gdd_base_c) if avg is not None else None
        if lo is not None:
            monthly_lows[day.month].append(lo)
        if hi is not None:
            monthly_highs[day.month].append(hi)
        if gdd is not None:
            gdd_by_year[day.year] += gdd
        if lo is not None and lo <= 0:
            if day.timetuple().tm_yday <= 182:
                spring_frosts[day.year].append(day.timetuple().tm_yday)
            else:
                fall_frosts[day.year].append(day.timetuple().tm_yday)
        weather_rows.append({
            "city_name": city_name,
            "weather_date": raw_day,
            "provider": provider,
            "dataset": dataset,
            "timezone": timezone_name,
            "temp_min_c": lo,
            "temp_max_c": hi,
            "temp_mean_c": avg,
            "precipitation_mm": _num_at(precipitation, i),
            "rain_mm": _num_at(rain, i),
            "snowfall_cm": _num_at(snowfall, i),
            "gdd_base_5c": gdd,
            "fetched_at": fetched_at,
            "source_url": "https://open-meteo.com/",
        })

    row: dict[str, Any] = {
        "city_name": city_name,
        "latitude": round(float(geocode["latitude"]), 4),
        "longitude": round(float(geocode["longitude"]), 4),
        "timezone": timezone_name,
        "gdd_annual": round(mean(gdd_by_year.values())) if gdd_by_year else None,
        "gdd_base_c": int(gdd_base_c),
    }
    for month in range(1, 13):
        row[f"avg_monthly_low_c{month}"] = round(mean(monthly_lows[month])) if monthly_lows[month] else None
        row[f"avg_monthly_high_c{month}"] = round(mean(monthly_highs[month])) if monthly_highs[month] else None

    spring_last = [max(values) for values in spring_frosts.values() if values]
    fall_first = [min(values) for values in fall_frosts.values() if values]
    row["last_spring_frost_doy"] = _percentile(spring_last, 0.5)
    row["last_spring_frost_p10_doy"] = _percentile(spring_last, 0.1)
    row["last_spring_frost_p50_doy"] = _percentile(spring_last, 0.5)
    row["last_spring_frost_p90_doy"] = _percentile(spring_last, 0.9)
    row["first_fall_frost_doy"] = _percentile(fall_first, 0.5)
    row["first_fall_frost_p10_doy"] = _percentile(fall_first, 0.1)
    row["first_fall_frost_p50_doy"] = _percentile(fall_first, 0.5)
    row["first_fall_frost_p90_doy"] = _percentile(fall_first, 0.9)
    provenance = {
        "provider": provider,
        "dataset": dataset,
        "row_count": len(weather_rows),
        "checksum": checksum_rows(weather_rows),
        "frost_definition": "daily minimum temperature <= 0C",
    }
    return row, weather_rows, provenance


def forecast_rows(city_name: str, payload: dict[str, Any], model: str) -> list[dict[str, Any]]:
    daily = payload.get("daily") or {}
    times = daily.get("time") or []
    run_timestamp = datetime.now(timezone.utc).isoformat()
    rows = []
    for i, raw_day in enumerate(times):
        rows.append({
            "city_name": city_name,
            "forecast_date": raw_day,
            "run_timestamp": run_timestamp,
            "provider": "open-meteo",
            "model": model,
            "timezone": payload.get("timezone"),
            "temp_min_c": _num_at(daily.get("temperature_2m_min") or [], i),
            "temp_max_c": _num_at(daily.get("temperature_2m_max") or [], i),
            "temp_mean_c": _num_at(daily.get("temperature_2m_mean") or [], i),
            "precipitation_mm": _num_at(daily.get("precipitation_sum") or [], i),
            "rain_mm": _num_at(daily.get("rain_sum") or [], i),
            "precipitation_probability_max": _num_at(daily.get("precipitation_probability_max") or [], i),
            "et0_fao_evapotranspiration_mm": _num_at(daily.get("et0_fao_evapotranspiration") or [], i),
            "source_url": "https://open-meteo.com/",
        })
    return rows


def checksum_rows(rows: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for row in rows:
        digest.update(repr(sorted(row.items())).encode("utf-8"))
    return digest.hexdigest()


def _num_at(values: list[Any], index: int) -> float | None:
    if index >= len(values) or values[index] is None:
        return None
    return float(values[index])


def _percentile(values: list[int], p: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * p
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return round(ordered[lower] * (1 - weight) + ordered[upper] * weight)

