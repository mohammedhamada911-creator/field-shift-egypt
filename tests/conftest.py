from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FIXTURE = Path(__file__).parent / "fixtures" / "power_sohag_90d.json"


@pytest.fixture(scope="session")
def raw_power_fixture() -> dict:
    with FIXTURE.open("r", encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture()
def app(tmp_path):
    from app import create_app

    app = create_app(
        {
            "TESTING": True,
            "DATABASE_PATH": str(tmp_path / "fieldshift-test.sqlite3"),
        }
    )
    return app


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def power_envelope(monkeypatch, raw_power_fixture):
    """A real-data-derived envelope, with only the network transport mocked."""
    import fieldshift.power as power_module
    from fieldshift.power import fetch_daily

    monkeypatch.setattr(power_module, "_request", lambda _params: copy.deepcopy(raw_power_fixture))
    return fetch_daily(26.5591, 31.6991, start="2026-08-15", end="2026-11-11")
