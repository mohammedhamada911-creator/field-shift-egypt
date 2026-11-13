"""Tests for documented-trait crop compatibility and saved analyses."""
from __future__ import annotations

from fieldshift.agri import crop_compatibility, get_crop


def test_salinity_uses_documented_crop_threshold():
    barley = get_crop("barley")
    tomato = get_crop("tomato")
    soil = {"ec_ds_m": 6.0}

    barley_result = crop_compatibility(
        barley, soil=soil, water_availability="sufficient", climate=None
    )
    tomato_result = crop_compatibility(
        tomato, soil=soil, water_availability="sufficient", climate=None
    )
    salinity = {item["id"]: item for item in barley_result["dimensions"]}
    assert salinity["salinity"]["known"] is True
    assert salinity["salinity"]["score"] >= 70
    # Tomato has a lower documented threshold than barley.
    assert tomato_result["dimensions"][1]["score"] < barley_result["dimensions"][1]["score"]


def test_missing_inputs_are_insufficient_not_invented():
    rice = get_crop("rice")
    result = crop_compatibility(rice, soil={}, climate=None, water_availability=None)
    assert result["level"] == "insufficient"
    assert result["score"] is None
    assert set(result["missing_dimensions"]) == {"water", "salinity", "climate"}


def test_two_known_dimensions_produce_a_level():
    wheat = get_crop("wheat")
    result = crop_compatibility(
        wheat,
        soil={"ec_ds_m": 1.0},
        climate={"period_days": 90, "heat_days_35c": 0, "rain_total_mm": 20},
        water_availability="sufficient",
    )
    assert result["level"] in {"high", "moderate", "low"}
    assert result["score"] is not None
    assert result["missing_dimensions"] == []


def test_compatibility_endpoint_and_water_validation(client):
    response = client.post(
        "/api/crops/compatibility",
        json={
            "soil": {"ec_ds_m": 2.0},
            "climate": {"period_days": 90, "heat_days_35c": 30, "rain_total_mm": 0},
            "water_availability": "limited",
            "crop_ids": ["wheat", "rice"],
        },
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["count"] == 2
    assert {item["crop_id"] for item in body["results"]} == {"wheat", "rice"}
    assert all(item["level"] for item in body["results"])

    bad = client.post(
        "/api/crops/compatibility",
        json={"water_availability": "infinite", "crop_ids": ["wheat"]},
    )
    assert bad.status_code == 400

    unknown = client.post(
        "/api/crops/compatibility", json={"crop_ids": ["moon_rice"]}
    )
    assert unknown.status_code == 400


def test_farm_profile_extended_fields_and_analysis_snapshot(client):
    response = client.post(
        "/api/farm/profile",
        json={
            "name": "بيت أحمد",
            "latitude": 26.5591,
            "longitude": 31.6991,
            "area_feddan": 3.5,
            "water_availability": "limited",
            "current_crop": "wheat",
            "previous_crops": "maize, berseem",
        },
    )
    assert response.status_code == 201
    profile = response.get_json()["profile"]
    assert profile["area_feddan"] == 3.5
    assert profile["water_availability"] == "limited"
    assert profile["current_crop"] == "wheat"
    assert profile["previous_crops"] == "maize, berseem"

    saved = client.post(
        "/api/farm/analysis",
        json={
            "farm_key": "farm-1",
            "farm_name": "بيت أحمد",
            "latitude": 26.5591,
            "longitude": 31.6991,
            "payload": {"summary": "اختبار", "saved_from": "pytest"},
        },
    )
    assert saved.status_code == 201
    assert saved.get_json()["id"] > 0

    listed = client.get("/api/farm/analyses?farm_key=farm-1").get_json()["analyses"]
    assert len(listed) == 1
    assert listed[0]["payload"]["saved_from"] == "pytest"
    assert listed[0]["farm_name"] == "بيت أحمد"


def test_farm_analysis_requires_payload(client):
    response = client.post(
        "/api/farm/analysis",
        json={"latitude": 26.5, "longitude": 31.7},
    )
    assert response.status_code == 400
