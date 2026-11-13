from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fieldshift.storage import Storage, iso


def make_envelope() -> dict:
    return {
        "ok": True,
        "source": {
            "id": "nasa_power_daily",
            "name": "NASA POWER test envelope",
            "url": "https://power.larc.nasa.gov/",
            "documentation_url": "https://power.larc.nasa.gov/docs/",
            "dataset_type": "model-derived",
            "spatial_resolution": "0.5 degree",
            "temporal_coverage": "1981-present",
            "attribution": "NASA POWER",
            "note": "test",
            "retrieved_at": "2026-11-12T00:00:00+00:00",
            "api_version": "v2",
            "parameters": [
                {"id": "T2M", "unit": "°C"},
                {"id": "PRECTOTCORR", "unit": "mm/day"},
            ],
        },
        "location": {"requested_latitude": 26.5591, "requested_longitude": 31.6991},
        "period": {
            "requested_start": "2026-11-10",
            "requested_end": "2026-11-11",
            "first_observation": "2026-11-10",
            "last_observation": "2026-11-11",
            "days_requested": 2,
        },
        "quality": {
            "completeness_pct": 75.0,
            "valid_cells": 3,
            "missing_cells": 1,
        },
        "series": [
            {"date": "2026-11-10", "T2M": 25.0, "PRECTOTCORR": 0.0},
            {"date": "2026-11-11", "T2M": None, "PRECTOTCORR": 1.2},
        ],
        "summaries": {},
    }


def test_cache_put_get_and_metadata(tmp_path):
    store = Storage(tmp_path / "test.sqlite3")
    store.init_schema()
    envelope = make_envelope()
    key = store.make_key(
        source_id="nasa_power_daily",
        latitude=26.5591,
        longitude=31.6991,
        start="2026-11-10",
        end="2026-11-11",
        parameters=["T2M", "PRECTOTCORR"],
    )
    meta = store.cache_put(key, envelope, ttl_seconds=3600)
    assert meta["hit"] is False
    cached = store.cache_get(key)
    assert cached is not None
    assert cached["cache"]["hit"] is True
    assert cached["series"][1]["T2M"] is None
    assert cached["series"][1]["PRECTOTCORR"] == 1.2
    assert cached["quality"]["missing_cells"] == 1


def test_expired_cache_is_not_returned(tmp_path):
    store = Storage(tmp_path / "test.sqlite3")
    store.init_schema()
    key = "expired-key"
    store.cache_put(key, make_envelope(), ttl_seconds=3600)
    with store.connect() as conn:
        past = iso(datetime.now(timezone.utc) - timedelta(hours=2))
        conn.execute("UPDATE api_cache SET expires_at = ? WHERE cache_key = ?", (past, key))
    assert store.cache_get(key) is None
    assert store.purge_expired_cache() == 1


def test_store_run_persists_observations_nulls_and_provenance(tmp_path):
    store = Storage(tmp_path / "test.sqlite3")
    store.init_schema()
    run_id = store.store_run(make_envelope(), cache_key="run-key")
    assert run_id > 0

    stats = store.stats()
    assert stats["runs"] == 1
    assert stats["observations"] == 4
    assert stats["sources"] == 1
    assert stats["last_retrieval"]["latest_observation"] == "2026-11-11"

    counts = store.observation_counts()
    by_param = {item["parameter"]: item for item in counts}
    assert by_param["T2M"]["missing"] == 1
    assert by_param["PRECTOTCORR"]["missing"] == 0
    assert by_param["T2M"]["first_date"] == "2026-11-10"
    assert by_param["T2M"]["last_date"] == "2026-11-11"

    sources = store.sources()
    assert sources[0]["source_id"] == "nasa_power_daily"
    assert sources[0]["last_retrieved_at"] == "2026-11-12T00:00:00+00:00"


def test_cache_key_is_stable_at_four_decimal_precision():
    args = dict(
        source_id="nasa_power_daily",
        start="2026-01-01",
        end="2026-01-02",
        parameters=["T2M"],
    )
    key1 = Storage.make_key(latitude=26.55911, longitude=31.69912, **args)
    key2 = Storage.make_key(latitude=26.55914, longitude=31.69913, **args)
    key3 = Storage.make_key(latitude=26.5592, longitude=31.6991, **args)
    assert key1 == key2
    assert key1 != key3
