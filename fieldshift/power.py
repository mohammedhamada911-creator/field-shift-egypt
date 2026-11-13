"""NASA POWER daily point API client with validation, retries and clean errors."""
from __future__ import annotations

import math
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests

from .config import (
    DEFAULT_POWER_PARAMS,
    POWER_COMMUNITY,
    POWER_DAILY_URL,
    POWER_DOCS_URL,
    POWER_HOME_URL,
    POWER_MAX_RANGE_DAYS,
    POWER_RETRIES,
    POWER_TIME_STANDARD,
    POWER_TIMEOUT_SECONDS,
)
from .errors import (
    InvalidCoordinates,
    InvalidDateRange,
    InvalidParameter,
    PowerNoData,
    PowerTimeout,
    PowerUnavailable,
)
from .processing import iso_to_compact, parse_power_payload


def validate_coordinates(latitude: Any, longitude: Any) -> tuple[float, float]:
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError) as exc:
        raise InvalidCoordinates(
            "Latitude and longitude must be numbers.",
            detail=f"Received latitude={latitude!r}, longitude={longitude!r}.",
            hint="Use decimal degrees, for example latitude=26.5591 and longitude=31.6991.",
        ) from exc
    if not math.isfinite(lat) or not math.isfinite(lon):
        raise InvalidCoordinates("Latitude and longitude must be finite numbers.")
    if not -90 <= lat <= 90:
        raise InvalidCoordinates(
            "Latitude is outside the valid range.",
            detail=f"latitude={lat} is not between -90 and 90.",
        )
    if not -180 <= lon <= 180:
        raise InvalidCoordinates(
            "Longitude is outside the valid range.",
            detail=f"longitude={lon} is not between -180 and 180.",
        )
    # Reject absurd precision that suggests a parse/typo problem.
    if abs(lat) > 89.9999 or abs(lon) > 179.9999:
        raise InvalidCoordinates("Coordinate is at or beyond the API's supported pole/date line.")
    return round(lat, 6), round(lon, 6)


def validate_period(start: date, end: date, *, today: date | None = None) -> tuple[date, date]:
    today = today or date.today()
    if start > end:
        raise InvalidDateRange(
            "Start date must be on or before end date.",
            detail=f"start={start.isoformat()}, end={end.isoformat()}.",
        )
    if start < date(1981, 1, 1):
        raise InvalidDateRange("NASA POWER daily data begins on 1981-01-01.")
    if end > today:
        raise InvalidDateRange(
            "End date cannot be in the future.",
            detail=f"Requested end={end.isoformat()}, today={today.isoformat()}.",
            hint="Use the latest available date shown in the app; satellite/model data has a latency of several days.",
        )
    if (end - start).days + 1 > POWER_MAX_RANGE_DAYS:
        raise InvalidDateRange(            "Requested period is too long for the interactive API.",
            detail=f"Maximum is {POWER_MAX_RANGE_DAYS} days per request.",
        )
    return start, end


def validate_parameters(parameters: list[str] | None) -> list[str]:
    names = parameters or list(DEFAULT_POWER_PARAMS)
    if not names:
        raise InvalidParameter("At least one POWER parameter is required.")
    unknown = [name for name in names if name not in DEFAULT_POWER_PARAMS]
    if unknown:
        raise InvalidParameter(
            "One or more POWER parameters are not supported by this application.",
            detail=f"Unsupported: {unknown}",
            hint=f"Supported parameters: {', '.join(DEFAULT_POWER_PARAMS)}",
        )
    # Preserve configured order, remove duplicates.
    return [name for name in DEFAULT_POWER_PARAMS if name in set(names)]


def resolve_period(start: str | None, end: str | None, *, days: int = 90) -> tuple[date, date]:
    today = date.today()
    try:
        end_date = date.fromisoformat(end) if end else today
        start_date = date.fromisoformat(start) if start else end_date - timedelta(days=days - 1)
    except ValueError as exc:
        raise InvalidDateRange(
            "Dates must use the YYYY-MM-DD format.",
            detail=str(exc),
        ) from exc
    return validate_period(start_date, end_date)


def _request(params: dict[str, Any]) -> dict[str, Any]:
    last_error: Exception | None = None
    headers = {
        "User-Agent": "FieldShiftEgypt/0.1 (NASA Space Apps Challenge; educational decision-support prototype)",
        "Accept": "application/json",
    }
    for attempt in range(POWER_RETRIES + 1):
        try:
            response = requests.get(
                POWER_DAILY_URL,
                params=params,
                timeout=(10, POWER_TIMEOUT_SECONDS),
                headers=headers,
            )
            if response.status_code >= 500:
                raise PowerUnavailable(
                    "NASA POWER is temporarily unavailable.",
                    detail=f"HTTP {response.status_code} from {POWER_DAILY_URL}.",
                )
            if response.status_code >= 400:
                detail = response.text[:500]
                try:
                    body = response.json()
                    detail = str(body.get("messages") or body)[:500]
                except ValueError:
                    pass
                raise PowerUnavailable(
                    "NASA POWER rejected the request.",
                    detail=f"HTTP {response.status_code}: {detail}",
                    hint="Check coordinates, dates and parameter names.",
                )
            try:
                return response.json()
            except ValueError as exc:
                raise PowerUnavailable(
                    "NASA POWER returned a response that was not valid JSON.",
                    detail=response.text[:300],
                ) from exc
        except PowerUnavailable:
            raise
        except requests.Timeout as exc:
            last_error = exc
            if attempt >= POWER_RETRIES:
                raise PowerTimeout(
                    "NASA POWER did not respond in time.",
                    detail=f"Timed out after {POWER_TIMEOUT_SECONDS:.0f}s and {POWER_RETRIES + 1} attempts.",
                    hint="Try a shorter date range or retry in a few minutes.",
                ) from exc
        except requests.RequestException as exc:
            last_error = exc
            if attempt >= POWER_RETRIES:
                raise PowerUnavailable(
                    "Could not reach NASA POWER.",
                    detail=str(exc),
                    hint="Check the server's internet connection and retry.",
                ) from exc
        time.sleep(0.75 * (attempt + 1))
    raise PowerUnavailable("Could not reach NASA POWER.", detail=str(last_error))


def fetch_daily(
    latitude: Any,
    longitude: Any,
    *,
    start: str | None = None,
    end: str | None = None,
    days: int = 90,
    parameters: list[str] | None = None,
) -> dict[str, Any]:
    """Fetch real NASA POWER daily data and return a cleaned response envelope."""
    lat, lon = validate_coordinates(latitude, longitude)
    start_date, end_date = resolve_period(start, end, days=days)
    names = validate_parameters(parameters)

    request_params = {
        "parameters": ",".join(names),
        "community": POWER_COMMUNITY,
        "latitude": f"{lat:.6f}",
        "longitude": f"{lon:.6f}",
        "start": iso_to_compact(start_date),
        "end": iso_to_compact(end_date),
        "format": "JSON",
        "time-standard": POWER_TIME_STANDARD,
    }
    retrieved_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    payload = _request(request_params)

    try:
        parsed = parse_power_payload(
            payload,
            requested={"start": start_date.isoformat(), "end": end_date.isoformat()},
            parameters=names,
        )
    except ValueError as exc:
        raise PowerNoData(
            "NASA POWER returned data that could not be processed.",
            detail=str(exc),
        ) from exc

    if parsed["quality"]["valid_cells"] == 0:
        raise PowerNoData(
            "NASA POWER returned no valid observations for this location and period.",
            detail=(
                f"All {parsed['quality']['missing_cells']} returned cells were missing/fill values "
                "for the requested dates."
            ),
            hint="Try a more recent date range (data has a multi-day latency) or another location.",
        )

    return {
        "ok": True,
        "source": {
            "id": "nasa_power_daily",
            "name": "NASA POWER — Daily Point API (Agroclimatology)",
            "short_name": "NASA POWER",
            "url": POWER_HOME_URL,
            "api_url": POWER_DAILY_URL,
            "documentation_url": POWER_DOCS_URL,
            "community": "Agroclimatology (AG)",
            "time_standard": POWER_TIME_STANDARD,
            "dataset_type": "Assimilated / model-derived daily climate data",
            "attribution": (
                "NASA Prediction Of Worldwide Energy Resources (POWER) project, NASA Langley Research Center. "
                "POWER is not an endorsement of this application."
            ),
            "note": (
                "POWER blends MERRA-2, GEOSIT, SYN1DEG, FLASHFLUX and POWER source data; it is not a single "
                "satellite instrument measurement. Values are grid-cell estimates, not on-farm sensors."
            ),
            "retrieved_at": retrieved_at,
            "parameters": parsed["parameters"],
            "sources": parsed["power"]["sources"],
            "api_version": parsed["power"]["api_version"],
            "messages": parsed["power"]["messages"],
        },
        "location": {
            "requested_latitude": lat,
            "requested_longitude": lon,
            "spatial_note": "POWER returns the value of the containing 0.5° × 0.5° grid cell.",
        },
        "period": {
            "requested_start": start_date.isoformat(),
            "requested_end": end_date.isoformat(),
            "first_observation": min(
                (s["first_observation"] for s in parsed["summaries"].values() if s["first_observation"]),
                default=None,
            ),
            "last_observation": parsed["quality"]["latest_observation"],
            "days_requested": parsed["quality"]["days"],
            "days_returned": parsed["quality"]["days"],
        },
        "series": parsed["series"],
        "summaries": parsed["summaries"],
        "quality": parsed["quality"],
        "power": parsed["power"],
    }
