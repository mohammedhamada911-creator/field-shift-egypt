from __future__ import annotations

import copy

import pytest

from fieldshift.agri import crop_map
from fieldshift.rotation import (
    DEFAULT_WEIGHTS,
    FACTORS,
    SCENARIOS,
    climate_context_from_envelope,
    normalize_weights,
    score_rotations,
    score_scenario,
)

SOIL = {
    "ec_ds_m": 5.0,
    "organic_matter_pct": 0.8,
    "water_source": "nile_canal",
    "irrigation_method": "furrow",
    "ph": 8.1,
}
CLIMATE = {
    "period_days": 90,
    "heat_days_35c": 45,
    "very_hot_days_40c": 8,
    "mean_tmax_c": 36.0,
    "rain_total_mm": 0.0,
    "completeness_pct": 98.0,
}


def test_at_least_three_scenarios_and_all_crops_exist():
    assert len(SCENARIOS) >= 3
    assert len({scenario["id"] for scenario in SCENARIOS}) == len(SCENARIOS)
    crops = crop_map()
    for scenario in SCENARIOS:
        assert len(scenario["crops"]) >= 4
        assert all(crop_id in crops for crop_id in scenario["crops"])
        assert len(scenario["seasons"]) == len(scenario["crops"])


def test_normalize_weights_sums_to_100_and_handles_relative_values():
    normalised, notes = normalize_weights({"water": 2, "salinity": 1, "climate": 1, "soil": 1, "diversity": 1})
    assert sum(normalised.values()) == pytest.approx(100, abs=0.01)
    assert normalised["water"] == pytest.approx(33.3333, abs=0.01)
    assert notes


def test_normalize_weights_rejects_invalid_input():
    with pytest.raises(ValueError, match="Unknown weight"):
        normalize_weights({"water": 1, "banana": 2})
    with pytest.raises(ValueError, match="non-negative"):
        normalize_weights({"water": -1})
    with pytest.raises(ValueError, match="greater than zero"):
        normalize_weights({"water": 0})
    with pytest.raises(ValueError, match="must be a number"):
        normalize_weights({"water": "high"})


def test_scores_are_bounded_sorted_and_explained():
    result = score_rotations(soil=SOIL, climate=CLIMATE)
    scores = [scenario["score"] for scenario in result["scenarios"]]
    assert scores == sorted(scores, reverse=True)
    assert len(scores) >= 3
    for scenario in result["scenarios"]:
        assert 0 <= scenario["score"] <= 100
        assert scenario["range"]["low"] <= scenario["score"] <= scenario["range"]["high"]
        assert scenario["confidence"] in {"low", "medium", "medium-high"}
        assert len(scenario["factors"]) == len(FACTORS)
        for factor in scenario["factors"]:
            assert factor["method"]
            assert factor["source"]
            assert factor["reasons"]
            if factor["score"] is not None:
                assert 0 <= factor["score"] <= 100
                assert factor["contribution_points"] is not None


def test_contributions_and_trust_band_are_consistent():
    scenario = score_scenario(SCENARIOS[0], soil=SOIL, climate=CLIMATE)
    contributions = sum(f["contribution_points"] for f in scenario["factors"])
    assert contributions == pytest.approx(scenario["score"], abs=0.3)
    assert scenario["range"]["sigma_points"] > 0
    assert scenario["range"]["high"] - scenario["range"]["low"] <= 100


def test_weights_change_the_total_and_single_factor_weight_isolates_it():
    scenario = SCENARIOS[0]
    only_water = score_scenario(
        scenario,
        soil=SOIL,
        climate=CLIMATE,
        weights={"water": 1},
    )
    water_factor = next(f for f in only_water["factors"] if f["id"] == "water")
    assert only_water["score"] == pytest.approx(water_factor["score"], abs=0.1)
    assert only_water["weights_normalised"]["salinity"] == 0

    only_salinity = score_scenario(
        scenario,
        soil=SOIL,
        climate=CLIMATE,
        weights={"salinity": 1},
    )
    assert only_salinity["score"] == pytest.approx(
        next(f for f in only_salinity["factors"] if f["id"] == "salinity")["score"], abs=0.1
    )
    assert only_salinity["score"] != only_water["score"]


def test_higher_measured_salinity_lowers_salinity_factor():
    low = score_scenario(SCENARIOS[0], soil={**SOIL, "ec_ds_m": 2.0}, climate=CLIMATE)
    high = score_scenario(SCENARIOS[0], soil={**SOIL, "ec_ds_m": 12.0}, climate=CLIMATE)
    low_factor = next(f for f in low["factors"] if f["id"] == "salinity")
    high_factor = next(f for f in high["factors"] if f["id"] == "salinity")
    assert high_factor["score"] < low_factor["score"]
    assert high["score"] < low["score"]
    assert high_factor["data_quality"] == "user EC + reference thresholds"


def test_missing_ec_is_flagged_lower_confidence_not_imputed():
    known = score_scenario(SCENARIOS[0], soil=SOIL, climate=CLIMATE)
    unknown = score_scenario(SCENARIOS[0], soil={"water_source": "nile_canal"}, climate=None)
    unknown_salinity = next(f for f in unknown["factors"] if f["id"] == "salinity")
    assert unknown_salinity["data_quality"] == "reference thresholds only"
    assert unknown["confidence"] != "medium-high"
    assert unknown["range"]["sigma_points"] > known["range"]["sigma_points"]


def test_rainfed_high_demand_scores_worse_on_water():
    rainfed = score_scenario(SCENARIOS[0], soil={"water_source": "rainfall", "irrigation_method": "rainfed"}, climate=CLIMATE)
    irrigated = score_scenario(
        SCENARIOS[0],
        soil={"water_source": "nile_canal", "irrigation_method": "drip"},
        climate=CLIMATE,
    )
    rainfed_water = next(f for f in rainfed["factors"] if f["id"] == "water")["score"]
    irrigated_water = next(f for f in irrigated["factors"] if f["id"] == "water")["score"]
    assert rainfed_water < irrigated_water


def test_climate_context_changes_climate_factor_and_is_deterministic():
    water_thrifty = next(s for s in SCENARIOS if s["id"] == "water_thrifty")
    hot_dry = score_scenario(water_thrifty, soil=SOIL, climate=CLIMATE)
    mild = score_scenario(
        water_thrifty,
        soil=SOIL,
        climate={"period_days": 90, "heat_days_35c": 0, "rain_total_mm": 200.0},
    )
    hot_factor = next(f for f in hot_dry["factors"] if f["id"] == "climate")
    mild_factor = next(f for f in mild["factors"] if f["id"] == "climate")
    assert hot_factor["score"] != mild_factor["score"]
    assert hot_factor["data_quality"] == "NASA POWER + reference traits"
    again = score_scenario(water_thrifty, soil=SOIL, climate=copy.deepcopy(CLIMATE))
    assert again["score"] == hot_dry["score"]
    assert again["factors"] == hot_dry["factors"]


def test_climate_context_reduction_from_parsed_series():
    envelope = {
        "series": [
            {"date": "2026-11-01", "T2M_MAX": 30.0, "PRECTOTCORR": 0.0},
            {"date": "2026-11-02", "T2M_MAX": 36.0, "PRECTOTCORR": 0.0},
            {"date": "2026-11-03", "T2M_MAX": 41.0, "PRECTOTCORR": 2.0},
            {"date": "2026-11-04", "T2M_MAX": None, "PRECTOTCORR": None},
        ],
        "quality": {"completeness_pct": 75.0, "latest_observation": "2026-11-03"},
    }
    context = climate_context_from_envelope(envelope)
    assert context["period_days"] == 4
    assert context["heat_days_35c"] == 2
    assert context["very_hot_days_40c"] == 1
    assert context["rain_total_mm"] == 2.0
    assert context["mean_tmax_c"] == 35.67
    assert context["latest_observation"] == "2026-11-03"


def test_climate_context_handles_empty_or_unusable_envelopes():
    assert climate_context_from_envelope(None) is None
    assert climate_context_from_envelope({}) is None
    assert climate_context_from_envelope({"series": []}) is None
    assert climate_context_from_envelope({"series": [{"T2M_MAX": None}]}) is None


def test_unknown_scenario_and_crop_error_paths():
    with pytest.raises(ValueError, match="Unknown scenario"):
        score_rotations(scenario_ids=["does_not_exist"])
    broken = {**SCENARIOS[0], "crops": ["wheat", "not_a_crop"]}
    with pytest.raises(ValueError, match="Unknown crop"):
        score_scenario(broken, soil=SOIL, climate=CLIMATE)


def test_ranking_note_and_disclaimer_present():
    result = score_rotations(soil=SOIL, climate=CLIMATE)
    assert result["best_scenario_id"] == result["scenarios"][0]["scenario_id"]
    assert "not probabilities" in result["disclaimer"]
    assert "configured weights" in result["ranking_note"]


def test_default_weights_are_public_and_sum_to_100():
    assert set(DEFAULT_WEIGHTS) == set(FACTORS)
    assert sum(DEFAULT_WEIGHTS.values()) == 100
    assert all(weight > 0 for weight in DEFAULT_WEIGHTS.values())


def test_decision_brief_compares_leader_and_runner_up():
    result = score_rotations(soil=SOIL, climate=CLIMATE)
    brief = result["briefing"]
    leader, runner = result["scenarios"][0], result["scenarios"][1]
    assert brief["leader_id"] == leader["scenario_id"]
    assert brief["runner_up_id"] == runner["scenario_id"]
    assert brief["gap_points"] == pytest.approx(leader["score"] - runner["score"], abs=0.1)
    assert brief["separation"] in {"separated", "partly overlapping", "overlapping"}
    assert brief["strongest_factor"]["contribution_points"] >= brief["weakest_factor"]["contribution_points"]
    assert brief["strongest_factor"]["id"] in FACTORS
    assert "not a statistical confidence interval" in brief["note"]


def test_decision_brief_next_checks_track_missing_inputs():
    sparse = score_rotations(soil={"water_source": "nile_canal"}, climate=None)
    ids = {check["id"] for check in sparse["briefing"]["next_checks"]}
    assert {"salinity", "organic_matter", "water_context", "climate"} <= ids

    complete = score_rotations(soil={**SOIL, "water_source": "nile_canal", "irrigation_method": "drip"}, climate=CLIMATE)
    assert complete["briefing"]["next_checks"][0]["id"] == "verify"

    thin_climate = score_rotations(
        soil={**SOIL, "water_source": "nile_canal", "irrigation_method": "drip"},
        climate={"period_days": 90, "heat_days_35c": 20, "rain_total_mm": 1.0, "completeness_pct": 60},
    )
    ids = {check["id"] for check in thin_climate["briefing"]["next_checks"]}
    assert "climate_gaps" in ids


def test_risk_flags_match_low_factor_scores():
    scenario = score_scenario(
        SCENARIOS[0],
        soil={"ec_ds_m": 16.0, "water_source": "rainfall", "irrigation_method": "rainfed"},
        climate=CLIMATE,
    )
    low_ids = {factor["id"] for factor in scenario["factors"] if factor["score"] is not None and factor["score"] < 50}
    flagged_ids = {flag["id"] for flag in scenario["risk_flags"]}
    assert flagged_ids == low_ids
    assert all(flag["label"] and flag["detail"] and flag["score"] < 50 for flag in scenario["risk_flags"])

    clean = score_scenario(SCENARIOS[0], soil=SOIL, climate=CLIMATE)
    assert all(flag["score"] < 50 for flag in clean["risk_flags"])
