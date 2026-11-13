"""Egypt administrative geography helpers (Egypt-focused MVP)."""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from .config import EGYPT_BOUNDS, GOVERNORATES_FILE

ARABIC_NAMES = {
    "Alexandria": "الإسكندرية",
    "Aswan": "أسوان",
    "Asyut": "أسيوط",
    "Beheira": "البحيرة",
    "Beni Suef": "بني سويف",
    "Cairo": "القاهرة",
    "Dakahlia": "الدقهلية",
    "Damietta": "دمياط",
    "Faiyum": "الفيوم",
    "Gharbiyya": "الغربية",
    "Giza": "الجيزة",
    "Ismailia": "الإسماعيلية",
    "Kafr el-Sheikh": "كفر الشيخ",
    "Luxor": "الأقصر",
    "Matrouh": "مطروح",
    "Minya": "المنيا",
    "Monufia": "المنوفية",
    "New Valley": "الوادي الجديد",
    "North Sinai": "شمال سيناء",
    "Port Said": "بورسعيد",
    "Qalyubia": "القليوبية",
    "Qena": "قنا",
    "Red Sea": "البحر الأحمر",
    "Sohag": "سوهاج",
    "South Sinai": "جنوب سيناء",
    "Suez": "السويس",
    "Al Sharqia": "الشرقية",
}

GOVERNORATE_NOTES = {
    "Sohag": "Pilot region. Irrigated Nile Valley agriculture; data shown are grid-cell estimates.",
    "Aswan": "Hot, hyper-arid south. Irrigation-dependent; heat and water stress are key.",
    "New Valley": "Oases and desert agriculture; very sparse local validation data.",
    "Matrouh": "Mediterranean coastal rainfall zone; different cropping pattern from the Nile Valley.",
    "Red Sea": "Arid coastal desert; agricultural activity is limited and local data are sparse.",
    "North Sinai": "Coastal and desert agriculture with distinct water and salinity constraints.",
    "South Sinai": "Mountainous arid terrain; limited agricultural area and sparse local data.",
}


@lru_cache(maxsize=1)
def load_governorates_geojson() -> dict[str, Any]:
    with GOVERNORATES_FILE.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _ring_centroid(ring: list[list[float]]) -> tuple[float, float]:
    """Simple polygon centroid; adequate for map labels, not geodesy."""
    if not ring:
        return 0.0, 0.0
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    if not pts:
        return 0.0, 0.0
    area = 0.0
    cx = 0.0
    cy = 0.0
    for index, (x1, y1) in enumerate(pts):
        x2, y2 = pts[(index + 1) % len(pts)]
        cross = x1 * y2 - x2 * y1
        area += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    area *= 0.5
    if abs(area) < 1e-12:
        return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    return cx / (6 * area), cy / (6 * area)


def _feature_center(feature: dict[str, Any]) -> tuple[float, float]:
    geometry = feature.get("geometry") or {}
    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if gtype == "Polygon" and coords:
        return _ring_centroid(coords[0])
    if gtype == "MultiPolygon" and coords:
        # Use the largest polygon by vertex count as the label anchor.
        largest = max(coords, key=lambda poly: len(poly[0]) if poly else 0)
        return _ring_centroid(largest[0])
    return 0.0, 0.0


def clean_name(shape_name: str) -> str:
    return (
        shape_name.replace(" Governorate", "")
        .replace(" Governate", "")
        .strip()
    )


@lru_cache(maxsize=1)
def governorate_list() -> list[dict[str, Any]]:
    items = []
    for feature in load_governorates_geojson().get("features", []):
        props = feature.get("properties") or {}
        name = clean_name(props.get("shapeName", "Unknown"))
        lon, lat = _feature_center(feature)
        items.append(
            {
                "id": props.get("shapeISO") or name,
                "name": name,
                "name_ar": ARABIC_NAMES.get(name),
                "latitude": round(lat, 4),
                "longitude": round(lon, 4),
                "note": GOVERNORATE_NOTES.get(name),
                "is_pilot": name == "Sohag",
            }
        )
    return sorted(items, key=lambda item: item["name"])


def get_governorate(name: str) -> dict[str, Any] | None:
    needle = clean_name(name).casefold()
    for item in governorate_list():
        if item["name"].casefold() == needle:
            return item
    return None


def _inside_bounding_box(latitude: float, longitude: float) -> bool:
    return (
        EGYPT_BOUNDS["min_latitude"] <= latitude <= EGYPT_BOUNDS["max_latitude"]
        and EGYPT_BOUNDS["min_longitude"] <= longitude <= EGYPT_BOUNDS["max_longitude"]
    )


def in_egypt(latitude: float, longitude: float) -> bool:
    """Return True only when the point falls inside an Egyptian governorate polygon.

    The bounding box is used as a fast reject, but it also contains parts of
    Libya, Sudan, Saudi Arabia and the Mediterranean/Red Sea. Reporting those as
    "inside Egypt" would mislabel worldwide map selections.
    """
    if not _inside_bounding_box(latitude, longitude):
        return False
    for feature in load_governorates_geojson().get("features", []):
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates") or []
        polygons = [coords] if geometry.get("type") == "Polygon" else coords
        for polygon in polygons:
            if polygon and _point_in_ring(longitude, latitude, polygon[0]):
                return True
    return False


def _point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    count = len(ring)
    if count < 3:
        return False
    j = count - 1
    for i in range(count):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersects = (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-15) + xi
        if intersects:
            inside = not inside
        j = i
    return inside


def locate_governorate(latitude: float, longitude: float) -> dict[str, Any] | None:
    """Return the Egyptian governorate containing a point, if any."""
    if not _inside_bounding_box(latitude, longitude):
        return None
    for feature in load_governorates_geojson().get("features", []):
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates") or []
        polygons = [coords] if geometry.get("type") == "Polygon" else coords
        for polygon in polygons:
            if not polygon:
                continue
            # GeoJSON polygons can have holes; the outer ring is sufficient here.
            if _point_in_ring(longitude, latitude, polygon[0]):
                props = feature.get("properties") or {}
                name = clean_name(props.get("shapeName", "Unknown"))
                return {
                    "name": name,
                    "name_ar": ARABIC_NAMES.get(name),
                    "id": props.get("shapeISO") or name,
                    "is_pilot": name == "Sohag",
                    "note": GOVERNORATE_NOTES.get(name),
                }
    return None


def location_context(latitude: float, longitude: float) -> dict[str, Any]:
    governorate = locate_governorate(latitude, longitude)
    return {
        "latitude": latitude,
        "longitude": longitude,
        "in_egypt": in_egypt(latitude, longitude),
        "governorate": governorate,
        "local_agriculture_scope": (
            "Egyptian crop and soil reference data available; verify with local extension services."
            if governorate
            else "Outside Egypt: NASA climate data may still be available, but Egyptian crop/soil "
            "reference data and rotation scoring assumptions do not apply."
        ),
    }
