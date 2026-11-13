from __future__ import annotations

import fieldshift.satellites as satellites
from fieldshift.satellites import SOURCES, _bbox, all_status, fetch_imagery, source_status


def test_sources_have_required_metadata():
    assert set(SOURCES) == {"smap", "gpm", "modis"}
    for source in SOURCES.values():
        for key in (
            "name", "provider", "gibs_layer", "cmr_short_name", "spatial_resolution",
            "temporal_coverage", "update_frequency", "variables", "docs_url", "doi",
        ):
            assert source[key], f"{source['id']} missing {key}"
        assert "NASA" in source["provider"]
        assert source["quantitative_note"]


def test_bbox_clamps_to_valid_globe():
    west, south, east, north = _bbox(26.5591, 31.6991, 0.5)
    assert (west, south, east, north) == (31.1991, 26.0591, 32.1991, 27.0591)
    west, south, east, north = _bbox(89.9, 179.9, 1)
    assert north == 90.0 and east == 180.0
    west, south, east, north = _bbox(-89.9, -179.9, 1)
    assert south == -90.0 and west == -180.0


def test_source_status_marks_quantitative_as_unavailable(monkeypatch):
    monkeypatch.setattr(satellites, "gibs_layer_dates", lambda: {"smap": "2026-11-08"})
    monkeypatch.setattr(satellites, "fetch_imagery", lambda *a, **k: (b"\x89PNG" + b"x" * 500, "2026-11-08"))
    monkeypatch.setattr(
        satellites,
        "_cmr_query",
        lambda *a, **k: {
            "ok": True,
            "query_window": {"start": "2026-10-01", "end": "2026-11-08"},
            "granule_count_sampled": 1,
            "latest": {"title": "SMAP_TEST", "time_start": "2026-11-08T00:00:00Z"},
            "granules": [],
        },
    )
    status = source_status("smap", 26.5591, 31.6991)
    assert status["gibs_available"] is True
    assert status["gibs_image_bytes"] >= 400
    assert status["cmr"]["ok"] is True
    assert status["quantitative_available"] is False
    assert "Earthdata" in status["quantitative_access"]
    assert status["earthdata_login_url"].startswith("https://urs.earthdata.nasa.gov")


def test_all_status_summary_with_mocks(monkeypatch):
    monkeypatch.setattr(satellites, "gibs_layer_dates", lambda: {"smap": "2026-11-08", "gpm": "2026-11-10", "modis": "2026-11-10"})
    monkeypatch.setattr(satellites, "fetch_imagery", lambda *a, **k: (b"x" * 500, "2026-11-10"))
    monkeypatch.setattr(
        satellites,
        "_cmr_query",
        lambda *a, **k: {"ok": True, "latest": {"title": "X"}, "granules": [], "granule_count_sampled": 1},
    )
    body = all_status(26.5591, 31.6991)
    assert body["summary"]["imagery_available"] == 3
    assert body["summary"]["cmr_available"] == 3
    assert body["summary"]["quantitative_available"] == 0
    assert "Earthdata" in body["access_note"]


def test_fetch_imagery_rejects_bad_date(monkeypatch):
    try:
        fetch_imagery("smap", 26.5, 31.7, day="not-a-date")
    except ValueError as exc:
        assert "YYYY-MM-DD" in str(exc)
    else:
        raise AssertionError("expected ValueError")
