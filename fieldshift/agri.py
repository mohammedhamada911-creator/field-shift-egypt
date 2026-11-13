"""Egyptian agricultural reference data and transparent soil interpretation."""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from .config import DATA_DIR
from .geo import locate_governorate

CROPS_FILE = DATA_DIR / "crops_egypt.json"
AGRI_FILE = DATA_DIR / "egypt_agriculture.json"

SOURCES = {
    "fao56": {
        "name": "FAO Irrigation and Drainage Paper 56 — Crop evapotranspiration",
        "url": "https://www.fao.org/3/x0490e/x0490e00.htm",
    },
    "fao29": {
        "name": "FAO Irrigation and Drainage Paper 29 — Water quality for agriculture",
        "url": "https://www.fao.org/3/t0234e/t0234e00.htm",
    },
    "fao_ecocrop": {"name": "FAO EcoCrop", "url": "https://ecocrop.fao.org/"},
    "fao_aquastat": {
        "name": "FAO AQUASTAT — Egypt",
        "url": "https://www.fao.org/aquastat/en/databases/countries/egy",
    },
    "usda_fas": {"name": "USDA FAS — Egypt", "url": "https://www.fas.usda.gov/countries/egypt"},
    "moa": {"name": "Egypt Ministry of Agriculture and Land Reclamation", "url": "https://www.moa.gov.eg/"},
}

TEXTURES = {
    "sand": {
        "label": "Sand",
        "water_holding": "very low",
        "drainage": "excessively drained",
        "note": "Low water-holding capacity and low nutrient retention; prone to drought stress and wind erosion.",
    },
    "loamy_sand": {
        "label": "Loamy sand",
        "water_holding": "low",
        "drainage": "well drained",
        "note": "Easy to work and drains quickly; requires frequent, smaller irrigation applications.",
    },
    "sandy_loam": {
        "label": "Sandy loam",
        "water_holding": "low to moderate",
        "drainage": "well drained",
        "note": "Common in reclaimed desert areas; moderate workability but limited organic matter and water storage.",
    },
    "loam": {
        "label": "Loam",
        "water_holding": "moderate",
        "drainage": "well drained",
        "note": "Balanced texture with good workability and moderate water and nutrient retention.",
    },
    "silt_loam": {
        "label": "Silt loam",
        "water_holding": "moderate to high",
        "drainage": "moderately well drained",
        "note": "Good water retention; surface crusting and compaction risk if cultivated when wet.",
    },
    "clay_loam": {
        "label": "Clay loam",
        "water_holding": "high",
        "drainage": "moderately drained",
        "note": "High water and nutrient retention; susceptible to compaction and waterlogging where drainage is poor.",
    },
    "clay": {
        "label": "Clay",
        "water_holding": "very high",
        "drainage": "slowly drained",
        "note": "High retention but narrow workable moisture window; drainage and salinity management are critical.",
    },
    "calcareous_sandy_loam": {
        "label": "Calcareous sandy loam",
        "water_holding": "low",
        "drainage": "well drained",
        "note": "Calcareous desert-fringe soil; low organic matter, high pH buffering and micronutrient availability concerns.",
    },
    "saline_clay": {
        "label": "Saline clay",
        "water_holding": "high",
        "drainage": "poor",
        "note": "High clay content with salinity risk; requires drainage and salinity assessment before cropping decisions.",
    },
}

DRAINAGE = {
    "well": {"label": "Well drained", "note": "No obvious drainage limitation reported by the user."},
    "moderate": {"label": "Moderately drained", "note": "Some risk of short-term waterlogging after heavy irrigation or rain."},
    "poor": {"label": "Poorly drained", "note": "Waterlogging and salinity risk; a field drainage assessment is important."},
    "excessive": {"label": "Excessively drained", "note": "Fast drainage and low water retention; smaller, more frequent irrigation may be needed."},
    "unknown": {"label": "Not provided", "note": "Drainage has not been assessed; no drainage conclusion is drawn."},
}


@lru_cache(maxsize=1)
def crops_document() -> dict[str, Any]:
    with CROPS_FILE.open("r", encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def agriculture_document() -> dict[str, Any]:
    with AGRI_FILE.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def crop_list() -> list[dict[str, Any]]:
    return list(crops_document().get("crops", []))


def crop_map() -> dict[str, dict[str, Any]]:
    return {crop["id"]: crop for crop in crop_list()}


def get_crop(crop_id: str) -> dict[str, Any] | None:
    return crop_map().get(crop_id)


def governorate_reference(name: str | None, *, latitude: float | None = None, longitude: float | None = None) -> dict[str, Any] | None:
    doc = agriculture_document()
    governorate_name = name
    if not governorate_name and latitude is not None and longitude is not None:
        detected = locate_governorate(latitude, longitude)
        governorate_name = detected["name"] if detected else None
    if not governorate_name:
        return None
    governorate = doc["governorates"].get(governorate_name)
    if not governorate:
        return None
    region = doc["regions"].get(governorate.get("region"), {})
    crops = []
    for crop_id in governorate.get("dominant_crops", []):
        crop = get_crop(crop_id)
        if crop:
            crops.append(
                {
                    "id": crop["id"],
                    "name": crop["name"],
                    "name_ar": crop.get("name_ar"),
                    "role": crop.get("role"),
                    "cycle": crop.get("cycle"),
                }
            )
    return {
        "governorate": governorate_name,
        "source_type": "reference dataset",
        "disclaimer": doc["meta"]["disclaimer"],
        "region": {
            "id": governorate.get("region"),
            "label": region.get("label"),
            "soil_summary": region.get("soil_summary"),
            "water_context": region.get("water_context"),
            "rotation_note": region.get("rotation_note"),
        },
        "dominant_crops": crops,
        "confidence": governorate.get("confidence", "regional synthesis"),
        "soil_summary": governorate.get("soil_summary"),
        "water_context": governorate.get("water_context"),
        "pilot_note": governorate.get("pilot_note"),
        "sources": doc["meta"]["sources"],
        "meta": doc["meta"],
    }


def _num(value: Any, minimum: float, maximum: float) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number < minimum or number > maximum:  # NaN or out of range
        return None
    return number


def classify_ph(value: float | None) -> dict[str, Any]:
    if value is None:
        return {"class": "not provided", "meaning": "No pH value supplied; no pH conclusion is drawn.", "flag": None}
    if value < 5.5:
        return {"class": "strongly acidic", "meaning": "Below the usual range for most Egyptian field soils; aluminium/manganese toxicity and nutrient availability should be checked.", "flag": "high"}
    if value < 6.5:
        return {"class": "slightly acidic", "meaning": "Slightly below neutral; most nutrients remain available, but molybdenum and some micronutrients may be less available.", "flag": "moderate"}
    if value <= 7.5:
        return {"class": "near neutral", "meaning": "Favourable range for many crops and soil organisms.", "flag": "low"}
    if value <= 8.5:
        return {"class": "alkaline", "meaning": "Common in calcareous Egyptian soils; iron, zinc and phosphorus availability can be reduced.", "flag": "moderate"}
    return {"class": "strongly alkaline", "meaning": "High pH; micronutrient availability and soil structure can be constrained. Verify with a soil test.", "flag": "high"}


def classify_organic_matter(value: float | None) -> dict[str, Any]:
    if value is None:
        return {"class": "not provided", "meaning": "No organic-matter value supplied; no conclusion is drawn.", "flag": None}
    if value < 0.5:
        return {"class": "very low", "meaning": "Very low organic matter; poor aggregate stability, low nutrient buffering and high erosion risk are common.", "flag": "high"}
    if value < 1.0:
        return {"class": "low", "meaning": "Low organic matter, typical of many intensively cropped Egyptian soils.", "flag": "moderate"}
    if value < 2.0:
        return {"class": "moderate", "meaning": "Moderate organic-matter level for a mineral field soil.", "flag": "low"}
    if value < 4.0:
        return {"class": "high", "meaning": "High organic-matter level for mineral soil; structure and water retention are likely better.", "flag": "low"}
    return {"class": "very high", "meaning": "Very high organic matter; confirm whether the sample is mineral soil or contains organic amendments/peat.", "flag": "moderate"}


def classify_salinity(value: float | None) -> dict[str, Any]:
    if value is None:
        return {"class": "not provided", "meaning": "No electrical conductivity value supplied; salinity is not assessed.", "flag": None}
    if value < 2:
        return {"class": "non-saline", "meaning": "Below the usual threshold for salinity-affected soils (ECe 4 dS/m in saturated paste; this field uses the user's EC value as supplied).", "flag": "low"}
    if value < 4:
        return {"class": "slightly saline", "meaning": "Sensitive crops may begin to show effects; confirm whether the value is ECe, EC 1:5 or another method.", "flag": "moderate"}
    if value < 8:
        return {"class": "moderately saline", "meaning": "Many sensitive crops are affected; tolerant crops may still perform. Method and units matter.", "flag": "high"}
    if value < 16:
        return {"class": "strongly saline", "meaning": "Only tolerant crops are likely to remain viable; drainage and salinity management require specialist advice.", "flag": "high"}
    return {"class": "very strongly saline", "meaning": "Severe salinity constraint. Do not make cropping decisions without a laboratory assessment and local advice.", "flag": "high"}


def soil_interpretation(payload: dict[str, Any]) -> dict[str, Any]:
    texture_id = payload.get("texture") or "unknown"
    if texture_id not in TEXTURES and texture_id != "unknown":
        raise ValueError(f"Unknown soil texture {texture_id!r}")
    texture = TEXTURES.get(texture_id)
    drainage_id = payload.get("drainage") or "unknown"
    drainage = DRAINAGE.get(drainage_id, DRAINAGE["unknown"])

    ph = _num(payload.get("ph"), 3, 11)
    om = _num(payload.get("organic_matter_pct"), 0, 20)
    ec = _num(payload.get("ec_ds_m"), 0, 100)

    ph_class = classify_ph(ph)
    om_class = classify_organic_matter(om)
    ec_class = classify_salinity(ec)

    interpretations = [
        {
            "factor": "pH",
            "source_type": "user input → calculated class",
            "value": ph,
            "unit": "pH units",
            "class": ph_class["class"],
            "meaning": ph_class["meaning"],
            "flag": ph_class["flag"],
            "method": "pH bands: <5.5 strongly acidic; 5.5–6.5 slightly acidic; 6.5–7.5 near neutral; 7.5–8.5 alkaline; >8.5 strongly alkaline.",
            "source": SOURCES["fao56"],
        },
        {
            "factor": "Organic matter",
            "source_type": "user input → calculated class",
            "value": om,
            "unit": "%",
            "class": om_class["class"],
            "meaning": om_class["meaning"],
            "flag": om_class["flag"],
            "method": "Bands: <0.5 very low; 0.5–1 low; 1–2 moderate; 2–4 high; >4 very high.",
            "source": SOURCES["fao56"],
        },
        {
            "factor": "Salinity (EC)",
            "source_type": "user input → calculated class",
            "value": ec,
            "unit": "dS/m (user-supplied method)",
            "class": ec_class["class"],
            "meaning": ec_class["meaning"],
            "flag": ec_class["flag"],
            "method": "Indicative bands: <2 non-saline; 2–4 slightly saline; 4–8 moderately saline; 8–16 strongly saline; ≥16 very strongly saline. Confirm the laboratory method.",
            "source": SOURCES["fao29"],
        },
        {
            "factor": "Texture and water retention",
            "source_type": "user input → reference lookup",
            "value": texture_id,
            "unit": "",
            "class": texture["label"] if texture else "not provided",
            "meaning": texture["note"] if texture else "No texture was supplied; no water-holding or drainage conclusion is drawn.",
            "flag": "low" if texture_id in {"loam", "silt_loam", "clay_loam"} else ("moderate" if texture else None),
            "method": "Texture classes follow the USDA textural triangle; descriptions are qualitative, not a water-retention measurement.",
            "source": SOURCES["fao56"],
        },
        {
            "factor": "Drainage",
            "source_type": "user input",
            "value": drainage_id,
            "unit": "",
            "class": "not provided" if drainage_id == "unknown" else drainage["label"],
            "meaning": drainage["note"],
            "flag": "high" if drainage_id == "poor" else ("moderate" if drainage_id == "moderate" else None),
            "method": "Based on the farmer's field observation; not a measured drainage class.",
            "source": None,
        },
    ]

    flags = [item["flag"] for item in interpretations if item["flag"] in {"moderate", "high"}]
    provided = sum(1 for item in (ph, om, ec, texture, drainage_id != "unknown") if item)
    confidence = "low" if provided <= 2 else ("medium" if provided <= 4 else "medium-high")

    warnings = [
        "This is an educational interpretation of user-entered values, not a laboratory report.",
        "Salinity interpretation depends on the laboratory method (ECe saturated paste vs EC 1:5). Confirm the method before comparing with crop thresholds.",
        "No amendment, fertilizer or irrigation prescription is generated. Consult the local agricultural directorate and a soil laboratory.",
    ]
    if provided < 5:
        warnings.append("One or more inputs are missing; absent values remain absent and are not replaced with defaults.")

    return {
        "ok": True,
        "source_type": "calculated indicators from user inputs",
        "inputs_echo": {
            "texture": texture_id,
            "ph": ph,
            "organic_matter_pct": om,
            "ec_ds_m": ec,
            "drainage": drainage_id,
        },
        "interpretations": interpretations,
        "summary": {
            "provided_fields": provided,
            "total_fields": 5,
            "confidence": confidence,
            "flags": sorted(set(flags)),
        },
        "warnings": warnings,
        "sources": [SOURCES["fao56"], SOURCES["fao29"]],
    }


def crops_public() -> dict[str, Any]:
    doc = crops_document()
    return {
        "meta": doc["meta"],
        "crops": doc["crops"],
        "count": len(doc["crops"]),
    }


# ---------------------------------------------------------------------------
# Crop compatibility (documented crop traits vs. documented farm context)
# ---------------------------------------------------------------------------

# The maximum crop water-demand level that each stated availability can carry.
# Levels are the 1–5 scale already stored in crops_egypt.json.
WATER_AVAILABILITY_CAP = {
    "abundant": 5,
    "sufficient": 4,
    "limited": 3,
    "scarce": 2,
    "rainfed": 1,
}

COMPATIBILITY_THRESHOLDS = {"high": 70, "moderate": 45}


def _compat_level(score: float | None) -> str:
    if score is None:
        return "insufficient"
    if score >= COMPATIBILITY_THRESHOLDS["high"]:
        return "high"
    if score >= COMPATIBILITY_THRESHOLDS["moderate"]:
        return "moderate"
    return "low"


def _clamp_score(value: float) -> float:
    return max(0.0, min(100.0, value))


def _water_dimension(crop: dict[str, Any], availability: str | None) -> dict[str, Any]:
    demand = crop.get("water_demand_level")
    cap = WATER_AVAILABILITY_CAP.get(str(availability or "").lower())
    demand = float(demand) if demand is not None else None
    if demand is None or cap is None:
        return {
            "id": "water",
            "known": False,
            "score": None,
            "level": "insufficient",
            "reason": "compat.reason.water_unknown",
            "params": {
                "demand": demand,
                "availability": availability or "unknown",
            },
        }
    score = _clamp_score(100 - max(0.0, demand - cap) * 35)
    if demand <= cap:
        reason = "compat.reason.water_fits"
    elif demand == cap + 1:
        reason = "compat.reason.water_tight"
    else:
        reason = "compat.reason.water_exceeds"
    return {
        "id": "water",
        "known": True,
        "score": round(score, 1),
        "level": _compat_level(score),
        "reason": reason,
        "params": {"demand": demand, "cap": cap, "availability": availability},
    }


def _salinity_dimension(crop: dict[str, Any], soil: dict[str, Any]) -> dict[str, Any]:
    tolerance = crop.get("salinity_tolerance_ece_ds_m")
    ec = soil.get("ec_ds_m")
    tolerance = float(tolerance) if tolerance is not None else None
    ec = float(ec) if isinstance(ec, (int, float)) and not isinstance(ec, bool) else None
    if tolerance is None:
        return {
            "id": "salinity",
            "known": False,
            "score": None,
            "level": "insufficient",
            "reason": "compat.reason.salinity_no_crop_threshold",
            "params": {"ec": ec},
        }
    if ec is None:
        return {
            "id": "salinity",
            "known": False,
            "score": None,
            "level": "insufficient",
            "reason": "compat.reason.salinity_no_ec",
            "params": {"tolerance": tolerance},
        }
    ratio = tolerance / ec if ec > 0 else 1.0
    score = _clamp_score(ratio * 100)
    if ratio >= 1:
        reason = "compat.reason.salinity_within"
    elif ratio >= 0.8:
        reason = "compat.reason.salinity_near"
    else:
        reason = "compat.reason.salinity_exceeds"
    return {
        "id": "salinity",
        "known": True,
        "score": round(score, 1),
        "level": _compat_level(score),
        "reason": reason,
        "params": {"tolerance": tolerance, "ec": ec, "ratio": round(ratio, 2)},
    }


def _climate_dimension(crop: dict[str, Any], climate: dict[str, Any] | None) -> dict[str, Any]:
    heat_tolerance = crop.get("heat_tolerance")
    drought_tolerance = crop.get("drought_tolerance")
    days = int((climate or {}).get("period_days") or 0)
    heat_days = (climate or {}).get("heat_days_35c")
    rain_total = (climate or {}).get("rain_total_mm")
    if (
        not climate
        or not days
        or heat_days is None
        or heat_tolerance is None
        or drought_tolerance is None
    ):
        return {
            "id": "climate",
            "known": False,
            "score": None,
            "level": "insufficient",
            "reason": "compat.reason.climate_unknown",
            "params": {},
        }
    heat_fraction = float(heat_days) / days
    heat_pressure = max(0.0, min(1.0, heat_fraction / 0.30))
    if rain_total is None:
        drought_pressure = 0.6
    else:
        drought_pressure = max(0.0, min(1.0, 1 - (float(rain_total) / max(1.0, days))))
    heat_component = 1 - heat_pressure * (1 - float(heat_tolerance) / 5)
    drought_component = 1 - drought_pressure * (1 - float(drought_tolerance) / 5)
    score = _clamp_score((heat_component + drought_component) / 2 * 100)
    if score >= COMPATIBILITY_THRESHOLDS["high"]:
        reason = "compat.reason.climate_fits"
    elif score >= COMPATIBILITY_THRESHOLDS["moderate"]:
        reason = "compat.reason.climate_moderate"
    else:
        reason = "compat.reason.climate_stress"
    return {
        "id": "climate",
        "known": True,
        "score": round(score, 1),
        "level": _compat_level(score),
        "reason": reason,
        "params": {
            "heat_days": heat_days,
            "period_days": days,
            "rain_total_mm": rain_total,
        },
    }


def crop_compatibility(
    crop: dict[str, Any],
    *,
    soil: dict[str, Any] | None = None,
    climate: dict[str, Any] | None = None,
    water_availability: str | None = None,
) -> dict[str, Any]:
    """Compare documented crop traits with the supplied farm context.

    Only three dimensions are scored: water availability, soil salinity and
    recent heat/rain context. Soil texture, pH and organic matter have no
    crop-specific thresholds in the reference dataset, so they are never
    silently converted into a suitability claim.
    """
    soil = soil or {}
    dimensions = [
        _water_dimension(crop, water_availability),
        _salinity_dimension(crop, soil),
        _climate_dimension(crop, climate),
    ]
    known = [item for item in dimensions if item["known"]]
    missing = [item["id"] for item in dimensions if not item["known"]]
    if len(known) < 2:
        score = None
        level = "insufficient"
    else:
        score = round(sum(item["score"] for item in known) / len(known), 1)
        level = _compat_level(score)
    return {
        "crop_id": crop.get("id"),
        "crop_name": crop.get("name"),
        "name_ar": crop.get("name_ar"),
        "level": level,
        "score": score,
        "dimensions": dimensions,
        "missing_dimensions": missing,
        "basis": (
            "Mean of the dimensions that have documented inputs (at least two). "
            "No score is produced when fewer than two dimensions are known. "
            "Soil texture, pH and organic matter are not scored because the crop "
            "dataset has no crop-specific thresholds for them."
        ),
    }


def compatibility_report(
    *,
    soil: dict[str, Any] | None = None,
    climate: dict[str, Any] | None = None,
    water_availability: str | None = None,
    crop_ids: list[str] | None = None,
) -> dict[str, Any]:
    if water_availability and water_availability not in WATER_AVAILABILITY_CAP:
        raise ValueError(f"Unknown water availability {water_availability!r}")
    crop_lookup = crop_map()
    if crop_ids:
        unknown = sorted(set(crop_ids) - set(crop_lookup))
        if unknown:
            raise ValueError(f"Unknown crop id(s): {', '.join(unknown)}")
        selected = [crop_lookup[crop_id] for crop_id in crop_ids]
    else:
        selected = crop_list()
    results = [
        crop_compatibility(
            crop,
            soil=soil,
            climate=climate,
            water_availability=water_availability,
        )
        for crop in selected
    ]
    return {
        "ok": True,
        "results": results,
        "count": len(results),
        "levels": {
            "high": "Documented traits match the supplied context well",
            "moderate": "Partly suitable; check the listed reasons",
            "low": "At least one documented requirement conflicts with the context",
            "insufficient": "Too little documented information for a comparison",
        },
        "source_type": "calculated indicator from reference crop traits and user context",
        "disclaimer": (
            "This is a documented-trait comparison, not a yield, profit or sowing "
            "recommendation. Variety, local trials and extension advice take precedence."
        ),
    }
