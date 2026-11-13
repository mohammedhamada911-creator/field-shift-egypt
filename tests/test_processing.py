from __future__ import annotations

from datetime import date

import pytest

from fieldshift.processing import (
    as_float,
    build_series,
    canonical_unit,
    clean_series,
    convert_value,
    data_quality,
    parse_power_payload,
    summarize_parameter,
)


def test_as_float_preserves_real_zero():
    assert as_float(0.0) == 0.0
    assert as_float("0") == 0.0
    assert as_float(0) == 0.0


def test_as_float_rejects_fill_and_invalid():
    assert as_float(-999.0) is None
    assert as_float(-999) is None
    assert as_float(None) is None
    assert as_float("") is None
    assert as_float("not-a-number") is None
    assert as_float(float("nan")) is None
    assert as_float(float("inf")) is None
    assert as_float(True) is None


def test_clean_series_keeps_gaps_as_none():
    cleaned = clean_series({"20260101": 12.5, "20260102": -999.0, "20260103": 0.0})
    assert cleaned == {"20260101": 12.5, "20260102": None, "20260103": 0.0}


def test_summarize_ignores_missing_for_mean_but_counts_it():
    series = {"20260101": 10.0, "20260102": None, "20260103": 20.0, "20260104": -999.0}
    summary = summarize_parameter("T2M", {k: as_float(v) for k, v in series.items()})
    assert summary["valid_days"] == 2
    assert summary["missing_days"] == 2
    assert summary["mean"] == 15.0
    assert summary["min"] == 10.0
    assert summary["max"] == 20.0
    assert summary["first_observation"] == "2026-01-01"
    assert summary["last_observation"] == "2026-01-03"


def test_precipitation_zero_is_not_missing():
    series = {"20260101": 0.0, "20260102": None, "20260103": 4.2}
    summary = summarize_parameter("PRECTOTCORR", series)
    assert summary["total"] == 4.2
    assert summary["wet_days"] == 1
    assert summary["valid_days"] == 2
    assert summary["missing_days"] == 1


def test_build_series_adds_expected_missing_dates():
    rows, cleaned = build_series(
        {"T2M": {"20260101": 10.0, "20260103": 12.0}},
        expected_dates=["20260101", "20260102", "20260103", "20260104"],
    )
    assert len(rows) == 4
    assert rows[1] == {"date": "2026-01-02", "T2M": None}
    assert cleaned["T2M"]["20260102"] is None


def test_data_quality_reports_completeness_without_imputing():
    cleaned = {
        "T2M": {"20260101": 10.0, "20260102": None},
        "PRECTOTCORR": {"20260101": 0.0, "20260102": 0.0},
    }
    summaries = {name: summarize_parameter(name, series) for name, series in cleaned.items()}
    rows = [
        {"date": "2026-01-01", "T2M": 10.0, "PRECTOTCORR": 0.0},
        {"date": "2026-01-02", "T2M": None, "PRECTOTCORR": 0.0},
    ]
    quality = data_quality(rows, cleaned, summaries)
    assert quality["valid_cells"] == 3
    assert quality["missing_cells"] == 1
    assert quality["completeness_pct"] == 75.0
    assert quality["missing_days_by_parameter"] == {"T2M": 1, "PRECTOTCORR": 0}
    assert quality["missing_value_policy"].startswith("Missing/fill values are null")


def test_parse_real_power_fixture(raw_power_fixture):
    header = raw_power_fixture["header"]
    requested = {"start": "2026-08-15", "end": "2026-11-11"}
    params = ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN", "RH2M", "WS2M", "GWETROOT"]
    parsed = parse_power_payload(raw_power_fixture, requested=requested, parameters=params)

    assert header["start"] == "20260815"
    assert len(parsed["series"]) == 89
    assert parsed["quality"]["days"] == 89
    assert parsed["quality"]["parameters"] == 8
    assert parsed["quality"]["latest_observation"] <= "2026-11-11"
    assert 0 < parsed["quality"]["completeness_pct"] <= 100

    # Every returned value must either be a real number or null. No fill leakage.
    for row in parsed["series"]:
        for parameter in params:
            value = row[parameter]
            assert value is None or (isinstance(value, float) and value != -999.0)

    # The Sohag fixture's August-November period is largely dry; a zero is real.
    rain = parsed["summaries"]["PRECTOTCORR"]
    assert rain["total"] is not None
    assert rain["valid_days"] > 0
    assert parsed["summaries"]["T2M"]["mean"] is not None
    assert -5 < parsed["summaries"]["T2M"]["mean"] < 50


def test_parse_power_payload_missing_parameter_raises(raw_power_fixture):
    with pytest.raises(ValueError, match="did not include"):
        parse_power_payload(
            raw_power_fixture,
            requested={"start": "2026-08-15", "end": "2026-11-11"},
            parameters=["NOT_A_POWER_PARAM"],
        )


def test_date_round_trip():
    assert date(2026, 11, 8).isoformat() == "2026-11-08"


def test_unit_conversions_and_missing_values():
    assert convert_value(0, "°C", "°F") == 32.0
    assert convert_value(100, "°C", "°F") == 212.0
    assert convert_value(32, "°F", "°C") == 0.0
    assert convert_value(25.4, "mm", "in") == 1.0
    assert convert_value(1, "kWh/m²/day", "MJ/m²/day") == 3.6
    assert convert_value(3.6, "m/s", "km/h") == 12.96
    assert convert_value(None, "°C", "°F") is None
    assert convert_value(-999.0, "°C", "°F") is None
    assert canonical_unit("T2M") == "°C"
    assert canonical_unit("PRECTOTCORR") == "mm/day"
    with pytest.raises(ValueError, match="Unsupported"):
        convert_value(1, "kg", "lb")
