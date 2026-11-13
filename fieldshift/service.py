"""Climate query service: validation → cache → NASA POWER → persistence."""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

from .config import CACHE_TTL_SECONDS
from .errors import FieldShiftError, PowerUnavailable
from .indicators import analyze_climate_risk
from .power import fetch_daily, resolve_period, validate_coordinates, validate_parameters
from .storage import Storage, get_storage

log = logging.getLogger(__name__)


def cache_ttl_seconds(end_date: date, *, today: date | None = None) -> int:
    """Historical windows change rarely; recent satellite/model data changes often."""
    today = today or date.today()
    age_days = (today - end_date).days
    if age_days >= 60:
        return 30 * 24 * 60 * 60
    if age_days >= 14:
        return 24 * 60 * 60
    return CACHE_TTL_SECONDS


def _cache_key(
    latitude: float,
    longitude: float,
    start: date,
    end: date,
    parameters: list[str],
) -> str:
    return Storage.make_key(
        source_id="nasa_power_daily",
        latitude=latitude,
        longitude=longitude,
        start=start.isoformat(),
        end=end.isoformat(),
        parameters=parameters,
    )


def climate_query(
    latitude: Any,
    longitude: Any,
    *,
    start: str | None = None,
    end: str | None = None,
    days: int = 90,
    parameters: list[str] | None = None,
    refresh: bool = False,
    storage: Storage | None = None,
) -> dict[str, Any]:
    """Return cleaned NASA POWER data, served from SQLite cache when fresh."""
    lat, lon = validate_coordinates(latitude, longitude)
    names = validate_parameters(parameters)
    start_date, end_date = resolve_period(start, end, days=days)
    store = storage or get_storage()
    key = _cache_key(lat, lon, start_date, end_date, names)

    if not refresh:
        cached = store.cache_get(key)
        if cached:
            cached["served_from_cache"] = True
            cached["indicators"] = analyze_climate_risk(
                cached.get("series"), quality=cached.get("quality")
            )
            return cached

    envelope = fetch_daily(
        lat,
        lon,
        start=start_date.isoformat(),
        end=end_date.isoformat(),
        parameters=names,
    )
    ttl = cache_ttl_seconds(end_date)
    cache_meta = store.cache_put(key, envelope, ttl_seconds=ttl)
    envelope["cache"] = cache_meta
    envelope["served_from_cache"] = False
    envelope["indicators"] = analyze_climate_risk(
        envelope.get("series"), quality=envelope.get("quality")
    )
    try:
        store.store_run(envelope, cache_key=key)
    except Exception as exc:  # persistence must not destroy a successful API response
        log.exception("Could not persist retrieval: %s", exc)
        envelope["persistence_warning"] = f"Data retrieved but not stored: {exc}"
    return envelope


def storage_stats() -> dict[str, Any]:
    store = get_storage()
    stats = store.stats()
    stats["checked_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return stats


# Re-exported for callers that want to inspect cache behaviour in tests.
__all__ = ["climate_query", "cache_ttl_seconds", "storage_stats", "FieldShiftError", "PowerUnavailable"]
