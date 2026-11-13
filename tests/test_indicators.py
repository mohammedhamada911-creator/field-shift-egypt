from __future__ import annotations

from fieldshift.indicators import analyze_climate_risk


def make_series(*, days: int = 30, tmax=35.0, rain=0.0, wind=2.0, rh=30.0):
    return [
        {
            "date": f"2026-10-{day:02d}",
            "T2M_MAX": tmax(day) if callable(tmax) else tmax,
            "PRECTOTCORR": rain(day) if callable(rain) else rain,
            "WS2M": wind(day) if callable(wind) else wind,
            "RH2M": rh(day) if callable(rh) else rh,
        }
        for day in range(1, days + 1)
    ]


def test_hot_dry_period_is_flagged_high_with_counts():
    result = analyze_climate_risk(make_series(days=30, tmax=38, rain=0.0), quality={"completeness_pct": 100})
    assert result["overall_severity"] == "high"
    assert result["confidence"] == "high"
    heat = next(signal for signal in result["signals"] if signal["id"] == "heat_stress")
    dry = next(signal for signal in result["signals"] if signal["id"] == "dry_spell")
    assert heat["severity"] == "high"
    assert heat["value"] == 30
    assert "30 of 30 valid days" in heat["observed"]
    assert dry["severity"] == "high"
    assert dry["value"] == 30
    assert "30 consecutive days" in dry["detail"]
    assert "not a forecast" in result["summary"]


def test_cool_wet_period_is_low_and_not_flagged():
    result = analyze_climate_risk(
        make_series(days=30, tmax=25, rain=2.0, wind=1.0, rh=55.0),
        quality={"completeness_pct": 100},
    )
    assert result["overall_severity"] == "low"
    heat = next(signal for signal in result["signals"] if signal["id"] == "heat_stress")
    dry = next(signal for signal in result["signals"] if signal["id"] == "dry_spell")
    assert heat["severity"] == "low"
    assert dry["severity"] == "low"
    assert "No high or watch signal" in result["summary"]


def test_watch_thresholds_and_heavy_rain_are_explicit():
    # 4 of 20 days (20%) reach 35 C: below the 30% high threshold, above the 10% watch threshold.
    series = make_series(days=20, tmax=lambda day: 36.0 if day % 5 == 0 else 30.0, rain=0.0)
    series[5]["PRECTOTCORR"] = 12.0
    result = analyze_climate_risk(series, quality={"completeness_pct": 100})
    heat = next(signal for signal in result["signals"] if signal["id"] == "heat_stress")
    heavy = next(signal for signal in result["signals"] if signal["id"] == "heavy_rain")
    assert heat["severity"] == "watch"
    assert heavy["severity"] == "watch"
    assert heavy["value"] == 1
    assert "12.0 mm" in heavy["observed"]
    assert "≥1 such day" in heavy["threshold"]


def test_missing_values_are_excluded_not_imputed():
    rows = [
        {"date": "2026-10-01", "T2M_MAX": None, "PRECTOTCORR": None, "WS2M": None, "RH2M": None},
        {"date": "2026-10-02", "T2M_MAX": None, "PRECTOTCORR": None, "WS2M": None, "RH2M": None},
    ]
    result = analyze_climate_risk(rows, quality={"completeness_pct": 0})
    assert result["overall_severity"] == "unknown"
    assert result["confidence"] == "low"
    for signal in result["signals"]:
        assert signal["severity"] == "unknown"
        assert signal["value"] is None
        assert "not replaced" in signal["caveat"] or "not treated" in signal["caveat"]
    assert "no usable values" in result["summary"]


def test_partial_series_marks_only_unavailable_signal_unknown():
    rows = make_series(days=30, tmax=30, rain=0.0)
    for row in rows:
        row["WS2M"] = None
    result = analyze_climate_risk(rows, quality={"completeness_pct": 75})
    wind = next(signal for signal in result["signals"] if signal["id"] == "wind")
    dry = next(signal for signal in result["signals"] if signal["id"] == "dry_spell")
    assert wind["severity"] == "unknown"
    assert dry["severity"] == "high"
    assert result["confidence"] == "medium"
    assert any("coverage" in caveat.lower() for caveat in result["caveats"])


def test_wind_and_humidity_thresholds():
    rows = make_series(days=20, tmax=25, rain=1.0, wind=7.0, rh=10.0)
    result = analyze_climate_risk(rows, quality={"completeness_pct": 100})
    wind = next(signal for signal in result["signals"] if signal["id"] == "wind")
    humidity = next(signal for signal in result["signals"] if signal["id"] == "low_humidity")
    assert wind["severity"] == "high"
    assert humidity["severity"] == "high"
    assert "6 m/s" in wind["observed"]
    assert "20%" in humidity["observed"]


def test_single_day_period_is_low_confidence_and_still_deterministic():
    rows = [{"date": "2026-10-01", "T2M_MAX": 41.0, "PRECTOTCORR": 0.0, "WS2M": 8.0, "RH2M": 10.0}]
    first = analyze_climate_risk(rows, quality={"completeness_pct": 100})
    second = analyze_climate_risk(rows, quality={"completeness_pct": 100})
    assert first["confidence"] == "low"
    assert first["signals"] == second["signals"]
    assert first["overall_severity"] == "high"
