from __future__ import annotations

import copy
from datetime import date

import pytest
import requests

import fieldshift.power as power_module
from fieldshift.errors import (
    InvalidCoordinates,
    InvalidDateRange,
    InvalidParameter,
    PowerNoData,
    PowerTimeout,
    PowerUnavailable,
)
from fieldshift.power import (
    fetch_daily,
    resolve_period,
    validate_coordinates,
    validate_parameters,
    validate_period,
)


def test_valid_sohag_coordinates():
    assert validate_coordinates(26.5591, 31.6991) == (26.5591, 31.6991)
    assert validate_coordinates("26.5591", "31.6991") == (26.5591, 31.6991)


@pytest.mark.parametrize(
    "lat,lon",
    [(-91, 31), (91, 31), (26, -181), (26, 181), ("abc", 31), (26, None), (float("nan"), 31)],
)
def test_invalid_coordinates_rejected(lat, lon):
    with pytest.raises(InvalidCoordinates):
        validate_coordinates(lat, lon)


def test_date_validation_rejects_reversed_and_future():
    with pytest.raises(InvalidDateRange):
        validate_period(date(2026, 11, 10), date(2026, 11, 1))
    with pytest.raises(InvalidDateRange):
        validate_period(date(2026, 11, 1), date(2099, 1, 1))
    with pytest.raises(InvalidDateRange):
        validate_period(date(1980, 1, 1), date(1980, 2, 1))


def test_date_validation_rejects_excessive_range():
    with pytest.raises(InvalidDateRange, match="too long"):
        validate_period(date(1990, 1, 1), date(2020, 1, 1))


def test_resolve_period_defaults_to_last_ninety_days():
    start, end = resolve_period(None, None, days=90)
    assert end == date.today()
    assert (end - start).days == 89


def test_validate_parameters_rejects_unknown():
    with pytest.raises(InvalidParameter):
        validate_parameters(["T2M", "MADE_UP"])
    assert validate_parameters(["T2M", "T2M"]) == ["T2M"]
    assert validate_parameters(None) == list(power_module.DEFAULT_POWER_PARAMS)


def test_fetch_daily_with_mocked_response(monkeypatch, raw_power_fixture):
    captured = {}

    def fake_request(params):
        captured.update(params)
        return copy.deepcopy(raw_power_fixture)

    monkeypatch.setattr(power_module, "_request", fake_request)
    result = fetch_daily(
        26.5591,
        31.6991,
        start="2026-08-15",
        end="2026-11-11",
        parameters=["T2M", "PRECTOTCORR"],
    )
    assert captured["community"] == "AG"
    assert captured["time-standard"] == "LST"
    assert captured["start"] == "20260815"
    assert captured["end"] == "20261111"
    assert result["source"]["id"] == "nasa_power_daily"
    assert result["source"]["retrieved_at"]
    assert result["location"]["requested_latitude"] == 26.5591
    assert len(result["series"]) == 89
    assert result["quality"]["valid_cells"] > 0
    assert result["summaries"]["PRECTOTCORR"]["total"] is not None


def test_fetch_daily_all_fill_raises_no_data(monkeypatch, raw_power_fixture):
    empty = copy.deepcopy(raw_power_fixture)
    for series in empty["properties"]["parameter"].values():
        for day in list(series):
            series[day] = -999.0
    monkeypatch.setattr(power_module, "_request", lambda _params: empty)
    with pytest.raises(PowerNoData):
        fetch_daily(26.5591, 31.6991, start="2026-08-15", end="2026-11-11")


def test_fetch_daily_timeout(monkeypatch):
    monkeypatch.setattr(power_module, "POWER_RETRIES", 0)
    monkeypatch.setattr(power_module.time, "sleep", lambda _seconds: None)

    def fake_get(*_args, **_kwargs):
        raise requests.Timeout("simulated timeout")

    monkeypatch.setattr(power_module.requests, "get", fake_get)
    with pytest.raises(PowerTimeout):
        fetch_daily(26.5591, 31.6991, days=7)


def test_fetch_daily_http_error(monkeypatch):
    monkeypatch.setattr(power_module, "POWER_RETRIES", 0)

    class Response:
        status_code = 503
        text = "service unavailable"

        def json(self):
            raise ValueError("not json")

    monkeypatch.setattr(power_module.requests, "get", lambda *a, **k: Response())
    with pytest.raises(PowerUnavailable):
        fetch_daily(26.5591, 31.6991, days=7)
