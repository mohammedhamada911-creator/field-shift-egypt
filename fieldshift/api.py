"""HTTP API for the Field Shift Egypt decision-support prototype."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from io import BytesIO

from flask import Blueprint, jsonify, request, send_file

from .config import (
    APP_NAME,
    APP_VERSION,
    DEFAULT_LOCATION,
    DEFAULT_POWER_PARAMS,
    POWER_COMMUNITY,
    POWER_DAILY_URL,
    POWER_DOCS_URL,
    POWER_PARAMETERS,
)
from .agri import (
    TEXTURES,
    compatibility_report,
    crop_list,
    crops_public,
    governorate_reference,
    soil_interpretation,
)
from .errors import FieldShiftError, InvalidCoordinates, InvalidParameter, NotFound
from .geo import governorate_list, location_context
from .power import resolve_period, validate_coordinates
from .rotation import (
    DEFAULT_WEIGHTS,
    FACTORS,
    SCENARIOS,
    climate_context_from_envelope,
    score_rotations,
)
from .satellites import SOURCES, all_status, fetch_imagery, gibs_layer_dates, worldview_url
from .service import climate_query
from .storage import get_storage

log = logging.getLogger(__name__)
api = Blueprint("api", __name__, url_prefix="/api")

DISCLAIMER = (
    "Prototype decision support only. NASA POWER values are grid-cell climate estimates, not on-farm "
    "measurements. Crop and soil guidance must be checked with local extension specialists. "
    "NASA does not endorse this application."
)


@api.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "status": "healthy",
            "app": APP_NAME,
            "version": APP_VERSION,
            "time_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    )


@api.get("/meta")
def meta():
    return jsonify(
        {
            "ok": True,
            "app": {"name": APP_NAME, "version": APP_VERSION, "scope": "Egypt-focused MVP, Sohag pilot"},
            "default_location": DEFAULT_LOCATION,
            "disclaimer": DISCLAIMER,
            "sources": {
                "nasa_power": {
                    "name": "NASA POWER — Daily Point API (Agroclimatology)",
                    "url": "https://power.larc.nasa.gov/",
                    "api_url": POWER_DAILY_URL,
                    "documentation_url": POWER_DOCS_URL,
                    "community": POWER_COMMUNITY,
                    "time_standard": "LST",
                    "dataset_type": "Assimilated / model-derived daily climate data",
                    "spatial_resolution": "0.5° × 0.5° grid cells for the daily point API",
                    "temporal_coverage": "1981-01-01 to near real time (several days latency)",
                    "variables": {
                        key: {
                            "label": value["label"],
                            "unit": value["unit"],
                            "description": value["description"],
                        }
                        for key, value in POWER_PARAMETERS.items()
                    },
                }
            },
            "missing_data_policy": "Missing or fill values are returned as null and are never replaced with zero.",
        }
    )


@api.get("/governorates")
def governorates():
    items = governorate_list()
    return jsonify({"ok": True, "count": len(items), "governorates": items})


@api.get("/location")
def location():
    try:
        lat = request.args.get("lat")
        lon = request.args.get("lon")
        if lat is None or lon is None:
            raise InvalidCoordinates("Both lat and lon query parameters are required.")
        latitude, longitude = validate_coordinates(lat, lon)
    except FieldShiftError as exc:
        return jsonify(exc.to_dict()), exc.status_code
    return jsonify({"ok": True, "location": location_context(latitude, longitude)})


@api.get("/power")
def power():
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if lat is None or lon is None:
        exc = InvalidCoordinates(
            "Both lat and lon query parameters are required.",
            hint=f"Example: /api/power?lat={DEFAULT_LOCATION['latitude']}&lon={DEFAULT_LOCATION['longitude']}",
        )
        return jsonify(exc.to_dict()), exc.status_code

    params = request.args.get("params")
    requested_params = [item.strip() for item in params.split(",") if item.strip()] if params else None

    try:
        days = int(request.args.get("days", "90"))
    except ValueError:
        exc = FieldShiftError("days must be an integer.")
        exc.status_code = 400
        exc.code = "invalid_parameter"
        return jsonify(exc.to_dict()), 400
    days = max(7, min(days, 366))

    try:
        result = climate_query(
            lat,
            lon,
            start=request.args.get("start"),
            end=request.args.get("end"),
            days=days,
            parameters=requested_params,
            refresh=request.args.get("refresh") in {"1", "true", "yes"},
        )
        result["location"].update(location_context(**{
            "latitude": result["location"]["requested_latitude"],
            "longitude": result["location"]["requested_longitude"],
        }))
        result["disclaimer"] = DISCLAIMER
        if request.args.get("compact") in {"1", "true", "yes"}:
            # The farmer journey only needs summaries, indicators and provenance.
            # The technical workspace keeps requesting the full daily series.
            result = dict(result)
            result.pop("series", None)
            result["compact"] = True
        return jsonify(result)
    except FieldShiftError as exc:
        log.warning("POWER request failed: %s (%s)", exc.message, exc.detail)
        return jsonify(exc.to_dict()), exc.status_code


@api.get("/power/period")
def power_period():
    """Validate a requested period without contacting NASA POWER."""
    try:
        start, end = resolve_period(request.args.get("start"), request.args.get("end"))
        return jsonify({"ok": True, "start": start.isoformat(), "end": end.isoformat()})
    except FieldShiftError as exc:
        return jsonify(exc.to_dict()), exc.status_code


@api.get("/satellite/status")
def satellite_status_route():
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if lat is None or lon is None:
        exc = InvalidCoordinates("Both lat and lon query parameters are required.")
        return jsonify(exc.to_dict()), 400
    try:
        latitude, longitude = validate_coordinates(lat, lon)
    except FieldShiftError as exc:
        return jsonify(exc.to_dict()), exc.status_code
    body = all_status(latitude, longitude)
    for item in body["sources"]:
        item["worldview_url"] = worldview_url(item["id"], latitude, longitude, day=item["gibs_imagery_date"])
    return jsonify(body)


@api.get("/satellite/sources")
def satellite_sources_route():
    return jsonify(
        {
            "ok": True,
            "sources": [
                {
                    key: value
                    for key, value in source.items()
                    if key
                    in {
                        "id", "short_name", "name", "provider", "spatial_resolution",
                        "temporal_coverage", "update_frequency", "variables", "units",
                        "docs_url", "doi", "gibs_layer", "cmr_short_name", "concept_id",
                    }
                }
                for source in SOURCES.values()
            ],
            "gibs_dates": gibs_layer_dates(),
            "access_note": (
                "Imagery and granule metadata are public. Quantitative values require "
                "a free NASA Earthdata Login and are not fabricated by this application."
            ),
        }
    )


@api.get("/satellite/image/<source_id>")
def satellite_image_route(source_id: str):
    if source_id not in SOURCES:
        exc = NotFound(f"Unknown satellite source {source_id!r}.")
        return jsonify(exc.to_dict()), 404
    try:
        latitude, longitude = validate_coordinates(request.args.get("lat"), request.args.get("lon"))
    except FieldShiftError as exc:
        return jsonify(exc.to_dict()), exc.status_code
    day = request.args.get("date")
    try:
        content, actual_day = fetch_imagery(source_id, latitude, longitude, day=day)
    except ValueError as exc:
        return (
            jsonify({"error": {"code": "invalid_satellite_request", "message": str(exc)}}),
            400,
        )
    except Exception as exc:
        log.warning("Satellite image failed: %s", exc)
        return (
            jsonify(
                {
                    "error": {
                        "code": "satellite_unavailable",
                        "message": "NASA GIBS imagery is temporarily unavailable.",
                        "detail": str(exc),
                    }
                }
            ),
            502,
        )
    response = send_file(BytesIO(content), mimetype="image/png", max_age=21600)
    response.headers["X-NASA-GIBS-Layer"] = SOURCES[source_id]["gibs_layer"]
    response.headers["X-Imagery-Date"] = actual_day
    response.headers["X-Data-Source"] = "NASA GIBS"
    return response


@api.get("/crops")
def crops_route():
    return jsonify({"ok": True, **crops_public()})


@api.get("/agri/reference")
def agri_reference_route():
    name = request.args.get("governorate")
    latitude = request.args.get("lat")
    longitude = request.args.get("lon")
    lat = lon = None
    if latitude is not None and longitude is not None:
        try:
            lat, lon = validate_coordinates(latitude, longitude)
        except FieldShiftError as exc:
            return jsonify(exc.to_dict()), exc.status_code
    reference = governorate_reference(name, latitude=lat, longitude=lon)
    if reference:
        reference["ok"] = True
        reference["available"] = True
        return jsonify(reference)
    return (
        jsonify(
            {
                "ok": True,
                "available": False,
                "governorate": name,
                "message": (
                    "No Egyptian governorate reference profile matched this location. "
                    "Egyptian crop/soil reference data are not applied outside Egypt."
                ),
                "source_type": "reference dataset",
            }
        ),
        200,
    )


@api.get("/rotations/scenarios")
def rotation_scenarios_route():
    return jsonify(
        {
            "ok": True,
            "scenarios": SCENARIOS,
            "factors": [
                {
                    "id": key,
                    "label": factor["label"],
                    "question": factor["question"],
                    "method": factor["method"],
                    "source": factor["source"],
                    "default_weight": factor["weight"],
                    "unit": factor["unit"],
                }
                for key, factor in FACTORS.items()
            ],
            "default_weights": DEFAULT_WEIGHTS,
            "weight_note": (
                "Weights are relative. They are normalised to 100; zero is allowed for a factor "
                "the user does not want to influence the comparison."
            ),
            "disclaimer": (
                "Scenarios are editable reference sequences scored by transparent rules. They are "
                "not recommendations, yield forecasts or financial advice."
            ),
        }
    )


@api.post("/rotations/score")
def rotation_score_route():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        exc = InvalidParameter("A JSON object with rotation inputs is required.")
        return jsonify(exc.to_dict()), exc.status_code

    soil = payload.get("soil") or {}
    if not isinstance(soil, dict):
        exc = InvalidParameter("soil must be an object or omitted.")
        return jsonify(exc.to_dict()), exc.status_code
    weights = payload.get("weights")
    if weights is not None and not isinstance(weights, dict):
        exc = InvalidParameter("weights must be an object keyed by factor id.")
        return jsonify(exc.to_dict()), exc.status_code
    scenario_ids = payload.get("scenario_ids")
    if scenario_ids is not None and (
        not isinstance(scenario_ids, list)
        or not all(isinstance(item, str) for item in scenario_ids)
    ):
        exc = InvalidParameter("scenario_ids must be an array of strings.")
        return jsonify(exc.to_dict()), exc.status_code

    climate = payload.get("climate")
    if climate is not None and not isinstance(climate, dict):
        exc = InvalidParameter("climate must be an object or omitted.")
        return jsonify(exc.to_dict()), exc.status_code

    days = payload.get("days", 90)
    try:
        days = int(days)
    except (TypeError, ValueError):
        exc = InvalidParameter("days must be a whole number between 30 and 365.")
        return jsonify(exc.to_dict()), exc.status_code
    if not 30 <= days <= 365:
        exc = InvalidParameter("days must be between 30 and 365.")
        return jsonify(exc.to_dict()), exc.status_code

    climate_warning = None
    climate_source = "caller-supplied context" if climate is not None else "not supplied"
    latitude = longitude = None
    if climate is None and (payload.get("lat") is not None or payload.get("lon") is not None):
        try:
            latitude, longitude = validate_coordinates(payload.get("lat"), payload.get("lon"))
        except FieldShiftError as exc:
            return jsonify(exc.to_dict()), exc.status_code
    if climate is None and latitude is not None and longitude is not None:
        try:
            envelope = climate_query(
                latitude,
                longitude,
                days=days,
                refresh=bool(payload.get("refresh", False)),
            )
            climate = climate_context_from_envelope(envelope)
            if climate is None:
                climate_warning = "NASA POWER returned no usable maximum-temperature values."
                climate_source = "not supplied"
            else:
                climate_source = "NASA POWER daily point data"
                climate["served_from_cache"] = envelope.get("served_from_cache")
        except FieldShiftError as exc:
            climate_warning = f"{exc.message} Rotation scoring continued without climate context."
            climate_source = "not supplied"
            log.warning("Rotation climate context unavailable: %s", exc)
        except Exception as exc:  # a scoring request must not fail because context failed
            climate_warning = (
                "NASA POWER climate context could not be retrieved; scoring continued without it."
            )
            climate_source = "not supplied"
            log.exception("Unexpected rotation climate-context failure: %s", exc)

    try:
        result = score_rotations(
            scenario_ids=scenario_ids,
            soil=soil,
            climate=climate,
            weights=weights,
        )
    except ValueError as exc:
        exc = InvalidParameter(str(exc))
        return jsonify(exc.to_dict()), exc.status_code

    result["ok"] = True
    result["climate_source"] = climate_source
    result["climate_warning"] = climate_warning
    result["climate_context"] = climate
    return jsonify(result)


@api.post("/crops/compatibility")
def crop_compatibility_route():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        exc = InvalidParameter("A JSON object with compatibility inputs is required.")
        return jsonify(exc.to_dict()), exc.status_code
    soil = payload.get("soil") or {}
    climate = payload.get("climate")
    if not isinstance(soil, dict):
        exc = InvalidParameter("soil must be an object or omitted.")
        return jsonify(exc.to_dict()), exc.status_code
    if climate is not None and not isinstance(climate, dict):
        exc = InvalidParameter("climate must be an object or omitted.")
        return jsonify(exc.to_dict()), exc.status_code
    crop_ids = payload.get("crop_ids")
    if crop_ids is not None and (
        not isinstance(crop_ids, list) or not all(isinstance(item, str) for item in crop_ids)
    ):
        exc = InvalidParameter("crop_ids must be an array of strings.")
        return jsonify(exc.to_dict()), exc.status_code
    try:
        report = compatibility_report(
            soil=soil,
            climate=climate,
            water_availability=payload.get("water_availability"),
            crop_ids=crop_ids,
        )
    except ValueError as exc:
        return jsonify(InvalidParameter(str(exc)).to_dict()), 400
    return jsonify(report)


@api.post("/soil/interpret")
def soil_interpret_route():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        exc = InvalidParameter("A JSON object with soil fields is required.")
        return jsonify(exc.to_dict()), 400
    try:
        result = soil_interpretation(payload)
        return jsonify(result)
    except ValueError as exc:
        return (
            jsonify({"error": {"code": "invalid_soil_input", "message": str(exc)}}),
            400,
        )


def _optional_number(payload: dict, key: str, minimum: float, maximum: float) -> float | None:
    value = payload.get(key)
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise InvalidParameter(
            f"{key} must be a number or left blank.",
            detail=f"Received {value!r}.",
        ) from exc
    if not minimum <= number <= maximum:
        raise InvalidParameter(
            f"{key} is outside the supported range.",
            detail=f"Expected {minimum}–{maximum}, received {number}.",
        )
    return number


@api.post("/farm/profile")
def save_farm_profile_route():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        exc = InvalidParameter("A JSON farm profile is required.")
        return jsonify(exc.to_dict()), 400
    try:
        latitude, longitude = validate_coordinates(payload.get("latitude"), payload.get("longitude"))
    except FieldShiftError as exc:
        return jsonify(exc.to_dict()), exc.status_code

    texture = payload.get("soil_texture") or None
    if texture and texture not in TEXTURES:
        exc = InvalidParameter("Unknown soil texture.", detail=f"Received {texture!r}.")
        return jsonify(exc.to_dict()), 400
    drainage = payload.get("drainage") or None
    if drainage and drainage not in {"well", "moderate", "poor", "excessive", "unknown"}:
        exc = InvalidParameter("Unknown drainage class.", detail=f"Received {drainage!r}.")
        return jsonify(exc.to_dict()), 400
    water_availability = payload.get("water_availability") or None
    if water_availability and water_availability not in {
        "abundant", "sufficient", "limited", "scarce", "rainfed"
    }:
        exc = InvalidParameter(
            "Unknown water availability.", detail=f"Received {water_availability!r}."
        )
        return jsonify(exc.to_dict()), 400

    name = str(payload.get("name") or "Unnamed farm").strip()[:120]
    notes = str(payload.get("notes") or "").strip()[:1000]
    current_crop = str(payload.get("current_crop") or "").strip()[:120] or None
    previous_crops = str(payload.get("previous_crops") or "").strip()[:300] or None
    context = location_context(latitude, longitude)
    governorate = context.get("governorate", {}).get("name") if context.get("governorate") else None

    profile = {
        "name": name,
        "latitude": latitude,
        "longitude": longitude,
        "governorate": governorate,
        "soil_texture": texture,
        "ph": _optional_number(payload, "ph", 3, 11),
        "organic_matter_pct": _optional_number(payload, "organic_matter_pct", 0, 20),
        "ec_ds_m": _optional_number(payload, "ec_ds_m", 0, 100),
        "drainage": drainage,
        "irrigation_method": str(payload.get("irrigation_method") or "")[:80] or None,
        "water_source": str(payload.get("water_source") or "")[:80] or None,
        "water_availability": water_availability,
        "area_feddan": _optional_number(payload, "area_feddan", 0.01, 100000),
        "current_crop": current_crop,
        "previous_crops": previous_crops,
        "notes": notes or None,
    }
    saved = get_storage().save_farm_profile(profile)
    saved["location"] = context
    saved["privacy_note"] = (
        "Saved in the local SQLite database on this server. It is not sent to NASA or any third party."
    )
    return jsonify({"ok": True, "profile": saved, "source_type": "user input"}), 201


@api.get("/farm/profiles")
def list_farm_profiles_route():
    try:
        limit = max(1, min(int(request.args.get("limit", "20")), 100))
    except ValueError:
        limit = 20
    return jsonify({"ok": True, "profiles": get_storage().list_farm_profiles(limit)})


@api.get("/farm/profile/latest")
def latest_farm_profile_route():
    profile = get_storage().latest_farm_profile()
    return jsonify({"ok": True, "profile": profile, "source_type": "user input"})


@api.post("/farm/analysis")
def save_farm_analysis_route():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        exc = InvalidParameter("A JSON analysis snapshot is required.")
        return jsonify(exc.to_dict()), 400
    snapshot = payload.get("payload")
    if not isinstance(snapshot, dict):
        exc = InvalidParameter("payload must be an object.")
        return jsonify(exc.to_dict()), 400
    try:
        latitude, longitude = validate_coordinates(
            payload.get("latitude"), payload.get("longitude")
        )
    except FieldShiftError as exc:
        return jsonify(exc.to_dict()), exc.status_code
    saved = get_storage().save_analysis(
        {
            "farm_key": payload.get("farm_key"),
            "farm_name": payload.get("farm_name"),
            "latitude": latitude,
            "longitude": longitude,
            "payload": snapshot,
        }
    )
    saved["ok"] = True
    saved["source_type"] = "user-saved analysis snapshot"
    return jsonify(saved), 201


@api.get("/farm/analyses")
def list_farm_analyses_route():
    try:
        limit = max(1, min(int(request.args.get("limit", "20")), 100))
    except ValueError:
        limit = 20
    farm_key = request.args.get("farm_key") or None
    return jsonify(
        {
            "ok": True,
            "analyses": get_storage().list_analyses(limit=limit, farm_key=farm_key),
        }
    )


@api.get("/storage/stats")
def storage_stats_route():
    return jsonify({"ok": True, "stats": get_storage().stats()})


@api.get("/storage/runs")
def storage_runs_route():
    try:
        limit = max(1, min(int(request.args.get("limit", "20")), 100))
    except ValueError:
        limit = 20
    return jsonify({"ok": True, "runs": get_storage().recent_runs(limit)})


@api.get("/storage/sources")
def storage_sources_route():
    return jsonify({"ok": True, "sources": get_storage().sources()})


@api.get("/storage/observations")
def storage_observations_route():
    return jsonify({"ok": True, "counts": get_storage().observation_counts()})


# Keep import used for the shared default parameter set in Phase 2 extensions.
_ = DEFAULT_POWER_PARAMS
