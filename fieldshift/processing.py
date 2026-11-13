"""Reusable cleaning, validation and summary functions for NASA POWER payloads.

Missing values are always represented as ``None``. They are never coerced to
zero; a zero is only kept when the API actually returned 0 (for example a dry
day with 0.0 mm of rain).
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import Any, Iterable

from .config import POWER_PARAMETERS


def parse_iso_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Expected YYYY-MM-DD date, got {value!r}") from exc


def compact_to_iso(value: str) -> str:
    return f"{value[0:4]}-{value[4:6]}-{value[6:8]}"


def iso_to_compact(value: date) -> str:
    return value.strftime("%Y%m%d")


def as_float(value: Any, fill_value: float = -999.0) -> float | None:
    """Return a finite float, or None for fill/invalid values.

    ``bool`` is rejected because it is a subclass of int and never a valid
    climate observation.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    if math.isclose(number, fill_value, abs_tol=1e-9):
        return None
    return number


def clean_series(raw: dict[str, Any], fill_value: float = -999.0) -> dict[str, float | None]:
    return {str(day): as_float(value, fill_value) for day, value in raw.items()}


def summarize_parameter(parameter: str, series: dict[str, float | None]) -> dict[str, Any]:
    values = [value for value in series.values() if value is not None]
    meta = POWER_PARAMETERS.get(parameter, {})
    summary: dict[str, Any] = {
        "parameter": parameter,
        "label": meta.get("label", parameter),
        "unit": meta.get("unit", ""),
        "valid_days": len(values),
        "missing_days": len(series) - len(values),
        "first_observation": None,
        "last_observation": None,
        "min": None,
        "max": None,
        "mean": None,
        "total": None,
    }
    if not values:
        return summary

    valid_dates = [compact_to_iso(day) for day, value in series.items() if value is not None]
    summary["first_observation"] = min(valid_dates)
    summary["last_observation"] = max(valid_dates)
    summary["min"] = round(min(values), 3)
    summary["max"] = round(max(values), 3)
    summary["mean"] = round(sum(values) / len(values), 3)
    if parameter == "PRECTOTCORR":
        summary["total"] = round(sum(values), 3)
        summary["wet_days"] = sum(1 for value in values if value >= 0.1)
        summary["max_daily"] = round(max(values), 3)
    return summary


def build_series(
    parameters: dict[str, dict[str, Any]],
    *,
    fill_value: float = -999.0,
    expected_dates: Iterable[str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, float | None]]]:
    """Merge parameter series into date rows, preserving missing values as None."""
    cleaned = {name: clean_series(raw or {}, fill_value) for name, raw in parameters.items()}
    dates: set[str] = set(expected_dates or [])
    for series in cleaned.values():
        dates.update(series.keys())
    # Make the requested calendar explicit: absent API dates are gaps, not zeros.
    for series in cleaned.values():
        for day in dates:
            series.setdefault(day, None)

    rows: list[dict[str, Any]] = []
    for day in sorted(dates):
        row: dict[str, Any] = {"date": compact_to_iso(day)}
        for name, series in cleaned.items():
            row[name] = series.get(day)
        rows.append(row)
    return rows, cleaned


def data_quality(
    rows: list[dict[str, Any]],
    cleaned: dict[str, dict[str, float | None]],
    summaries: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    total_cells = len(rows) * len(cleaned)
    valid_cells = sum(1 for row in rows for name in cleaned if row.get(name) is not None)
    last_dates = [
        summary["last_observation"]
        for summary in summaries.values()
        if summary["last_observation"]
    ]
    missing = {name: summary["missing_days"] for name, summary in summaries.items()}
    return {
        "days": len(rows),
        "parameters": len(cleaned),
        "valid_cells": valid_cells,
        "missing_cells": total_cells - valid_cells,
        "completeness_pct": round(100 * valid_cells / total_cells, 2) if total_cells else 0.0,
        "missing_days_by_parameter": missing,
        "latest_observation": max(last_dates) if last_dates else None,
        "missing_value_policy": "Missing/fill values are null; they are never replaced with zero.",
    }


def parse_power_payload(
    payload: dict[str, Any],
    *,
    requested: dict[str, Any],
    parameters: list[str],
) -> dict[str, Any]:
    """Convert a raw POWER JSON response into a stable, UI-ready structure."""
    if not isinstance(payload, dict):
        raise ValueError("POWER response was not a JSON object")
    properties = payload.get("properties") or {}
    raw_parameters = properties.get("parameter") or {}
    missing = [name for name in parameters if name not in raw_parameters]
    if missing:
        raise ValueError(f"POWER response did not include requested parameters: {missing}")

    header = payload.get("header") or {}
    fill_value = float(header.get("fill_value", -999.0))
    api = header.get("api") or {}
    sources = header.get("sources") or []

    start = parse_iso_date(requested["start"])
    end = parse_iso_date(requested["end"])
    expected = [
        (start + timedelta(days=offset)).strftime("%Y%m%d")
        for offset in range((end - start).days + 1)
    ]
    rows, cleaned = build_series(
        {name: raw_parameters[name] for name in parameters},
        fill_value=fill_value,
        expected_dates=expected,
    )
    summaries = {name: summarize_parameter(name, series) for name, series in cleaned.items()}
    quality = data_quality(rows, cleaned, summaries)

    parameter_meta = []
    for name in parameters:
        meta = dict(POWER_PARAMETERS.get(name, {"label": name, "unit": ""}))
        meta["id"] = name
        meta.update(
            {
                "valid_days": summaries[name]["valid_days"],
                "missing_days": summaries[name]["missing_days"],
                "latest": summaries[name]["last_observation"],
            }
        )
        parameter_meta.append(meta)

    return {
        "series": rows,
        "summaries": summaries,
        "quality": quality,
        "power": {
            "api_version": api.get("version"),
            "api_name": api.get("name"),
            "sources": sources,
            "fill_value": fill_value,
            "time_standard": header.get("time_standard", "LST"),
            "messages": payload.get("messages", []),
            "header_start": header.get("start"),
            "header_end": header.get("end"),
        },
        "parameters": parameter_meta,
    }


def convert_value(value: Any, from_unit: str, to_unit: str) -> float | None:
    """Convert a numeric value between supported canonical units.

    Missing values stay missing. POWER's AG community already returns the
    canonical units below, so this is used for presentation/tests and future
    sources rather than silently rescaling API data.
    """
    number = as_float(value)
    if number is None:
        return None
    if from_unit == to_unit:
        return number
    conversions = {
        ("°C", "°F"): lambda v: v * 9 / 5 + 32,
        ("°F", "°C"): lambda v: (v - 32) * 5 / 9,
        ("mm", "in"): lambda v: v / 25.4,
        ("in", "mm"): lambda v: v * 25.4,
        ("kWh/m²/day", "MJ/m²/day"): lambda v: v * 3.6,
        ("MJ/m²/day", "kWh/m²/day"): lambda v: v / 3.6,
        ("m/s", "km/h"): lambda v: v * 3.6,
        ("km/h", "m/s"): lambda v: v / 3.6,
    }
    converter = conversions.get((from_unit, to_unit))
    if converter is None:
        raise ValueError(f"Unsupported unit conversion: {from_unit} → {to_unit}")
    return round(converter(number), 6)


def canonical_unit(parameter: str) -> str:
    return POWER_PARAMETERS.get(parameter, {}).get("unit", "")


def normalize_date_input(value: str | None, default: date) -> date:
    if not value:
        return default
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"Invalid date {value!r}; expected YYYY-MM-DD") from exc
