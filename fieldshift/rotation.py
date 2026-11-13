"""Transparent, rule-based crop-rotation scoring.

The scores in this module are *decision-support indicators*, not yield, profit
or water-use predictions. Every factor exposes its inputs, rule, source and
sensitivity band so that a farmer or extension worker can disagree with a
specific step instead of trusting an opaque total.

Design rules
------------
* Scores are bounded 0–100 and monotonically better with higher values.
* Default weights sum to 100; caller-supplied weights are normalised and must
  be finite and non-negative.
* Missing inputs are never imputed. A factor that cannot be calculated becomes
  ``None``, is dropped from the weighted total, and lowers confidence.
* Uncertainty is a deterministic sensitivity band derived from factor-level
  uncertainty, not a probability of success.
"""
from __future__ import annotations

from typing import Any

from .agri import get_crop

# ---------------------------------------------------------------------------
# Factor definitions
# ---------------------------------------------------------------------------

FACTORS: dict[str, dict[str, Any]] = {
    "water": {
        "label": "Water balance",
        "short": "Water",
        "weight": 25,
        "unit": "score 0–100",
        "question": "How well does the rotation match the available water and irrigation system?",
        "method": (
            "Mean crop water-demand level (1 very low … 4 very high) is inverted to 0–100. "
            "Rainfed systems lose 20 points if any crop needs medium or more water; drip/sprinkler "
            "systems receive a 5-point efficiency credit, capped at 100."
        ),
        "source": "FAO Irrigation and Drainage Paper 56 crop characteristics; user irrigation inputs.",
    },
    "salinity": {
        "label": "Salinity fit",
        "short": "Salinity",
        "weight": 20,
        "unit": "score 0–100",
        "question": "Can the chosen crops tolerate the stated soil salinity?",
        "method": (
            "Each crop's approximate ECe tolerance threshold is compared with the user-supplied "
            "EC: score = clamp(tolerance / EC, 0, 1) × 100, averaged across crops. Without an EC "
            "value the factor uses mean tolerance alone, is marked lower-confidence, and does not "
            "pretend to know the field's salinity."
        ),
        "source": "FAO Irrigation and Drainage Paper 29 salinity thresholds; user soil test.",
    },
    "climate": {
        "label": "Climate resilience",
        "short": "Climate",
        "weight": 20,
        "unit": "score 0–100",
        "question": "Do the crops' heat and drought traits match the recent NASA POWER climate?",
        "method": (
            "NASA POWER daily maximum temperature and precipitation are reduced to heat-day and "
            "rain-scarcity pressures (0–1). For each pressure, the tolerance shortfall from 5/5 is "
            "scaled by that pressure and averaged across heat and drought. Without climate data the "
            "raw trait score is retained at reduced confidence with no claim of local calibration."
        ),
        "source": "NASA POWER daily AG/LST point data; FAO EcoCrop-derived crop traits.",
    },
    "soil": {
        "label": "Soil protection",
        "short": "Soil",
        "weight": 15,
        "unit": "score 0–100",
        "question": "Does the sequence protect the soil surface and return residues?",
        "method": (
            "Crop soil-cover and residue levels (low/medium/high) are averaged and scaled to 0–100. "
            "When user organic matter is below 1%, high-residue crops receive a transparency-flagged "
            "bonus because cover is more valuable on depleted soils. This is a qualitative rule, not "
            "a soil-carbon model."
        ),
        "source": "Crop trait reference set; user organic-matter input.",
    },
    "diversity": {
        "label": "Rotation diversity & continuity",
        "short": "Diversity",
        "weight": 20,
        "unit": "score 0–100",
        "question": "Does the sequence break pest cycles and keep nitrogen/season continuity?",
        "method": (
            "Scores legume presence, distinct crop families, adjacent same-family penalties and "
            "winter/summer alternation. It is an agronomic heuristic, not a pest-risk model."
        ),
        "source": "FAO crop rotation principles; crop family and cycle traits.",
    },
}

DEFAULT_WEIGHTS = {key: factor["weight"] for key, factor in FACTORS.items()}

RISK_FLAG_LABELS = {
    "water": "Water-demand pressure",
    "salinity": "Salinity mismatch",
    "climate": "Heat/dry exposure",
    "soil": "Low soil cover",
    "diversity": "Narrow rotation",
}

RISK_FLAG_DETAIL = {
    "water": "The sequence contains crops whose water demand is high for the stated system.",
    "salinity": "At least one crop tolerance threshold is low against the supplied salinity.",
    "climate": "The sequence's heat/drought traits score poorly against the recent NASA climate context.",
    "soil": "The sequence's cover/residue traits offer limited soil-surface protection.",
    "diversity": "The sequence has limited family or seasonal diversity.",
}


# ---------------------------------------------------------------------------
# Scenarios (deliberately small, editable reference sequences)
# ---------------------------------------------------------------------------

SCENARIOS: list[dict[str, Any]] = [
    {
        "id": "cereal_fodder",
        "name": "Cereal–fodder resilience",
        "summary": "Wheat and maize for food/feed, with berseem and sorghum breaking the sequence.",
        "crops": ["wheat", "maize", "berseem", "sorghum"],
        "seasons": ["winter", "summer", "winter", "summer"],
        "rationale": (
            "A two-year Nile Valley sequence that combines a staple cereal, summer maize, a nitrogen-"
            "fixing winter fodder and a heat-tolerant summer cereal. Useful as a baseline to compare "
            "against more water- or salt-focused options."
        ),
        "caution": "Berseem is a high-water fodder crop; it is not appropriate where water is tightly constrained.",
    },
    {
        "id": "salt_aware",
        "name": "Salt-aware barley rotation",
        "summary": "Barley, cotton, wheat and sorghum chosen for tolerance on salinity-affected land.",
        "crops": ["barley", "cotton", "wheat", "sorghum"],
        "seasons": ["winter", "summer", "winter", "summer"],
        "rationale": (
            "Barley and cotton carry higher salinity thresholds; sorghum adds summer heat tolerance. "
            "Wheat is retained for food security but is less salt-tolerant, so the score should fall "
            "as measured EC rises."
        ),
        "caution": "No crop tolerates unlimited salinity. Drainage and leaching management remain necessary.",
    },
    {
        "id": "water_thrifty",
        "name": "Water-thrifty rotation",
        "summary": "Low-demand barley, sorghum, chickpea and sesame for constrained irrigation.",
        "crops": ["barley", "sorghum", "chickpea", "sesame"],
        "seasons": ["winter", "summer", "winter", "summer"],
        "rationale": (
            "Prioritises low water demand, drought and heat tolerance, and a winter legume. It trades "
            "some soil cover and market diversity for lower irrigation exposure."
        ),
        "caution": "Lower water demand does not guarantee savings without matched irrigation scheduling.",
    },
    {
        "id": "diversified_market",
        "name": "Diversified market rotation",
        "summary": "Onion, tomato, faba bean and sunflower for crop and income diversity.",
        "crops": ["onion", "tomato", "faba_bean", "sunflower"],
        "seasons": ["winter", "summer", "winter", "summer"],
        "rationale": (
            "Four plant families and a nitrogen-fixing winter legume spread pest, price and labour "
            "risk. Vegetables are more management- and water-sensitive than cereals."
        ),
        "caution": "Horticultural rotations require market access, labour and careful irrigation; they are not low-input.",
    },
]

SCENARIO_MAP = {scenario["id"]: scenario for scenario in SCENARIOS}

COVER_LEVEL = {"low": 1, "medium": 2, "high": 3}
RESIDUE_LEVEL = {"low": 1, "medium": 2, "high": 3}
WATER_LEVEL = {"very_low": 1, "low": 2, "medium": 3, "high": 4, "very_high": 5}


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _crop_or_error(crop_id: str) -> dict[str, Any]:
    crop = get_crop(crop_id)
    if crop is None:
        raise ValueError(f"Unknown crop id {crop_id!r} in rotation scenario.")
    return crop


def normalize_weights(weights: dict[str, Any] | None) -> tuple[dict[str, float], list[str]]:
    """Validate and normalise factor weights.

    Unknown factor names are rejected (silent typos would otherwise distort a
    recommendation). All-zero weights are rejected.
    """
    if weights is None:
        weights = DEFAULT_WEIGHTS
    if not isinstance(weights, dict):
        raise ValueError("weights must be an object keyed by factor id.")
    unknown = sorted(set(weights) - set(FACTORS))
    if unknown:
        raise ValueError(f"Unknown weight factor(s): {', '.join(unknown)}.")
    cleaned: dict[str, float] = {}
    for key in FACTORS:
        raw = weights.get(key, 0)
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise ValueError(f"Weight for {key} must be a number.")
        value = float(raw)
        if value < 0 or value != value or value in (float("inf"), float("-inf")):
            raise ValueError(f"Weight for {key} must be finite and non-negative.")
        cleaned[key] = value
    total = sum(cleaned.values())
    if total <= 0:
        raise ValueError("At least one factor weight must be greater than zero.")
    normalised = {key: round(value / total * 100, 4) for key, value in cleaned.items()}
    notes = []
    if abs(total - 100) > 0.01:
        notes.append(
            "Weights were normalised to 100 because the supplied values summed to "
            f"{total:.2f}."
        )
    return normalised, notes


def climate_context_from_envelope(envelope: dict[str, Any] | None) -> dict[str, Any] | None:
    """Reduce a parsed POWER envelope to the few climate pressures used here."""
    if not envelope or not isinstance(envelope.get("series"), list):
        return None
    rows = envelope["series"]
    if not rows:
        return None
    max_temps = [row.get("T2M_MAX") for row in rows if row.get("T2M_MAX") is not None]
    rain = [row.get("PRECTOTCORR") for row in rows if row.get("PRECTOTCORR") is not None]
    if not max_temps:
        return None
    heat_days = sum(1 for value in max_temps if value >= 35)
    very_hot_days = sum(1 for value in max_temps if value >= 40)
    total_days = len(rows)
    completeness = float((envelope.get("quality") or {}).get("completeness_pct") or 0)
    rain_total = round(sum(rain), 3) if rain else None
    source = envelope.get("source") or {}
    period = envelope.get("period") or {}
    return {
        "source": "NASA POWER daily point data (AG community, LST)",
        "source_name": source.get("name"),
        "source_url": source.get("url"),
        "retrieved_at": source.get("retrieved_at"),
        "retrieval_note": "Grid-cell estimate, not an on-farm sensor measurement.",
        "requested_start": period.get("requested_start"),
        "requested_end": period.get("requested_end"),
        "period_days": total_days,
        "heat_days_35c": heat_days,
        "very_hot_days_40c": very_hot_days,
        "mean_tmax_c": round(sum(max_temps) / len(max_temps), 2),
        "rain_total_mm": rain_total,
        "completeness_pct": completeness,
        "latest_observation": (envelope.get("quality") or {}).get("latest_observation"),
    }


def _climate_pressures(climate: dict[str, Any] | None) -> tuple[float | None, float | None, str]:
    if not climate:
        return None, None, "No climate context supplied; climate factor uses crop traits only."
    days = climate.get("period_days") or 0
    heat_days = climate.get("heat_days_35c")
    rain_total = climate.get("rain_total_mm")
    if not days or heat_days is None:
        return None, None, "Climate context was incomplete; climate factor uses crop traits only."
    heat_fraction = heat_days / days
    heat_pressure = _clamp(heat_fraction / 0.30, 0, 1)
    if rain_total is None:
        drought_pressure = 0.6
        rain_note = "rain total unavailable; a moderate dryland pressure is assumed"
    else:
        # Below ~1 mm per day is strongly water-limited for Egyptian field crops.
        drought_pressure = _clamp(1 - (rain_total / max(1.0, days * 1.0)), 0, 1)
        rain_note = f"{rain_total:.1f} mm rain over {days} days"
    note = (
        f"Heat pressure {heat_pressure:.2f} from {heat_days} day(s) ≥35 °C; "
        f"rain-scarcity pressure {drought_pressure:.2f} ({rain_note})."
    )
    return heat_pressure, drought_pressure, note


def _water_score(crops: list[dict[str, Any]], soil: dict[str, Any]) -> tuple[float, list[str]]:
    levels = [c.get("water_demand_level") for c in crops if c.get("water_demand_level")]
    if not levels:
        raise ValueError("Crops in this scenario have no water-demand levels.")
    mean_level = sum(levels) / len(levels)
    base = 100 - ((mean_level - 1) / 3 * 100)
    crop_levels = ", ".join(
        "{}={}".format(crop["name"], crop.get("water_demand_level")) for crop in crops
    )
    reasons = [
        f"Mean water-demand level {mean_level:.2f} on a 1–4 scale ({crop_levels})."
    ]
    source = soil.get("water_source")
    method = soil.get("irrigation_method")
    if source == "rainfall" and any(level >= 3 for level in levels):
        base -= 20
        reasons.append("Rainfed system with at least one medium/high-demand crop: −20 points.")
    if method in {"drip", "sprinkler"}:
        base += 5
        reasons.append("Drip/sprinkler irrigation reported: +5 efficiency credit.")
    if source == "nile_canal":
        reasons.append("Nile canal supply reported; canal reliability and allocation are not modelled.")
    return round(_clamp(base), 1), reasons


def _salinity_score(
    crops: list[dict[str, Any]], soil: dict[str, Any]
) -> tuple[float | None, list[str], bool]:
    ec = soil.get("ec_ds_m")
    tolerances = [c.get("salinity_tolerance_ece_ds_m") for c in crops]
    tolerances = [float(value) for value in tolerances if value is not None]
    if not tolerances:
        return None, ["No crop salinity thresholds are available."], False
    if ec is None:
        score = _mean([_clamp(value / 10 * 100) for value in tolerances])
        reasons = [
            "No soil EC supplied: scored on mean crop tolerance only; field salinity is unknown.",
            f"Mean approximate ECe threshold {sum(tolerances) / len(tolerances):.1f} dS/m.",
        ]
        return round(score, 1), reasons, False
    try:
        ec = float(ec)
    except (TypeError, ValueError):
        return None, ["Soil EC was not numeric; salinity fit skipped."], False
    if ec < 0:
        return None, ["Soil EC was negative; salinity fit skipped."], False
    ratios = [_clamp(value / ec, 0, 1) for value in tolerances]
    score = _mean(ratios) * 100
    limiting = [
        f"{c['name']} ({c.get('salinity_tolerance_ece_ds_m')} dS/m)"
        for c in crops
        if float(c.get("salinity_tolerance_ece_ds_m") or 0) < ec
    ]
    reasons = [
        f"Field EC {ec:g} dS/m compared with each crop's approximate ECe threshold.",
        (
            f"Below threshold: {', '.join(limiting)}."
            if limiting
            else "All selected crops have thresholds at or above the stated EC."
        ),
    ]
    return round(score, 1), reasons, True


def _climate_score(
    crops: list[dict[str, Any]], climate: dict[str, Any] | None
) -> tuple[float, list[str], bool]:
    heat_pressure, drought_pressure, pressure_note = _climate_pressures(climate)
    heat_values = [float(c.get("heat_tolerance") or 0) / 5 for c in crops]
    drought_values = [float(c.get("drought_tolerance") or 0) / 5 for c in crops]
    heat_mean = _mean(heat_values) or 0
    drought_mean = _mean(drought_values) or 0
    if heat_pressure is None or drought_pressure is None:
        score = (heat_mean * 0.5 + drought_mean * 0.5) * 100
        reasons = [
            "No usable NASA POWER climate context: score is the mean crop heat/drought trait only.",
            f"Heat tolerance {heat_mean * 5:.1f}/5, drought tolerance {drought_mean * 5:.1f}/5.",
        ]
        return round(score, 1), reasons, False
    # Each pressure scales how much of the tolerance shortfall is exposed:
    # no stress → no shortfall; maximum stress → full trait shortfall.
    heat_component = 1 - heat_pressure * (1 - heat_mean)
    drought_component = 1 - drought_pressure * (1 - drought_mean)
    score = (heat_component + drought_component) / 2 * 100
    reasons = [
        pressure_note,
        f"Crop heat tolerance {heat_mean * 5:.1f}/5 → component {heat_component * 100:.1f}; "
        f"drought tolerance {drought_mean * 5:.1f}/5 → component {drought_component * 100:.1f}.",
    ]
    return round(_clamp(score), 1), reasons, True


def _soil_score(crops: list[dict[str, Any]], soil: dict[str, Any]) -> tuple[float, list[str]]:
    cover = [COVER_LEVEL.get(c.get("soil_cover"), 1) for c in crops]
    residue = [RESIDUE_LEVEL.get(c.get("residue"), 1) for c in crops]
    mean_level = (sum(cover) + sum(residue)) / (len(cover) + len(residue))
    score = (mean_level - 1) / 2 * 100
    reasons = [
        f"Mean cover/residue level {mean_level:.2f} on a 1–3 scale "
        f"(cover {', '.join(str(v) for v in cover)}; residue {', '.join(str(v) for v in residue)})."
    ]
    om = soil.get("organic_matter_pct")
    if om is not None:
        try:
            om_value = float(om)
        except (TypeError, ValueError):
            om_value = None
        if om_value is not None and om_value < 1.0:
            bonus = _mean([value - 1 for value in residue]) * 8
            score += min(10, max(0, bonus))
            reasons.append(
                f"Organic matter {om_value:g}% (<1%): up to +10 points for residue cover on a "
                "depleted soil (qualitative rule)."
            )
    return round(_clamp(score), 1), reasons


def _diversity_score(crops: list[dict[str, Any]]) -> tuple[float, list[str]]:
    n = len(crops)
    families = [c.get("family") for c in crops]
    unique_families = len(set(families))
    legumes = sum(1 for c in crops if c.get("n_fixation"))
    legume_share = legumes / n

    # Ideal legume share is 20–50%; score falls smoothly outside it.
    if 0.2 <= legume_share <= 0.5:
        legume_score = 100.0
    elif legume_share == 0:
        legume_score = 20.0
    else:
        legume_score = _clamp(100 - abs(legume_share - 0.35) * 200)

    family_score = unique_families / n * 100
    adjacent_same_family = sum(1 for a, b in zip(families, families[1:]) if a == b)

    seasons = [c.get("cycle") for c in crops]
    adjacent_same_season = sum(
        1 for a, b in zip(seasons, seasons[1:]) if a == b and a in {"winter", "summer"}
    )

    score = (legume_score * 0.40 + family_score * 0.40) / 0.8
    score -= adjacent_same_family * 12 + adjacent_same_season * 10

    reasons = [
        f"{legumes}/{n} crops fix nitrogen (share {legume_share:.0%}; ideal 20–50%).",
        f"{unique_families}/{n} distinct crop families.",
        (
            f"{adjacent_same_family} adjacent same-family pair(s): −12 each."
            if adjacent_same_family
            else "No adjacent same-family pair."
        ),
        (
            f"{adjacent_same_season} adjacent same-season pair(s): −10 each."
            if adjacent_same_season
            else "Winter/summer seasons alternate."
        ),
    ]
    return round(_clamp(score), 1), reasons


def _factor(
    key: str,
    score: float | None,
    reasons: list[str],
    *,
    uncertainty: float,
    data_quality: str,
) -> dict[str, Any]:
    return {
        "id": key,
        "label": FACTORS[key]["label"],
        "score": score,
        "unit": FACTORS[key]["unit"],
        "question": FACTORS[key]["question"],
        "method": FACTORS[key]["method"],
        "source": FACTORS[key]["source"],
        "reasons": reasons,
        "uncertainty_points": round(uncertainty, 1),
        "data_quality": data_quality,
    }


def _risk_flags(factors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Surface factors below 50/100 as a short, non-predictive watch list."""
    flags = []
    for factor in factors:
        score = factor.get("score")
        if score is None or score >= 50:
            continue
        flags.append(
            {
                "id": factor["id"],
                "label": RISK_FLAG_LABELS[factor["id"]],
                "score": score,
                "detail": RISK_FLAG_DETAIL[factor["id"]],
            }
        )
    return flags


def _next_checks(
    soil: dict[str, Any], climate: dict[str, Any] | None
) -> list[dict[str, str]]:
    checks: list[dict[str, str]] = []
    if soil.get("ec_ds_m") in (None, ""):
        checks.append(
            {
                "id": "salinity",
                "label": "Add a measured soil EC (dS/m)",
                "reason": "Salinity fit is currently using reference thresholds only, so confidence is lower.",
            }
        )
    if soil.get("organic_matter_pct") in (None, ""):
        checks.append(
            {
                "id": "organic_matter",
                "label": "Add soil organic matter (%)",
                "reason": "The soil-protection factor cannot use the depleted-soil residue rule without it.",
            }
        )
    if not soil.get("water_source") or not soil.get("irrigation_method"):
        checks.append(
            {
                "id": "water_context",
                "label": "State the water source and irrigation method",
                "reason": "Water balance currently cannot distinguish canal, groundwater, rainfed or drip systems.",
            }
        )
    if not climate:
        checks.append(
            {
                "id": "climate",
                "label": "Load a NASA POWER climate context",
                "reason": "Without it, the climate-resilience factor uses crop traits only.",
            }
        )
    elif (climate.get("completeness_pct") or 0) < 85:
        checks.append(
            {
                "id": "climate_gaps",
                "label": "Review the missing NASA POWER days",
                "reason": "Climate-context completeness is below 85%, which lowers confidence in the climate factor.",
            }
        )
    if not checks:
        checks.append(
            {
                "id": "verify",
                "label": "Verify the shortlist with local extension advice",
                "reason": "Inputs are complete, but reference traits cannot replace local variety, market and water-allocation knowledge.",
            }
        )
    return checks[:4]


def _decision_brief(
    scored: list[dict[str, Any]],
    *,
    soil: dict[str, Any],
    climate: dict[str, Any] | None,
) -> dict[str, Any]:
    leader = scored[0]
    runner = scored[1] if len(scored) > 1 else None
    available = [factor for factor in leader["factors"] if factor.get("score") is not None]
    strongest = max(available, key=lambda factor: factor["contribution_points"])
    weakest = min(available, key=lambda factor: factor["contribution_points"])

    if runner is None:
        gap = None
        separation = "single scenario"
        interpretation = (
            "Only one scenario was scored, so no leader-to-runner comparison is available."
        )
    else:
        gap = round(leader["score"] - runner["score"], 1)
        leader_low = leader["range"]["low"]
        runner_high = runner["range"]["high"]
        runner_low = runner["range"]["low"]
        if leader_low > runner_high:
            separation = "separated"
            interpretation = (
                f"{leader['name']} leads by {gap} points, and its sensitivity band does not overlap "
                f"{runner['name']}'s. The order is more stable under the stated factor uncertainty, "
                "but the weights still control the ranking."
            )
        elif leader_low > runner_low:
            separation = "partly overlapping"
            interpretation = (
                f"{leader['name']} leads by {gap} points, but the two sensitivity bands partly overlap. "
                "Treat the order as indicative and test the weights rather than treating the gap as decisive."
            )
        else:
            separation = "overlapping"
            interpretation = (
                f"{leader['name']} leads by {gap} points, but the sensitivity bands overlap strongly. "
                "The data do not separate the two sequences under the stated uncertainty; use the factor "
                "explanations and local checks to decide what to investigate."
            )

    return {
        "leader_id": leader["scenario_id"],
        "leader_name": leader["name"],
        "runner_up_id": runner["scenario_id"] if runner else None,
        "runner_up_name": runner["name"] if runner else None,
        "gap_points": gap,
        "separation": separation,
        "interpretation": interpretation,
        "strongest_factor": {
            "id": strongest["id"],
            "label": strongest["label"],
            "score": strongest["score"],
            "contribution_points": strongest["contribution_points"],
        },
        "weakest_factor": {
            "id": weakest["id"],
            "label": weakest["label"],
            "score": weakest["score"],
            "contribution_points": weakest["contribution_points"],
        },
        "next_checks": _next_checks(soil, climate),
        "note": (
            "Band overlap is a sensitivity check on independent factor uncertainty. It is not a "
            "statistical confidence interval or a probability that one rotation will perform better."
        ),
    }


def score_scenario(
    scenario: dict[str, Any],
    *,
    soil: dict[str, Any] | None = None,
    climate: dict[str, Any] | None = None,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    soil = soil or {}
    normalised, weight_notes = normalize_weights(weights)
    crops = [_crop_or_error(crop_id) for crop_id in scenario["crops"]]

    water_score, water_reasons = _water_score(crops, soil)
    salinity_score, salinity_reasons, ec_known = _salinity_score(crops, soil)
    climate_score, climate_reasons, climate_known = _climate_score(crops, climate)
    soil_score, soil_reasons = _soil_score(crops, soil)
    diversity_score, diversity_reasons = _diversity_score(crops)

    factors = [
        _factor("water", water_score, water_reasons, uncertainty=8, data_quality="user inputs + reference traits"),
        _factor(
            "salinity",
            salinity_score,
            salinity_reasons,
            uncertainty=row_uncertainty(ec_known, 8, 20),
            data_quality="user EC + reference thresholds" if ec_known else "reference thresholds only",
        ),
        _factor(
            "climate",
            climate_score,
            climate_reasons,
            uncertainty=row_uncertainty(climate_known, 8, 16),
            data_quality="NASA POWER + reference traits" if climate_known else "reference traits only",
        ),
        _factor("soil", soil_score, soil_reasons, uncertainty=10, data_quality="reference traits + user organic matter"),
        _factor("diversity", diversity_score, diversity_reasons, uncertainty=5, data_quality="reference traits"),
    ]

    available = [factor for factor in factors if factor["score"] is not None]
    if not available:
        raise ValueError("No rotation factor could be calculated from the supplied inputs.")
    available_weight = sum(normalised[factor["id"]] for factor in available)
    # Re-normalise across available factors so missing data does not silently
    # reduce the score toward zero.
    total = sum(
        normalised[factor["id"]] * factor["score"] for factor in available
    ) / available_weight
    total = round(_clamp(total), 1)

    sigma = (
        sum(
            (
                normalised[factor["id"]] / available_weight
                * factor["uncertainty_points"]
            )
            ** 2
            for factor in available
        )
        ** 0.5
    )
    band = {
        "method": (
            "Independent factor-uncertainty propagation: sqrt(Σ(weight × factor uncertainty)²), "
            "displayed as an 80% sensitivity band (±1.28σ). This is a transparency device, not a "
            "statistical confidence interval calibrated against yields."
        ),
        "sigma_points": round(sigma, 1),
        "low": round(max(0, total - 1.28 * sigma), 1),
        "high": round(min(100, total + 1.28 * sigma), 1),
    }

    missing = [factor["id"] for factor in factors if factor["score"] is None]
    confidence_points = 0
    confidence_points += 2 if ec_known else 0
    confidence_points += 2 if climate_known else 0
    if soil.get("organic_matter_pct") is not None:
        confidence_points += 1
    if soil.get("water_source") and soil.get("irrigation_method"):
        confidence_points += 1
    if missing:
        confidence_points -= 1
    confidence = "low" if confidence_points <= 2 else ("medium" if confidence_points <= 4 else "medium-high")

    for factor in factors:
        factor["weight_pct"] = normalised[factor["id"]]
        factor["contribution_points"] = (
            round(normalised[factor["id"]] * factor["score"] / 100, 1)
            if factor["score"] is not None
            else None
        )

    return {
        "scenario_id": scenario["id"],
        "name": scenario["name"],
        "summary": scenario["summary"],
        "rationale": scenario["rationale"],
        "caution": scenario["caution"],
        "crops": [
            {
                "id": crop["id"],
                "name": crop["name"],
                "name_ar": crop.get("name_ar"),
                "family": crop["family"],
                "role": crop.get("role"),
                "cycle": crop.get("cycle"),
                "n_fixation": crop.get("n_fixation"),
            }
            for crop in crops
        ],
        "score": total,
        "range": band,
        "confidence": confidence,
        "factors": factors,
        "risk_flags": _risk_flags(factors),
        "missing_factors": missing,
        "weights_normalised": normalised,
        "weight_notes": weight_notes,
        "disclaimer": (
            "Exploratory rule-based indicator, not a yield, profit, water-use or food-security "
            "prediction. Local trials, soil tests and extension advice take precedence."
        ),
    }


def row_uncertainty(known: bool, known_points: float, unknown_points: float) -> float:
    return known_points if known else unknown_points


def score_rotations(
    *,
    scenario_ids: list[str] | None = None,
    soil: dict[str, Any] | None = None,
    climate: dict[str, Any] | None = None,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    if scenario_ids:
        unknown = [sid for sid in scenario_ids if sid not in SCENARIO_MAP]
        if unknown:
            raise ValueError(f"Unknown scenario id(s): {', '.join(unknown)}.")
        scenarios = [SCENARIO_MAP[sid] for sid in scenario_ids]
    else:
        scenarios = SCENARIOS
    scored = [
        score_scenario(scenario, soil=soil, climate=climate, weights=weights)
        for scenario in scenarios
    ]
    scored.sort(key=lambda item: item["score"], reverse=True)
    best = scored[0]
    normalised, notes = normalize_weights(weights)
    return {
        "context": {
            "soil_fields_provided": sorted(
                key for key, value in (soil or {}).items() if value not in (None, "")
            ),
            "climate_provided": climate is not None,
            "climate": climate,
            "weights_requested": weights or DEFAULT_WEIGHTS,
            "weights_normalised": normalised,
            "weight_notes": notes,
        },
        "scenarios": scored,
        "briefing": _decision_brief(scored, soil=soil or {}, climate=climate),
        "best_scenario_id": best["scenario_id"],
        "ranking_note": (
            "Ranking is produced by the configured weights. Change the weights to see how "
            "sensitive the order is; a small score gap is not a decisive recommendation."
        ),
        "disclaimer": (
            "Rule-based exploratory comparison only. Scores are not probabilities, yields or "
            "financial forecasts, and the underlying crop traits are reference ranges."
        ),
    }
