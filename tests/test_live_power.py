"""Live integration tests. These contact the real NASA POWER API.

Run explicitly with:  .venv/bin/pytest -m live -s
They are skipped unless ``-m live`` is supplied.
"""
from __future__ import annotations

from datetime import date

import pytest

from fieldshift.power import fetch_daily

pytestmark = pytest.mark.live


def test_live_power_sohag_returns_real_observations():
    result = fetch_daily(26.5591, 31.6991, days=21)

    assert result["ok"] is True
    assert result["source"]["id"] == "nasa_power_daily"
    assert "NASA POWER" in result["source"]["name"]
    assert result["source"]["retrieved_at"]
    assert result["source"]["api_version"]
    assert result["source"]["sources"], "POWER should report its source streams"

    assert result["period"]["last_observation"]
    assert result["period"]["last_observation"] <= date.today().isoformat()
    assert result["period"]["days_requested"] == 21
    assert len(result["series"]) == 21

    temp = result["summaries"]["T2M"]
    rain = result["summaries"]["PRECTOTCORR"]
    solar = result["summaries"]["ALLSKY_SFC_SW_DWN"]
    assert temp["valid_days"] > 0
    assert temp["mean"] is not None
    assert -10 < temp["mean"] < 55
    assert rain["valid_days"] > 0
    assert rain["total"] is not None and rain["total"] >= 0
    assert solar["valid_days"] > 0
    assert solar["mean"] is not None and solar["mean"] >= 0

    # No fill sentinel may leak into the application layer.
    for row in result["series"]:
        for value in row.values():
            if isinstance(value, float):
                assert value != -999.0

    # Missing values are null, not zero.
    for row in result["series"]:
        for key, value in row.items():
            if key != "date":
                assert value is None or isinstance(value, float)

    print("\nLIVE NASA POWER EVIDENCE (Sohag)")
    print("  retrieved_at:", result["source"]["retrieved_at"])
    print("  period:", result["period"])
    print("  sources:", result["source"]["sources"])
    print("  T2M mean/min/max:", temp["mean"], temp["min"], temp["max"], "°C")
    print("  precipitation total:", rain["total"], "mm; wet days:", rain.get("wet_days"))
    print("  solar mean:", solar["mean"], "kWh/m2/day")
    print("  completeness:", result["quality"]["completeness_pct"], "%")


def test_live_power_retrieval_is_not_restricted_to_sohag():
    # Aswan Governorate, a climatically different part of Egypt.
    result = fetch_daily(24.0889, 32.8998, days=10)
    assert result["ok"] is True
    assert result["summaries"]["T2M"]["valid_days"] > 0
    assert result["period"]["last_observation"]
    assert result["summaries"]["T2M"]["mean"] is not None
    print("\nLIVE NASA POWER EVIDENCE (Aswan)")
    print("  latest:", result["period"]["last_observation"])
    print("  T2M mean:", result["summaries"]["T2M"]["mean"], "°C")


def test_live_api_route_returns_real_data(client):
    response = client.get("/api/power?lat=26.5591&lon=31.6991&days=7")
    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["location"]["governorate"]["name"] == "Sohag"
    assert body["period"]["last_observation"]
    assert body["quality"]["valid_cells"] > 0
    print("\nLIVE API ROUTE EVIDENCE")
    print("  status:", response.status_code)
    print("  latest:", body["period"]["last_observation"])
    print("  completeness:", body["quality"]["completeness_pct"])


def test_live_rotation_scoring_uses_real_nasa_climate(client):
    response = client.post(
        "/api/rotations/score",
        json={
            "lat": 26.5591,
            "lon": 31.6991,
            "days": 90,
            "soil": {
                "ec_ds_m": 5.0,
                "organic_matter_pct": 0.8,
                "water_source": "nile_canal",
                "irrigation_method": "furrow",
            },
        },
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["climate_source"] == "NASA POWER daily point data"
    assert body["climate_context"]["period_days"] == 90
    assert body["climate_context"]["latest_observation"]
    assert len(body["scenarios"]) >= 3
    assert all(0 <= scenario["score"] <= 100 for scenario in body["scenarios"])
    print("\nLIVE ROTATION EVIDENCE (real NASA POWER climate context)")
    print("  climate_source:", body["climate_source"])
    print("  heat days >=35C:", body["climate_context"]["heat_days_35c"])
    print("  rain total:", body["climate_context"]["rain_total_mm"], "mm")
    print("  best:", body["best_scenario_id"], body["scenarios"][0]["score"])
    for scenario in body["scenarios"]:
        print(f"  - {scenario['name']}: {scenario['score']} ({scenario['range']['low']}–{scenario['range']['high']})")


@pytest.mark.parametrize(
    "name,lat,lon",
    [
        ("Sohag", 26.5591, 31.6991),
        ("Alexandria", 31.2001, 29.9187),
        ("Aswan", 24.0889, 32.8998),
    ],
)
def test_live_multi_governorate_retrieval(name, lat, lon):
    from fieldshift.geo import locate_governorate

    governorate = locate_governorate(lat, lon)
    assert governorate is not None
    assert governorate["name"] == name

    result = fetch_daily(lat, lon, days=7)
    assert result["ok"] is True
    assert result["summaries"]["T2M"]["valid_days"] > 0
    assert result["period"]["last_observation"]
    assert result["quality"]["valid_cells"] > 0
    print(f"\nLIVE MULTI-GOVERNORATE EVIDENCE: {name}")
    print("  latest:", result["period"]["last_observation"])
    print("  T2M mean:", result["summaries"]["T2M"]["mean"], "°C")
    print("  valid cells:", result["quality"]["valid_cells"])
