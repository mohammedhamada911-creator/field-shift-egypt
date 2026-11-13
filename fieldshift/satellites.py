"""NASA satellite-source integration (SMAP, GPM IMERG, MODIS).

Two access paths are deliberately separated:

* **Public (no login):** NASA GIBS rendered imagery and NASA CMR granule
  metadata. These are real NASA products and are fetched live.
* **Quantitative (Earthdata Login):** the underlying HDF5/OPeNDAP granule
  values. This MVP does not ask for, store, or fake user credentials. When
  credentials are absent the UI states the limitation instead of inventing
  values.
"""
from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger(__name__)

GIBS_URL = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
CMR_GRANULES_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
GIBS_DOCS_URL = "https://nasa-gibs.github.io/gibs-api-docs/"
CMR_DOCS_URL = "https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html"
EARTHDATA_LOGIN_URL = "https://urs.earthdata.nasa.gov/"

# Last-resort defaults if the GIBS capabilities document is temporarily
# unavailable. These dates were verified against live GIBS on 2026-11-12.
VERIFIED_DEFAULT_DATES = {
    "smap": "2026-11-08",
    "gpm": "2026-11-10",
    "modis": "2026-11-10",
}

SOURCES: dict[str, dict[str, Any]] = {
    "smap": {
        "id": "smap",
        "short_name": "SMAP soil moisture",
        "name": "NASA SMAP Enhanced L3 Radiometer Global Daily 9 km Soil Moisture (SPL3SMP_E) V006",
        "provider": "NASA NSIDC DAAC",
        "gibs_layer": "SMAP_L3_Passive_Enhanced_Day_Soil_Moisture",
        "gibs_layer_label": "SMAP L3 Passive Enhanced Day Soil Moisture",
        "cmr_short_name": "SPL3SMP_E",
        "concept_id": "C2938664763-NSIDC_CPRD",
        "spatial_resolution": "9 km (Enhanced L3, global EASE-Grid 2.0)",
        "temporal_coverage": "2015-03-31 to present, daily",
        "update_frequency": "Daily; typically a few days latency",
        "variables": "Surface soil moisture (cm³/cm³) and quality flags",
        "units": "cm³/cm³ (volumetric)",
        "docs_url": "https://nsidc.org/data/spl3smp_e/versions/6",
        "doi": "https://doi.org/10.5067/SSATP8F9HI8P",
        "gibs_note": (
            "The preview is a NASA GIBS rendering of the SMAP daytime soil-moisture layer. "
            "It is visual context only; color values are not a substitute for the scientific variable."
        ),
        "quantitative_note": (
            "SMAP HDF5 and OPeNDAP values require a free NASA Earthdata Login. "
            "This MVP does not request or store Earthdata credentials."
        ),
        "cmr_window_days": 21,
        "aoi_degrees": 0.35,
        "legend": "Soil moisture color scale (NASA GIBS)",
    },
    "gpm": {
        "id": "gpm",
        "short_name": "GPM IMERG precipitation",
        "name": "NASA GPM IMERG Late Run Daily Precipitation L3 0.1° (GPM_3IMERGDL) V07",
        "provider": "NASA GES DISC",
        "gibs_layer": "IMERG_Precipitation_Rate",
        "gibs_layer_label": "IMERG Precipitation Rate (near real time)",
        "cmr_short_name": "GPM_3IMERGDL",
        "concept_id": "C2723754859-GES_DISC",
        "spatial_resolution": "0.1° × 0.1° (~11 km at the equator)",
        "temporal_coverage": "2000-06 to near real time, daily (Late Run)",
        "update_frequency": "Daily; Late Run typically lags ~1–2 days",
        "variables": "Daily precipitation (mm/day) and precipitation quality",
        "units": "mm/day",
        "docs_url": "https://gpm.nasa.gov/data/imerg",
        "doi": "https://doi.org/10.5067/GPM/IMERGDL/DAY/07",
        "gibs_note": (
            "The preview is the NASA GIBS IMERG near-real-time precipitation-rate layer. "
            "It shows spatial context, not a farm-scale gauge measurement."
        ),
        "quantitative_note": (
            "IMERG NetCDF/HDF5 values require a free NASA Earthdata Login. "
            "The Final Run lags several months; this app checks the Late Run for availability."
        ),
        "cmr_window_days": 21,
        "aoi_degrees": 0.4,
        "legend": "Precipitation-rate color scale (NASA GIBS)",
    },
    "modis": {
        "id": "modis",
        "short_name": "MODIS vegetation index",
        "name": "NASA MODIS Terra Vegetation Indices 16-Day L3 Global 250 m (MOD13Q1) V061",
        "provider": "NASA LP DAAC",
        "gibs_layer": "MODIS_Terra_NDVI_8Day",
        "gibs_layer_label": "MODIS Terra NDVI (8-day composite)",
        "cmr_short_name": "MOD13Q1",
        "concept_id": "C1748066515-LPCLOUD",
        "spatial_resolution": "250 m (MOD13Q1 sinusoidal grid)",
        "temporal_coverage": "2000-02 to present, 16-day composites",
        "update_frequency": "Every 16 days; a few days processing latency",
        "variables": "NDVI, EVI, vegetation-index quality layers",
        "units": "NDVI/EVI index (dimensionless, −1 to 1)",
        "docs_url": "https://lpdaac.usgs.gov/products/mod13q1v061/",
        "doi": "https://doi.org/10.5067/MODIS/MOD13Q1.061",
        "gibs_note": (
            "The preview uses the NASA GIBS MODIS Terra 8-day NDVI composite. "
            "MOD13Q1 itself is a 16-day product; the preview is contextual, not the product grid value."
        ),
        "quantitative_note": (
            "MODIS HDF4/COG values require a free NASA Earthdata Login (LP DAAC). "
            "This MVP does not include a credentialed raster-subsetting workflow."
        ),
        "cmr_window_days": 120,
        "aoi_degrees": 0.25,
        "legend": "NDVI color scale (NASA GIBS)",
    },
}


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _abs_url(url: str) -> str:
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return "https://" + url.lstrip("/")


@lru_cache(maxsize=1)
def gibs_layer_dates() -> dict[str, str]:
    """Read the authoritative latest date for each layer from GIBS capabilities."""
    try:
        response = requests.get(
            GIBS_URL,
            params={"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetCapabilities"},
            timeout=(10, 60),
            headers={"User-Agent": "FieldShiftEgypt/0.1 (NASA Space Apps Challenge prototype)"},
        )
        response.raise_for_status()
        root = ET.fromstring(response.content)
        ns = {"w": "http://www.opengis.net/wms"}
        wanted = {source["gibs_layer"]: key for key, source in SOURCES.items()}
        found: dict[str, str] = {}
        for layer in root.iter("{http://www.opengis.net/wms}Layer"):
            name = layer.find("w:Name", ns)
            if name is None or name.text not in wanted:
                continue
            dimension = layer.find("w:Dimension", ns)
            if dimension is not None and dimension.get("default"):
                found[wanted[name.text]] = dimension.get("default")
        return {**VERIFIED_DEFAULT_DATES, **found}
    except Exception as exc:  # network/XML failure must not break the page
        log.warning("GIBS capabilities unavailable; using verified defaults: %s", exc)
        return dict(VERIFIED_DEFAULT_DATES)


def _bbox(latitude: float, longitude: float, half_size: float) -> tuple[float, float, float, float]:
    south = max(-90.0, latitude - half_size)
    north = min(90.0, latitude + half_size)
    west = max(-180.0, longitude - half_size)
    east = min(180.0, longitude + half_size)
    return west, south, east, north


@lru_cache(maxsize=128)
def _gibs_image_cached(
    layer: str, west: float, south: float, east: float, north: float, day: str, width: int, height: int
) -> bytes:
    response = requests.get(
        GIBS_URL,
        params={
            "SERVICE": "WMS",
            "VERSION": "1.1.1",
            "REQUEST": "GetMap",
            "LAYERS": layer,
            "BBOX": f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}",
            "SRS": "EPSG:4326",
            "WIDTH": width,
            "HEIGHT": height,
            "FORMAT": "image/png",
            "TIME": day,
        },
        timeout=(10, 60),
        headers={"User-Agent": "FieldShiftEgypt/0.1 (NASA Space Apps Challenge prototype)"},
    )
    response.raise_for_status()
    if "image/png" not in response.headers.get("Content-Type", ""):
        raise ValueError("GIBS did not return a PNG image")
    content = response.content
    if not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("GIBS response was not a valid PNG")
    if len(content) < 400:
        raise ValueError("GIBS returned an effectively blank image for this date")
    return content


def fetch_imagery(source_id: str, latitude: float, longitude: float, *, day: str | None = None,
                  width: int = 560, height: int = 420) -> tuple[bytes, str]:
    source = SOURCES[source_id]
    if day:
        try:
            date.fromisoformat(day)
        except ValueError as exc:
            raise ValueError("date must be YYYY-MM-DD") from exc
    else:
        day = gibs_layer_dates()[source_id]
    west, south, east, north = _bbox(latitude, longitude, source["aoi_degrees"])
    content = _gibs_image_cached(
        source["gibs_layer"], west, south, east, north, day, int(width), int(height)
    )
    return content, day


def _cmr_query(source: dict[str, Any], latitude: float, longitude: float, day: str | None = None) -> dict[str, Any]:
    half = source["aoi_degrees"]
    west, south, east, north = _bbox(latitude, longitude, half)
    end = date.fromisoformat(day) if day else _today()
    start = end - timedelta(days=source["cmr_window_days"])
    params = {
        "short_name": source["cmr_short_name"],
        "temporal": f"{start.isoformat()}T00:00:00Z,{end.isoformat()}T23:59:59Z",
        "bounding_box": f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}",
        "page_size": 5,
        "sort_key": "-start_date",
    }
    response = requests.get(
        CMR_GRANULES_URL,
        params=params,
        timeout=(10, 45),
        headers={"User-Agent": "FieldShiftEgypt/0.1 (NASA Space Apps Challenge prototype)"},
    )
    response.raise_for_status()
    entries = (response.json().get("feed") or {}).get("entry") or []
    granules = []
    for entry in entries:
        links = entry.get("links") or []
        data_link = None
        for link in links:
            href = link.get("href") or ""
            rel = link.get("rel") or ""
            if "data#" in rel or href.endswith((".h5", ".nc4", ".hdf")):
                data_link = _abs_url(href)
                break
        granules.append(
            {
                "title": entry.get("title"),
                "time_start": entry.get("time_start"),
                "updated": entry.get("updated"),
                "concept_id": entry.get("id"),
                "data_link": data_link,
            }
        )
    return {
        "ok": True,
        "query_window": {"start": start.isoformat(), "end": end.isoformat()},
        "granule_count_sampled": len(granules),
        "latest": granules[0] if granules else None,
        "granules": granules,
    }


def earthdata_configured() -> bool:
    """Report whether a NASA Earthdata machine entry exists, without reading secrets."""
    netrc = Path.home() / ".netrc"
    if not netrc.exists():
        return False
    try:
        return "urs.earthdata.nasa.gov" in netrc.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False


def source_status(source_id: str, latitude: float, longitude: float) -> dict[str, Any]:
    source = SOURCES[source_id]
    gibs_date = gibs_layer_dates().get(source_id)
    status: dict[str, Any] = {
        **source,
        "gibs_imagery_date": gibs_date,
        "gibs_available": False,
        "gibs_error": None,
        "cmr": None,
        "cmr_error": None,
        "quantitative_available": False,
        "quantitative_access": "Earthdata Login required; not enabled in this MVP",
        "earthdata_credentials_detected": earthdata_configured(),
        "earthdata_login_url": EARTHDATA_LOGIN_URL,
        "gibs_docs_url": GIBS_DOCS_URL,
        "cmr_docs_url": CMR_DOCS_URL,
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    try:
        content, actual_day = fetch_imagery(source_id, latitude, longitude, day=gibs_date)
        status["gibs_available"] = True
        status["gibs_imagery_date"] = actual_day
        status["gibs_image_bytes"] = len(content)
    except Exception as exc:
        status["gibs_error"] = str(exc)
        log.warning("GIBS imagery unavailable for %s: %s", source_id, exc)

    try:
        status["cmr"] = _cmr_query(source, latitude, longitude)
    except Exception as exc:
        status["cmr_error"] = str(exc)
        log.warning("CMR search unavailable for %s: %s", source_id, exc)
    return status


def all_status(latitude: float, longitude: float) -> dict[str, Any]:
    sources = [source_status(key, latitude, longitude) for key in SOURCES]
    return {
        "ok": True,
        "location": {"latitude": latitude, "longitude": longitude},
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": sources,
        "summary": {
            "imagery_available": sum(1 for item in sources if item["gibs_available"]),
            "cmr_available": sum(1 for item in sources if item["cmr"] and item["cmr"]["ok"]),
            "quantitative_available": 0,
            "total": len(sources),
        },
        "access_note": (
            "NASA GIBS imagery and CMR metadata are public. Quantitative SMAP/GPM/MODIS values "
            "require a free NASA Earthdata Login; this prototype does not handle credentials."
        ),
    }


def worldview_url(source_id: str, latitude: float, longitude: float, *, day: str | None = None) -> str:
    source = SOURCES[source_id]
    day = day or gibs_layer_dates()[source_id]
    return (
        "https://worldview.earthdata.nasa.gov/"
        f"?v={longitude - 1.2:.4f},{latitude - 0.8:.4f},{longitude + 1.2:.4f},{latitude + 0.8:.4f}"
        f"&l={source['gibs_layer']}&t={day}"
    )
