"""Live Phase 3 tests: each NASA satellite source is checked independently."""
from __future__ import annotations

import pytest

from fieldshift.satellites import SOURCES, fetch_imagery, source_status

pytestmark = pytest.mark.live

LAT, LON = 26.5591, 31.6991


def _check_source(source_id: str, expected_prefix: str):
    status = source_status(source_id, LAT, LON)
    assert status["gibs_available"] is True, status["gibs_error"]
    assert status["gibs_imagery_date"]
    assert status["gibs_image_bytes"] > 400
    assert status["cmr"] is not None, status["cmr_error"]
    assert status["cmr"]["ok"] is True
    assert status["cmr"]["latest"] is not None
    assert status["cmr"]["latest"]["title"].startswith(expected_prefix)
    assert status["quantitative_available"] is False
    assert status["earthdata_login_url"].startswith("https://urs.earthdata")

    image, day = fetch_imagery(source_id, LAT, LON)
    assert image.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(image) > 400
    assert day == status["gibs_imagery_date"]

    print(f"\nLIVE {source_id.upper()} EVIDENCE")
    print("  product:", status["name"])
    print("  provider:", status["provider"])
    print("  GIBS layer/date:", status["gibs_layer"], day)
    print("  image bytes:", len(image))
    print("  CMR latest:", status["cmr"]["latest"]["title"])
    print("  CMR start:", status["cmr"]["latest"]["time_start"])
    print("  quantitative:", status["quantitative_access"])


def test_live_smap_imagery_and_metadata():
    _check_source("smap", "SMAP_L3_SM_P_E_")


def test_live_gpm_imagery_and_metadata():
    _check_source("gpm", "GPM_3IMERGDL")


def test_live_modis_imagery_and_metadata():
    _check_source("modis", "MOD13Q1")


def test_live_satellite_api_route(client):
    response = client.get(f"/api/satellite/status?lat={LAT}&lon={LON}")
    assert response.status_code == 200
    body = response.get_json()
    assert body["summary"]["imagery_available"] == 3
    assert body["summary"]["cmr_available"] == 3
    assert all(item["worldview_url"].startswith("https://worldview.earthdata.nasa.gov/") for item in body["sources"])

    image = client.get(f"/api/satellite/image/smap?lat={LAT}&lon={LON}")
    assert image.status_code == 200
    assert image.mimetype == "image/png"
    assert image.data.startswith(b"\x89PNG")
    assert image.headers["X-Data-Source"] == "NASA GIBS"
