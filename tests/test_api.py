from __future__ import annotations

import copy

import pytest

from fieldshift.errors import PowerTimeout


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["version"]


def test_meta_has_attribution_and_units(client):
    response = client.get("/api/meta")
    assert response.status_code == 200
    body = response.get_json()
    assert body["default_location"]["governorate"] == "Sohag"
    source = body["sources"]["nasa_power"]
    assert "power.larc.nasa.gov" in source["url"]
    assert source["variables"]["T2M"]["unit"] == "°C"
    assert source["variables"]["PRECTOTCORR"]["unit"] == "mm/day"
    assert "not" in body["disclaimer"].lower()


def test_governorates_endpoint_covers_27_units(client):
    response = client.get("/api/governorates")
    assert response.status_code == 200
    body = response.get_json()
    assert body["count"] == 27
    names = {item["name"] for item in body["governorates"]}
    assert {"Sohag", "Aswan", "Alexandria", "New Valley"} <= names
    assert any(item["is_pilot"] for item in body["governorates"])


def test_location_detects_sohag(client):
    response = client.get("/api/location?lat=26.5591&lon=31.6991")
    assert response.status_code == 200
    location = response.get_json()["location"]
    assert location["in_egypt"] is True
    assert location["governorate"]["name"] == "Sohag"


def test_location_outside_egypt_is_labelled(client):
    response = client.get("/api/location?lat=42.03&lon=-93.63")
    assert response.status_code == 200
    location = response.get_json()["location"]
    assert location["in_egypt"] is False
    assert location["governorate"] is None
    assert "Outside Egypt" in location["local_agriculture_scope"]


def test_location_inside_bbox_but_outside_egypt_is_not_labelled_egypt(client):
    # Gulf of Aqaba / Saudi coast: inside Egypt's bounding box, outside its polygons.
    response = client.get("/api/location?lat=28.4406&lon=34.9534")
    assert response.status_code == 200
    location = response.get_json()["location"]
    assert location["in_egypt"] is False
    assert location["governorate"] is None
    assert "Outside Egypt" in location["local_agriculture_scope"]


def test_location_mediterranean_sea_is_not_labelled_egypt(client):
    response = client.get("/api/location?lat=31.5&lon=30.0")
    assert response.status_code == 200
    location = response.get_json()["location"]
    assert location["in_egypt"] is False
    assert location["governorate"] is None


def test_invalid_coordinates_return_400_json(client):
    response = client.get("/api/power?lat=abc&lon=31.7")
    assert response.status_code == 400
    body = response.get_json()
    assert body["error"]["code"] == "invalid_coordinates"


def test_missing_coordinates_return_400(client):
    response = client.get("/api/power")
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "invalid_coordinates"


def test_invalid_days_returns_400(client):
    response = client.get("/api/power?lat=26.5&lon=31.7&days=abc")
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "invalid_parameter"


def test_power_endpoint_parses_real_fixture(monkeypatch, client, raw_power_fixture):
    import fieldshift.power as power_module

    monkeypatch.setattr(power_module, "_request", lambda _params: copy.deepcopy(raw_power_fixture))
    response = client.get("/api/power?lat=26.5591&lon=31.6991&start=2026-08-15&end=2026-11-11")
    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["source"]["id"] == "nasa_power_daily"
    assert body["location"]["governorate"]["name"] == "Sohag"
    assert body["period"]["last_observation"] <= "2026-11-11"
    assert len(body["series"]) == 89
    assert body["quality"]["completeness_pct"] > 0
    assert body["disclaimer"]

    # Missing cells must be null, never zero-filled.
    missing_rows = [row for row in body["series"] if any(row[name] is None for name in ("T2M", "PRECTOTCORR"))]
    assert missing_rows, "Fixture should exercise at least one missing cell"
    for row in missing_rows:
        for name in ("T2M", "PRECTOTCORR"):
            assert row[name] is None or isinstance(row[name], float)


def test_power_response_includes_transparent_risk_indicators(power_envelope):
    from fieldshift.indicators import analyze_climate_risk

    result = analyze_climate_risk(power_envelope["series"], quality=power_envelope["quality"])
    assert result["kind"] == "calculated"
    assert result["overall_severity"] == "high"
    signals = {signal["id"]: signal for signal in result["signals"]}
    assert set(signals) == {"heat_stress", "dry_spell", "heavy_rain", "wind", "low_humidity"}
    assert signals["heat_stress"]["value"] == 52
    assert signals["heat_stress"]["severity"] == "high"
    assert signals["dry_spell"]["value"] == 86
    assert signals["heavy_rain"]["severity"] == "low"
    assert all(signal["threshold"] and signal["basis"] and signal["caveat"] for signal in result["signals"])
    assert "not a forecast" in result["summary"]


def test_power_upstream_timeout_maps_to_504(monkeypatch, client):
    import fieldshift.api as api_module

    def timeout(*_args, **_kwargs):
        raise PowerTimeout("simulated timeout", detail="test")

    monkeypatch.setattr(api_module, "climate_query", timeout)
    response = client.get("/api/power?lat=26.5591&lon=31.6991")
    assert response.status_code == 504
    assert response.get_json()["error"]["code"] == "power_timeout"


def test_power_upstream_failure_maps_to_502(monkeypatch, client):
    import fieldshift.api as api_module
    from fieldshift.errors import PowerUnavailable

    def unavailable(*_args, **_kwargs):
        raise PowerUnavailable("simulated upstream outage", detail="test")

    monkeypatch.setattr(api_module, "climate_query", unavailable)
    response = client.get("/api/power?lat=26.5591&lon=31.6991")
    assert response.status_code == 502
    assert response.get_json()["error"]["code"] == "power_unavailable"


def test_satellite_routes_validate_coordinates_and_source(client):
    bad = client.get("/api/satellite/image/smap?lat=999&lon=31.7")
    assert bad.status_code == 400
    assert bad.get_json()["error"]["code"] == "invalid_coordinates"

    unknown = client.get("/api/satellite/image/not-a-source?lat=26.5&lon=31.7")
    assert unknown.status_code == 404
    assert unknown.get_json()["error"]["code"] == "not_found"


def test_power_all_fill_maps_to_404(monkeypatch, client, raw_power_fixture):
    import fieldshift.power as power_module

    empty = copy.deepcopy(raw_power_fixture)
    for series in empty["properties"]["parameter"].values():
        for day in list(series):
            series[day] = -999.0
    monkeypatch.setattr(power_module, "_request", lambda _params: empty)
    response = client.get("/api/power?lat=26.5591&lon=31.6991&start=2026-08-15&end=2026-11-11")
    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "power_no_data"


def test_unknown_route_returns_json_404(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "not_found"


def test_crops_endpoint(client):
    response = client.get("/api/crops")
    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["count"] == 22
    crop = next(item for item in body["crops"] if item["id"] == "wheat")
    assert crop["name_ar"] == "قمح"
    assert crop["water_demand"] == "medium"


def test_agri_reference_endpoint_by_governorate_and_coordinate(client):
    by_name = client.get("/api/agri/reference?governorate=Aswan").get_json()
    assert by_name["available"] is True
    assert by_name["governorate"] == "Aswan"
    assert by_name["source_type"] == "reference dataset"
    assert by_name["dominant_crops"]

    by_coord = client.get("/api/agri/reference?lat=26.5591&lon=31.6991").get_json()
    assert by_coord["available"] is True
    assert by_coord["governorate"] == "Sohag"


def test_agri_reference_outside_egypt_is_explicitly_unavailable(client):
    body = client.get("/api/agri/reference?lat=42.03&lon=-93.63").get_json()
    assert body["available"] is False
    assert "not applied outside Egypt" in body["message"]


def test_soil_interpret_endpoint(client):
    response = client.post(
        "/api/soil/interpret",
        json={"texture": "clay_loam", "ph": 7.9, "organic_matter_pct": 0.7, "ec_ds_m": 4.5, "drainage": "poor"},
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["summary"]["provided_fields"] == 5
    assert len(body["interpretations"]) == 5
    assert body["source_type"] == "calculated indicators from user inputs"


def test_soil_interpret_rejects_unknown_texture(client):
    response = client.post("/api/soil/interpret", json={"texture": "moon_dust"})
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "invalid_soil_input"


def test_farm_profile_save_list_latest(client):
    payload = {
        "name": "Sohag pilot field",
        "latitude": 26.5591,
        "longitude": 31.6991,
        "soil_texture": "clay_loam",
        "ph": 7.8,
        "organic_matter_pct": 0.8,
        "ec_ds_m": 1.4,
        "drainage": "moderate",
        "irrigation_method": "furrow",
        "water_source": "nile_canal",
        "notes": "Test profile",
    }
    response = client.post("/api/farm/profile", json=payload)
    assert response.status_code == 201
    saved = response.get_json()["profile"]
    assert saved["id"] > 0
    assert saved["governorate"] == "Sohag"
    assert "not sent to NASA" in saved["privacy_note"]

    listed = client.get("/api/farm/profiles").get_json()["profiles"]
    assert len(listed) == 1
    assert listed[0]["name"] == "Sohag pilot field"

    latest = client.get("/api/farm/profile/latest").get_json()["profile"]
    assert latest["id"] == saved["id"]
    assert latest["ph"] == 7.8


def test_farm_profile_validation(client):
    bad_ph = client.post(
        "/api/farm/profile",
        json={"latitude": 26.5, "longitude": 31.7, "ph": 14},
    )
    assert bad_ph.status_code == 400
    assert bad_ph.get_json()["error"]["code"] == "invalid_parameter"

    bad_texture = client.post(
        "/api/farm/profile",
        json={"latitude": 26.5, "longitude": 31.7, "soil_texture": "moon_dust"},
    )
    assert bad_texture.status_code == 400

    missing_location = client.post("/api/farm/profile", json={"name": "no location"})
    assert missing_location.status_code == 400
    assert missing_location.get_json()["error"]["code"] == "invalid_coordinates"


def test_rotation_scenarios_endpoint_lists_factors_and_defaults(client):
    response = client.get("/api/rotations/scenarios")
    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert len(body["scenarios"]) >= 3
    assert len(body["factors"]) == 5
    assert sum(body["default_weights"].values()) == 100
    assert all(factor["method"] and factor["source"] for factor in body["factors"])


def test_rotation_scoring_endpoint_scores_all_scenarios(client):
    response = client.post(
        "/api/rotations/score",
        json={
            "soil": {
                "ec_ds_m": 5.0,
                "organic_matter_pct": 0.8,
                "water_source": "nile_canal",
                "irrigation_method": "furrow",
            },
            "climate": {
                "period_days": 90,
                "heat_days_35c": 45,
                "rain_total_mm": 0.0,
                "completeness_pct": 98.0,
            },
        },
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["climate_source"] == "caller-supplied context"
    assert len(body["scenarios"]) >= 3
    assert body["best_scenario_id"] == body["scenarios"][0]["scenario_id"]
    assert body["scenarios"][0]["score"] >= body["scenarios"][-1]["score"]
    assert body["context"]["weights_normalised"] == body["scenarios"][0]["weights_normalised"]
    brief = body["briefing"]
    assert brief["leader_id"] == body["best_scenario_id"]
    assert brief["runner_up_id"] == body["scenarios"][1]["scenario_id"]
    assert brief["gap_points"] == pytest.approx(
        body["scenarios"][0]["score"] - body["scenarios"][1]["score"], abs=0.1
    )
    assert brief["next_checks"]
    assert all(scenario["risk_flags"] is not None for scenario in body["scenarios"])


def test_rotation_scoring_respects_configurable_weights_and_subset(client):
    payload = {
        "soil": {"ec_ds_m": 4.0},
        "climate": {"period_days": 90, "heat_days_35c": 30, "rain_total_mm": 5.0},
        "scenario_ids": ["water_thrifty", "salt_aware"],
        "weights": {"water": 80, "salinity": 5, "climate": 5, "soil": 5, "diversity": 5},
    }
    response = client.post("/api/rotations/score", json=payload)
    assert response.status_code == 200
    body = response.get_json()
    assert [s["scenario_id"] for s in body["scenarios"]].sort() == ["salt_aware", "water_thrifty"].sort()
    assert body["context"]["weights_normalised"]["water"] == pytest.approx(80.0)

    only_salinity = client.post(
        "/api/rotations/score",
        json={**payload, "weights": {"salinity": 1}},
    ).get_json()
    salinity_factor = next(
        f for f in only_salinity["scenarios"][0]["factors"] if f["id"] == "salinity"
    )
    assert only_salinity["scenarios"][0]["score"] == pytest.approx(salinity_factor["score"], abs=0.1)


def test_rotation_scoring_validation_errors(client):
    bad_weights = client.post("/api/rotations/score", json={"weights": {"banana": 1}})
    assert bad_weights.status_code == 400
    assert bad_weights.get_json()["error"]["code"] == "invalid_parameter"

    bad_scenario = client.post("/api/rotations/score", json={"scenario_ids": ["nope"]})
    assert bad_scenario.status_code == 400

    bad_lat = client.post("/api/rotations/score", json={"lat": 200, "lon": 31.7})
    assert bad_lat.status_code == 400
    assert bad_lat.get_json()["error"]["code"] == "invalid_coordinates"

    bad_soil = client.post("/api/rotations/score", json={"soil": ["not", "an", "object"]})
    assert bad_soil.status_code == 400

    bad_days = client.post("/api/rotations/score", json={"days": 3})
    assert bad_days.status_code == 400


def test_api_cache_avoids_second_upstream_call(monkeypatch, client, raw_power_fixture):
    import copy

    import fieldshift.power as power_module

    calls = []

    def fake_request(params):
        calls.append(params)
        return copy.deepcopy(raw_power_fixture)

    monkeypatch.setattr(power_module, "_request", fake_request)
    url = "/api/power?lat=26.5591&lon=31.6991&start=2026-08-15&end=2026-11-11"

    first = client.get(url)
    assert first.status_code == 200
    body1 = first.get_json()
    assert body1["served_from_cache"] is False
    assert body1["cache"]["hit"] is False
    assert body1["indicators"]["overall_severity"] == "high"
    assert len(body1["indicators"]["signals"]) == 5
    assert len(calls) == 1

    second = client.get(url)
    assert second.status_code == 200
    body2 = second.get_json()
    assert body2["served_from_cache"] is True
    assert body2["cache"]["hit"] is True
    assert body2["indicators"] == body1["indicators"]
    assert len(calls) == 1

    stats = client.get("/api/storage/stats").get_json()["stats"]
    assert stats["runs"] == 1
    assert stats["observations"] == 89 * 8
    assert stats["cache_entries"] == 1

    observations = client.get("/api/storage/observations").get_json()["counts"]
    assert len(observations) == 8
    assert sum(item["rows"] for item in observations) == 89 * 8
