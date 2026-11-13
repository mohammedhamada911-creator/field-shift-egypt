"""SQLite persistence for retrieved NASA data and API response cache."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .config import DB_PATH

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS data_sources (
    source_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT,
    documentation_url TEXT,
    dataset_type TEXT,
    spatial_resolution TEXT,
    temporal_coverage TEXT,
    attribution TEXT,
    notes TEXT,
    last_retrieved_at TEXT
);

CREATE TABLE IF NOT EXISTS api_cache (
    cache_key TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    requested_start TEXT,
    requested_end TEXT,
    parameters TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_accessed_at TEXT,
    hit_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS retrieval_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT,
    source_id TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    requested_start TEXT,
    requested_end TEXT,
    retrieved_at TEXT NOT NULL,
    status TEXT NOT NULL,
    latest_observation TEXT,
    first_observation TEXT,
    completeness_pct REAL,
    valid_cells INTEGER,
    missing_cells INTEGER,
    days_requested INTEGER,
    api_version TEXT,
    from_cache INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS observations (
    source_id TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    parameter TEXT NOT NULL,
    obs_date TEXT NOT NULL,
    value REAL,
    unit TEXT,
    retrieved_at TEXT NOT NULL,
    run_id INTEGER,
    PRIMARY KEY (source_id, latitude, longitude, parameter, obs_date)
);

CREATE INDEX IF NOT EXISTS idx_observations_date
    ON observations (source_id, parameter, obs_date);
CREATE INDEX IF NOT EXISTS idx_runs_retrieved
    ON retrieval_runs (retrieved_at DESC);

CREATE TABLE IF NOT EXISTS farm_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    latitude REAL,
    longitude REAL,
    governorate TEXT,
    soil_texture TEXT,
    ph REAL,
    organic_matter_pct REAL,
    ec_ds_m REAL,
    drainage TEXT,
    irrigation_method TEXT,
    water_source TEXT,
    water_availability TEXT,
    area_feddan REAL,
    current_crop TEXT,
    previous_crops TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS farm_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_key TEXT,
    farm_name TEXT,
    latitude REAL,
    longitude REAL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analyses_created
    ON farm_analyses (created_at DESC);
"""

# Columns added after the first release. Existing local databases are migrated
# forward in place instead of being dropped.
FARM_PROFILE_COLUMNS = {
    "water_availability": "TEXT",
    "area_feddan": "REAL",
    "current_crop": "TEXT",
    "previous_crops": "TEXT",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


class Storage:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA)
            existing = {
                row["name"] for row in conn.execute("PRAGMA table_info(farm_profiles)")
            }
            for column, column_type in FARM_PROFILE_COLUMNS.items():
                if column not in existing:
                    conn.execute(
                        f"ALTER TABLE farm_profiles ADD COLUMN {column} {column_type}"
                    )

    # ---------- cache ----------
    @staticmethod
    def make_key(
        *,
        source_id: str,
        latitude: float,
        longitude: float,
        start: str,
        end: str,
        parameters: list[str],
    ) -> str:
        return "|".join(
            [
                source_id,
                f"{latitude:.4f}",
                f"{longitude:.4f}",
                start,
                end,
                ",".join(parameters),
            ]
        )

    def cache_get(self, cache_key: str) -> dict[str, Any] | None:
        now = utcnow()
        with self.connect() as conn:
            row = conn.execute(
                "SELECT payload, created_at, expires_at, hit_count FROM api_cache WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
            if not row:
                return None
            if datetime.fromisoformat(row["expires_at"]) <= now:
                return None
            conn.execute(
                "UPDATE api_cache SET last_accessed_at = ?, hit_count = hit_count + 1 WHERE cache_key = ?",
                (iso(now), cache_key),
            )
        payload = json.loads(row["payload"])
        payload["cache"] = {
            "hit": True,
            "stored_at": row["created_at"],
            "expires_at": row["expires_at"],
            "age_seconds": int((now - datetime.fromisoformat(row["created_at"])).total_seconds()),
            "hit_count": row["hit_count"] + 1,
        }
        return payload

    def cache_put(
        self,
        cache_key: str,
        envelope: dict[str, Any],
        *,
        ttl_seconds: int,
    ) -> dict[str, Any]:
        now = utcnow()
        expires = now + timedelta(seconds=ttl_seconds)
        payload = dict(envelope)
        payload.pop("cache", None)
        source = payload.get("source") or {}
        period = payload.get("period") or {}
        location = payload.get("location") or {}
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO api_cache (
                    cache_key, source_id, payload, latitude, longitude,
                    requested_start, requested_end, parameters, created_at, expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    payload = excluded.payload,
                    created_at = excluded.created_at,
                    expires_at = excluded.expires_at,
                    last_accessed_at = NULL,
                    hit_count = 0
                """,
                (
                    cache_key,
                    source.get("id", "unknown"),
                    json.dumps(payload, allow_nan=False),
                    location.get("requested_latitude"),
                    location.get("requested_longitude"),
                    period.get("requested_start"),
                    period.get("requested_end"),
                    ",".join(p.get("id", "") for p in source.get("parameters", [])),
                    iso(now),
                    iso(expires),
                ),
            )
        return {
            "hit": False,
            "stored_at": iso(now),
            "expires_at": iso(expires),
            "ttl_seconds": ttl_seconds,
            "age_seconds": 0,
        }

    def purge_expired_cache(self) -> int:
        with self.connect() as conn:
            cursor = conn.execute("DELETE FROM api_cache WHERE expires_at <= ?", (iso(utcnow()),))
            return cursor.rowcount

    # ---------- provenance + observations ----------
    def upsert_source(self, source: dict[str, Any], *, retrieved_at: str) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO data_sources (
                    source_id, name, url, documentation_url, dataset_type,
                    spatial_resolution, temporal_coverage, attribution, notes, last_retrieved_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_id) DO UPDATE SET
                    name = excluded.name,
                    url = excluded.url,
                    documentation_url = excluded.documentation_url,
                    dataset_type = excluded.dataset_type,
                    spatial_resolution = excluded.spatial_resolution,
                    temporal_coverage = excluded.temporal_coverage,
                    attribution = excluded.attribution,
                    notes = excluded.notes,
                    last_retrieved_at = excluded.last_retrieved_at
                """,
                (
                    source.get("id"),
                    source.get("name"),
                    source.get("url"),
                    source.get("documentation_url"),
                    source.get("dataset_type"),
                    source.get("spatial_resolution"),
                    source.get("temporal_coverage"),
                    source.get("attribution"),
                    source.get("note"),
                    retrieved_at,
                ),
            )

    def store_run(self, envelope: dict[str, Any], *, cache_key: str) -> int:
        source = envelope.get("source") or {}
        period = envelope.get("period") or {}
        quality = envelope.get("quality") or {}
        location = envelope.get("location") or {}
        retrieved_at = source.get("retrieved_at") or iso(utcnow())
        source_id = source.get("id", "unknown")
        lat = location.get("requested_latitude")
        lon = location.get("requested_longitude")
        units = {item["id"]: item.get("unit") for item in source.get("parameters", [])}

        self.upsert_source(source, retrieved_at=retrieved_at)
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO retrieval_runs (
                    cache_key, source_id, latitude, longitude, requested_start, requested_end,
                    retrieved_at, status, latest_observation, first_observation, completeness_pct,
                    valid_cells, missing_cells, days_requested, api_version, from_cache
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """,
                (
                    cache_key,
                    source_id,
                    lat,
                    lon,
                    period.get("requested_start"),
                    period.get("requested_end"),
                    retrieved_at,
                    "success",
                    period.get("last_observation"),
                    period.get("first_observation"),
                    quality.get("completeness_pct"),
                    quality.get("valid_cells"),
                    quality.get("missing_cells"),
                    period.get("days_requested"),
                    source.get("api_version"),
                ),
            )
            run_id = int(cursor.lastrowid)

            rows = []
            for row in envelope.get("series", []):
                day = row.get("date")
                for parameter, value in row.items():
                    if parameter == "date":
                        continue
                    rows.append(
                        (
                            source_id,
                            lat,
                            lon,
                            parameter,
                            day,
                            value,
                            units.get(parameter),
                            retrieved_at,
                            run_id,
                        )
                    )
            conn.executemany(
                """
                INSERT INTO observations (
                    source_id, latitude, longitude, parameter, obs_date, value, unit, retrieved_at, run_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_id, latitude, longitude, parameter, obs_date) DO UPDATE SET
                    value = excluded.value,
                    unit = excluded.unit,
                    retrieved_at = excluded.retrieved_at,
                    run_id = excluded.run_id
                """,
                rows,
            )
        return run_id

    # ---------- farm profiles ----------
    def save_farm_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        created_at = iso(utcnow())
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO farm_profiles (
                    name, latitude, longitude, governorate, soil_texture, ph,
                    organic_matter_pct, ec_ds_m, drainage, irrigation_method,
                    water_source, water_availability, area_feddan, current_crop,
                    previous_crops, notes, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    profile.get("name"),
                    profile.get("latitude"),
                    profile.get("longitude"),
                    profile.get("governorate"),
                    profile.get("soil_texture"),
                    profile.get("ph"),
                    profile.get("organic_matter_pct"),
                    profile.get("ec_ds_m"),
                    profile.get("drainage"),
                    profile.get("irrigation_method"),
                    profile.get("water_source"),
                    profile.get("water_availability"),
                    profile.get("area_feddan"),
                    profile.get("current_crop"),
                    profile.get("previous_crops"),
                    profile.get("notes"),
                    created_at,
                ),
            )
            profile_id = int(cursor.lastrowid)
        return {**profile, "id": profile_id, "created_at": created_at}

    def list_farm_profiles(self, limit: int = 20) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM farm_profiles ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(row) for row in rows]

    def latest_farm_profile(self) -> dict[str, Any] | None:
        profiles = self.list_farm_profiles(1)
        return profiles[0] if profiles else None

    # ---------- saved farm analyses ----------
    def save_analysis(self, analysis: dict[str, Any]) -> dict[str, Any]:
        """Store a farmer-facing analysis snapshot without touching NASA data."""
        created_at = iso(utcnow())
        payload = json.dumps(analysis.get("payload"), ensure_ascii=False, allow_nan=False)
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO farm_analyses (
                    farm_key, farm_name, latitude, longitude, payload, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    str(analysis.get("farm_key") or "")[:120] or None,
                    str(analysis.get("farm_name") or "")[:160] or None,
                    analysis.get("latitude"),
                    analysis.get("longitude"),
                    payload,
                    created_at,
                ),
            )
            analysis_id = int(cursor.lastrowid)
        return {
            "id": analysis_id,
            "farm_key": analysis.get("farm_key"),
            "farm_name": analysis.get("farm_name"),
            "created_at": created_at,
        }

    def list_analyses(
        self, limit: int = 20, farm_key: str | None = None
    ) -> list[dict[str, Any]]:
        query = "SELECT * FROM farm_analyses"
        params: list[Any] = []
        if farm_key:
            query += " WHERE farm_key = ?"
            params.append(farm_key)
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        results = []
        for row in rows:
            item = dict(row)
            try:
                item["payload"] = json.loads(item["payload"])
            except ValueError:
                item["payload"] = None
            results.append(item)
        return results

    # ---------- reporting ----------
    def stats(self) -> dict[str, Any]:
        with self.connect() as conn:
            def count(table: str) -> int:
                return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])

            latest = conn.execute(
                "SELECT retrieved_at, latest_observation FROM retrieval_runs ORDER BY id DESC LIMIT 1"
            ).fetchone()
            cache = conn.execute(
                "SELECT COUNT(*) AS total, SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END) AS fresh FROM api_cache",
                (iso(utcnow()),),
            ).fetchone()
            counts = {
                "sources": count("data_sources"),
                "runs": count("retrieval_runs"),
                "observations": count("observations"),
                "farm_profiles": count("farm_profiles"),
            }
        return {
            "database": str(self.path),
            **counts,
            "cache_entries": int(cache["total"] or 0),
            "cache_fresh": int(cache["fresh"] or 0),
            "last_retrieval": dict(latest) if latest else None,
            "database_bytes": self.path.stat().st_size if self.path.exists() else 0,
        }

    def recent_runs(self, limit: int = 20) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM retrieval_runs ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(row) for row in rows]

    def sources(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM data_sources ORDER BY source_id").fetchall()
        return [dict(row) for row in rows]

    def observation_counts(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT source_id, parameter, COUNT(*) AS rows,
                       SUM(CASE WHEN value IS NULL THEN 1 ELSE 0 END) AS missing,
                       MIN(obs_date) AS first_date, MAX(obs_date) AS last_date
                FROM observations
                GROUP BY source_id, parameter
                ORDER BY source_id, parameter
                """
            ).fetchall()
        return [dict(row) for row in rows]


_storage: Storage | None = None


def configure_storage(path: str | Path) -> Storage:
    global _storage
    _storage = Storage(path)
    _storage.init_schema()
    return _storage


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = Storage(DB_PATH)
        _storage.init_schema()
    return _storage
