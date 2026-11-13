from __future__ import annotations

import pytest

from fieldshift.agri import (
    TEXTURES,
    agriculture_document,
    classify_organic_matter,
    classify_ph,
    classify_salinity,
    crops_document,
    crops_public,
    governorate_reference,
    soil_interpretation,
)


def test_all_27_governorates_have_reference_profiles():
    doc = agriculture_document()
    assert len(doc["governorates"]) == 27
    for name in doc["governorates"]:
        reference = governorate_reference(name)
        assert reference is not None
        assert reference["region"]["soil_summary"]
        assert reference["dominant_crops"]
        assert reference["sources"]


def test_sohag_and_aswan_references_differ():
    sohag = governorate_reference("Sohag")
    aswan = governorate_reference(None, latitude=24.0889, longitude=32.8998)
    assert sohag["governorate"] == "Sohag"
    assert aswan["governorate"] == "Aswan"
    assert sohag["region"]["id"] == aswan["region"]["id"] == "nile_valley"
    assert [c["id"] for c in sohag["dominant_crops"]] != [c["id"] for c in aswan["dominant_crops"]]


def test_reference_outside_egypt_is_none():
    assert governorate_reference(None, latitude=42.03, longitude=-93.63) is None


def test_crop_reference_completeness():
    public = crops_public()
    assert public["count"] == 22
    ids = {crop["id"] for crop in public["crops"]}
    assert {"wheat", "maize", "berseem", "faba_bean", "sorghum", "date_palm"} <= ids
    for crop in public["crops"]:
        assert crop["name"] and crop["family"] and crop["cycle"]
        assert crop["water_demand"] in {"low", "medium", "high", "very_high"}
        assert 1 <= crop["water_demand_level"] <= 4
        assert 1 <= crop["drought_tolerance"] <= 5
        assert 1 <= crop["heat_tolerance"] <= 5
        assert crop["root_depth_m"] > 0
        assert crop["kc_mid"] > 0
        assert isinstance(crop["n_fixation"], bool)
        assert crop["notes"] and crop["confidence"]
    assert "disclaimer" in crops_document()["meta"]


def test_ph_classes():
    assert classify_ph(None)["class"] == "not provided"
    assert classify_ph(5.0)["class"] == "strongly acidic"
    assert classify_ph(6.0)["class"] == "slightly acidic"
    assert classify_ph(7.2)["class"] == "near neutral"
    assert classify_ph(8.1)["class"] == "alkaline"
    assert classify_ph(9.0)["class"] == "strongly alkaline"


def test_salinity_classes_and_missing():
    assert classify_salinity(None)["class"] == "not provided"
    assert classify_salinity(1.0)["class"] == "non-saline"
    assert classify_salinity(3.0)["class"] == "slightly saline"
    assert classify_salinity(5.0)["class"] == "moderately saline"
    assert classify_salinity(10.0)["class"] == "strongly saline"
    assert classify_salinity(20.0)["class"] == "very strongly saline"


def test_organic_matter_classes():
    assert classify_organic_matter(None)["class"] == "not provided"
    assert classify_organic_matter(0.2)["class"] == "very low"
    assert classify_organic_matter(0.8)["class"] == "low"
    assert classify_organic_matter(1.5)["class"] == "moderate"
    assert classify_organic_matter(3.0)["class"] == "high"
    assert classify_organic_matter(5.0)["class"] == "very high"


def test_soil_interpretation_marks_missing_values_as_not_imputed():
    result = soil_interpretation({})
    assert result["inputs_echo"]["ph"] is None
    assert result["inputs_echo"]["organic_matter_pct"] is None
    assert result["inputs_echo"]["ec_ds_m"] is None
    assert result["summary"]["provided_fields"] == 0
    assert result["summary"]["confidence"] == "low"
    for item in result["interpretations"]:
        assert item["class"] == "not provided"
        assert item["value"] is None or item["value"] == "unknown"
    assert "not replaced with defaults" in " ".join(result["warnings"])


def test_soil_interpretation_flags_saline_poor_drainage_clay():
    result = soil_interpretation(
        {"texture": "saline_clay", "ph": 8.2, "organic_matter_pct": 0.4, "ec_ds_m": 9.5, "drainage": "poor"}
    )
    assert result["inputs_echo"]["texture"] == "saline_clay"
    assert result["summary"]["provided_fields"] == 5
    assert "high" in result["summary"]["flags"]
    by_factor = {item["factor"]: item for item in result["interpretations"]}
    assert by_factor["Salinity (EC)"]["class"] == "strongly saline"
    assert by_factor["Organic matter"]["class"] == "very low"
    assert by_factor["Drainage"]["class"] == "Poorly drained"
    assert "not a laboratory report" in " ".join(result["warnings"])


def test_unknown_texture_rejected():
    with pytest.raises(ValueError, match="Unknown soil texture"):
        soil_interpretation({"texture": "moon_dust"})
    assert "loam" in TEXTURES
