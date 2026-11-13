"""Application configuration and immutable reference metadata."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "static" / "data"
DEFAULT_DB_PATH = (
    Path("/tmp/fieldshift.sqlite3")
    if os.environ.get("VERCEL")
    else BASE_DIR / "data" / "fieldshift.sqlite3"
)
DB_PATH = Path(os.environ.get("FIELDSHIFT_DB", DEFAULT_DB_PATH))

APP_NAME = "Field Shift Egypt"
APP_VERSION = "0.1.0"

POWER_DAILY_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
POWER_DOCS_URL = "https://power.larc.nasa.gov/docs/services/api/temporal/daily/"
POWER_HOME_URL = "https://power.larc.nasa.gov/"
POWER_COMMUNITY = "AG"
POWER_TIME_STANDARD = "LST"

# Sohag Governorate pilot site (agricultural land west of Sohag city).
DEFAULT_LOCATION = {
    "name": "Sohag pilot farm",
    "latitude": 26.5591,
    "longitude": 31.6991,
    "governorate": "Sohag",
    "country": "Egypt",
    "note": "Pilot coordinate used for integration testing; not a surveyed field boundary.",
}

# A deliberately small, agriculture-relevant POWER parameter set.
POWER_PARAMETERS = {
    "T2M": {
        "label": "Mean air temperature",
        "unit": "°C",
        "short": "Temp mean",
        "kind": "temperature",
        "description": "Daily average air temperature at 2 m.",
    },
    "T2M_MAX": {
        "label": "Maximum air temperature",
        "unit": "°C",
        "short": "Temp max",
        "kind": "temperature",
        "description": "Daily maximum air temperature at 2 m.",
    },
    "T2M_MIN": {
        "label": "Minimum air temperature",
        "unit": "°C",
        "short": "Temp min",
        "kind": "temperature",
        "description": "Daily minimum air temperature at 2 m.",
    },
    "PRECTOTCORR": {
        "label": "Precipitation",
        "unit": "mm/day",
        "short": "Rain",
        "kind": "precipitation",
        "description": "Bias-corrected total precipitation.",
    },
    "ALLSKY_SFC_SW_DWN": {
        "label": "Solar radiation (all sky)",
        "unit": "kWh/m²/day",
        "short": "Solar",
        "kind": "radiation",
        "description": "Downward shortwave radiation at the surface under all-sky conditions.",
    },
    "RH2M": {
        "label": "Relative humidity",
        "unit": "%",
        "short": "Humidity",
        "kind": "humidity",
        "description": "Daily average relative humidity at 2 m.",
    },
    "WS2M": {
        "label": "Wind speed",
        "unit": "m/s",
        "short": "Wind",
        "kind": "wind",
        "description": "Daily average wind speed at 2 m.",
    },
    "GWETROOT": {
        "label": "Root-zone soil wetness",
        "unit": "fraction (0–1)",
        "short": "Root-zone wetness",
        "kind": "soil_moisture",
        "description": (
            "POWER/MERRA-2 model-derived root-zone soil wetness proxy. "
            "This is not an SMAP satellite soil-moisture measurement."
        ),
    },
}

DEFAULT_POWER_PARAMS = list(POWER_PARAMETERS.keys())

# Data older than this many days is unlikely to change; shorter windows are refreshed.
CACHE_TTL_SECONDS = int(os.environ.get("FIELDSHIFT_CACHE_TTL", 6 * 60 * 60))
POWER_TIMEOUT_SECONDS = float(os.environ.get("FIELDSHIFT_POWER_TIMEOUT", 45))
POWER_MAX_RANGE_DAYS = 3660
POWER_RETRIES = 2

EGYPT_BOUNDS = {
    "min_latitude": 22.0,
    "max_latitude": 31.7,
    "min_longitude": 24.6,
    "max_longitude": 36.9,
}

GOVERNORATES_FILE = DATA_DIR / "egypt_governorates.geojson"
