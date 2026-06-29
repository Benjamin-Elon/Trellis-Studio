from __future__ import annotations

import hashlib
from collections import defaultdict
from datetime import date, datetime, timezone
import calendar
from statistics import mean
from typing import Any

REGION_CODE_BY_COUNTRY: dict[str, dict[str, str]] = {  # ADDED
    "CA": {  # ADDED
        "alberta": "AB", "british columbia": "BC", "manitoba": "MB", "new brunswick": "NB",  # ADDED
        "newfoundland and labrador": "NL", "nova scotia": "NS", "ontario": "ON",  # ADDED
        "prince edward island": "PE", "quebec": "QC", "saskatchewan": "SK",  # ADDED
        "northwest territories": "NT", "nunavut": "NU", "yukon": "YT",  # ADDED
    },  # ADDED
    "US": {  # ADDED
        "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO",  # ADDED
        "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",  # ADDED
        "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",  # ADDED
        "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",  # ADDED
        "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",  # ADDED
        "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",  # ADDED
        "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",  # ADDED
        "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX",  # ADDED
        "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",  # ADDED
        "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC",  # ADDED
    },  # ADDED
}  # ADDED


def _clean_text(value: Any) -> str:  # ADDED
    return str(value or "").strip()  # ADDED


def _region_code(country_code: str, region_name: str, explicit_code: Any = None) -> str:  # ADDED
    explicit = _clean_text(explicit_code).upper()  # ADDED
    if explicit:
        return explicit  # ADDED
    country = _clean_text(country_code).upper()  # ADDED
    return REGION_CODE_BY_COUNTRY.get(country, {}).get(_clean_text(region_name).lower(), "")  # ADDED


def city_geography_fields(geocode: dict[str, Any]) -> dict[str, str]:  # ADDED
    country_name = _clean_text(geocode.get("country_name") or geocode.get("country"))  # ADDED
    country_code = _clean_text(geocode.get("country_code")).upper()  # ADDED
    region_name = _clean_text(geocode.get("region_name") or geocode.get("admin1")) or "Unspecified"  # ADDED
    region_code = _region_code(country_code, region_name, geocode.get("region_code"))  # ADDED
    return {  # ADDED
        "country_name": country_name,  # ADDED
        "country_code": country_code,  # ADDED
        "region_name": region_name,  # ADDED
        "region_code": region_code,  # ADDED
    }  # ADDED


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
    geography = city_geography_fields(geocode)  # ADDED

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
            **geography,  # ADDED: resolver-only city identity metadata.
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
        **geography,  # CHANGED
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


def summarize_city_monthly_weather(
    city_name: str,
    geocode: dict[str, Any],
    monthly_payload: dict[str, Any],
    gdd_base_c: float,
    dataset: str = "nasa-power-monthly",
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    parameter = (monthly_payload.get("properties") or {}).get("parameter") or {}
    tmean = parameter.get("T2M") or {}
    tmax = parameter.get("T2M_MAX") or {}
    tmin = parameter.get("T2M_MIN") or {}
    precipitation = parameter.get("PRECTOTCORR") or {}
    timezone_name = str(geocode.get("timezone") or "UTC")
    provider = "nasa-power"
    fetched_at = datetime.now(timezone.utc).isoformat()
    geography = city_geography_fields(geocode)  # ADDED

    monthly_lows: dict[int, list[float]] = defaultdict(list)
    monthly_highs: dict[int, list[float]] = defaultdict(list)
    gdd_by_year: dict[int, float] = defaultdict(float)
    monthly_rows: list[dict[str, Any]] = []

    for key in sorted(set(tmean) | set(tmax) | set(tmin) | set(precipitation)):
        parsed = _parse_power_month_key(key)
        if parsed is None:
            continue
        year, month = parsed
        lo = _num_map_at(tmin, key)
        hi = _num_map_at(tmax, key)
        avg = _num_map_at(tmean, key)
        if avg is None and lo is not None and hi is not None:
            avg = (lo + hi) / 2
        monthly_gdd = None
        if avg is not None:
            monthly_gdd = max(0.0, avg - gdd_base_c) * calendar.monthrange(year, month)[1]
            gdd_by_year[year] += monthly_gdd
        if lo is not None:
            monthly_lows[month].append(lo)
        if hi is not None:
            monthly_highs[month].append(hi)
        monthly_rows.append({
            "city_name": city_name,
            **geography,  # ADDED: resolver-only city identity metadata.
            "weather_month": f"{year:04d}-{month:02d}",
            "provider": provider,
            "dataset": dataset,
            "timezone": timezone_name,
            "temp_min_c": lo,
            "temp_max_c": hi,
            "temp_mean_c": avg,
            "precipitation_mm": _num_map_at(precipitation, key),
            "gdd_base_5c": round(monthly_gdd, 2) if monthly_gdd is not None else None,
            "fetched_at": fetched_at,
            "source_url": "https://power.larc.nasa.gov/",
        })

    row: dict[str, Any] = {
        "city_name": city_name,
        **geography,  # CHANGED
        "latitude": round(float(geocode["latitude"]), 4),
        "longitude": round(float(geocode["longitude"]), 4),
        "timezone": timezone_name,
        "gdd_annual": round(mean(gdd_by_year.values())) if gdd_by_year else None,
        "gdd_base_c": int(gdd_base_c),
        "last_spring_frost_doy": None,
        "last_spring_frost_p10_doy": None,
        "last_spring_frost_p50_doy": None,
        "last_spring_frost_p90_doy": None,
        "first_fall_frost_doy": None,
        "first_fall_frost_p10_doy": None,
        "first_fall_frost_p50_doy": None,
        "first_fall_frost_p90_doy": None,
    }
    for month in range(1, 13):
        row[f"avg_monthly_low_c{month}"] = round(mean(monthly_lows[month])) if monthly_lows[month] else None
        row[f"avg_monthly_high_c{month}"] = round(mean(monthly_highs[month])) if monthly_highs[month] else None

    provenance = {
        "provider": provider,
        "dataset": dataset,
        "row_count": len(monthly_rows),
        "checksum": checksum_rows(monthly_rows),
        "frost_definition": "unavailable from monthly NASA POWER averages",
        "gdd_definition": f"monthly approximation using T2M and base {gdd_base_c}C",
    }
    return row, monthly_rows, provenance


def forecast_rows(city_name: str, payload: dict[str, Any], model: str, geocode: dict[str, Any] | None = None) -> list[dict[str, Any]]:  # CHANGED
    daily = payload.get("daily") or {}
    times = daily.get("time") or []
    run_timestamp = datetime.now(timezone.utc).isoformat()
    geography = city_geography_fields(geocode or payload) if geocode else {}  # ADDED
    rows = []
    for i, raw_day in enumerate(times):
        rows.append({
            "city_name": city_name,
            **geography,  # ADDED: resolver-only city identity metadata.
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


def _num_map_at(values: dict[str, Any], key: str) -> float | None:
    value = values.get(key)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_power_month_key(key: Any) -> tuple[int, int] | None:
    token = str(key or "").strip()
    if len(token) != 6 or not token.isdigit():
        return None
    year = int(token[:4])
    month = int(token[4:])
    if month < 1 or month > 12:
        return None
    return year, month


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
