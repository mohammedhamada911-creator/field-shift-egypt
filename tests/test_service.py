from __future__ import annotations

import copy
from datetime import date

import fieldshift.service as service
from fieldshift.service import cache_ttl_seconds, climate_query
from fieldshift.storage import Storage


def test_cache_ttl_tiers():
    today = date(2026, 11, 12)
    assert cache_ttl_seconds(date(2026, 11, 11), today=today) == service.CACHE_TTL_SECONDS
    assert cache_ttl_seconds(date(2026, 10, 1), today=today) == 24 * 60 * 60
    assert cache_ttl_seconds(date(2026, 8, 1), today=today) == 30 * 24 * 60 * 60


def test_climate_query_caches_and_refreshes(monkeypatch, tmp_path, power_envelope):
    store = Storage(tmp_path / "service.sqlite3")
    store.init_schema()
    calls = []

    def fake_fetch(*args, **kwargs):
        calls.append((args, kwargs))
        return copy.deepcopy(power_envelope)

    monkeypatch.setattr(service, "fetch_daily", fake_fetch)

    first = climate_query(
        26.5591,
        31.6991,
        start="2026-08-15",
        end="2026-11-11",
        storage=store,
    )
    assert first["served_from_cache"] is False
    assert first["cache"]["hit"] is False
    assert len(calls) == 1
    assert first["quality"]["valid_cells"] > 0

    second = climate_query(
        26.5591,
        31.6991,
        start="2026-08-15",
        end="2026-11-11",
        storage=store,
    )
    assert second["served_from_cache"] is True
    assert second["cache"]["hit"] is True
    assert len(calls) == 1
    assert second["series"] == first["series"]

    refreshed = climate_query(
        26.5591,
        31.6991,
        start="2026-08-15",
        end="2026-11-11",
        storage=store,
        refresh=True,
    )
    assert refreshed["served_from_cache"] is False
    assert len(calls) == 2

    stats = store.stats()
    assert stats["runs"] == 2
    assert stats["cache_entries"] == 1
    assert stats["sources"] == 1
    assert stats["observations"] == 89 * 8


def test_different_coordinate_does_not_reuse_cache(monkeypatch, tmp_path, power_envelope):
    store = Storage(tmp_path / "service.sqlite3")
    store.init_schema()
    calls = []

    def fake_fetch(*args, **kwargs):
        calls.append(args)
        return copy.deepcopy(power_envelope)

    monkeypatch.setattr(service, "fetch_daily", fake_fetch)
    common = dict(start="2026-08-15", end="2026-11-11", storage=store)
    climate_query(26.5591, 31.6991, **common)
    climate_query(24.0889, 32.8998, **common)
    assert len(calls) == 2
