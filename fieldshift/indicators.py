"""Transparent climate-risk screening from real NASA POWER daily observations.

These are *calculated screening indicators*, not forecasts, official warnings or
agronomic prescriptions. Every signal exposes the threshold that produced it,
the observed count and the source variable so a user can disagree with the rule.
Missing days are excluded, never imputed.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Iterable

SEVERITY_ORDER = {"unknown": -1, "low": 0, "watch": 1, "high": 2}
SEVERITY_LABEL = {"unknown": "No data", "low": "Low", "watch": "Watch", "high": "High"}


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _fmt_date(value: str | None) -> str:
    if not value:
        return "—"
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%d %b %Y")
    except (TypeError, ValueError):
        return value


def _longest_run(
    rows: list[dict[str, Any]], predicate: Callable[[dict[str, Any]], bool]
) -> tuple[int, str | None, str | None]:
    """Return (length, start, end) of the longest consecutive run of matching rows."""
    best = (0, None, None)
    start: str | None = None
    end: str | None = None
    count = 0
    for row in rows:
        if predicate(row):
            day = row.get("date")
            if count == 0:
                start = day
            count += 1
            end = day
        elif count:
            if count > best[0]:
                best = (count, start, end)
            count = 0
            start = end = None
    if count > best[0]:
        best = (count, start, end)
    return best


def _valid(rows: Iterable[dict[str, Any]], key: str) -> list[tuple[str | None, float]]:
    pairs: list[tuple[str | None, float]] = []
    for row in rows:
        value = _number(row.get(key))
        if value is not None:
            pairs.append((row.get("date"), value))
    return pairs


def _run_detail(length: int, start: str | None, end: str | None, noun: str) -> str:
    if length <= 0:
        return f"No consecutive {noun} run was found."
    if start == end:
        return f"Longest run: {length} day ({_fmt_date(start)})."
    return f"Longest run: {length} consecutive days ({_fmt_date(start)} → {_fmt_date(end)})."


def _signal(
    *,
    signal_id: str,
    label: str,
    severity: str,
    value: int | float | None,
    unit: str,
    observed: str,
    detail: str,
    threshold: str,
    basis: str,
    caveat: str,
) -> dict[str, Any]:
    return {
        "id": signal_id,
        "label": label,
        "severity": severity,
        "severity_label": SEVERITY_LABEL[severity],
        "value": value,
        "unit": unit,
        "observed": observed,
        "detail": detail,
        "threshold": threshold,
        "basis": basis,
        "caveat": caveat,
        "kind": "calculated",
    }


def analyze_climate_risk(
    series: list[dict[str, Any]] | None,
    *,
    quality: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build bounded, deterministic climate screening signals from a POWER series.

    The thresholds below are deliberately explicit and simple. They describe the
    *selected historical period*, not the next season, and should not be read as
    official meteorological warnings.
    """
    rows = [row for row in (series or []) if isinstance(row, dict)]
    tmax = _valid(rows, "T2M_MAX")
    rain = _valid(rows, "PRECTOTCORR")
    wind = _valid(rows, "WS2M")
    humidity = _valid(rows, "RH2M")

    period_days = len(rows)
    coverage = (quality or {}).get("completeness_pct")
    if coverage is None:
        covered_days = sum(
            1
            for row in rows
            if any(row.get(key) is not None for key in ("T2M_MAX", "PRECTOTCORR", "WS2M", "RH2M"))
        )
        coverage = round(covered_days / period_days * 100, 1) if period_days else 0.0
    coverage = round(float(coverage), 1)

    if coverage >= 90 and period_days >= 30:
        confidence = "high"
    elif coverage >= 70 and period_days >= 14:
        confidence = "medium"
    else:
        confidence = "low"

    signals: list[dict[str, Any]] = []

    # 1. Heat stress ---------------------------------------------------------
    if tmax:
        values = [value for _, value in tmax]
        hot_days = sum(1 for value in values if value >= 35)
        very_hot_days = sum(1 for value in values if value >= 40)
        share = hot_days / len(values)
        if share >= 0.30 or very_hot_days >= 3:
            severity = "high"
        elif share >= 0.10 or very_hot_days >= 1:
            severity = "watch"
        else:
            severity = "low"
        heat_run = _longest_run(
            rows, lambda row: (_number(row.get("T2M_MAX")) or -999) >= 35
        )
        signals.append(
            _signal(
                signal_id="heat_stress",
                label="Heat stress",
                severity=severity,
                value=hot_days,
                unit="days ≥ 35 °C",
                observed=(
                    f"{hot_days} of {len(values)} valid days ({share:.0%}) reached at least "
                    f"35 °C; {very_hot_days} reached at least 40 °C."
                ),
                detail=(
                    "Maximum daily temperature is the screening variable. "
                    + _run_detail(*heat_run, "≥ 35 °C")
                ),
                threshold=(
                    "High: ≥30% of valid days reach 35 °C, or ≥3 days reach 40 °C. "
                    "Watch: ≥10% of days reach 35 °C, or ≥1 day reaches 40 °C."
                ),
                basis="NASA POWER T2M_MAX",
                caveat=(
                    "Air temperature does not by itself measure crop heat stress; "
                    "growth stage, humidity, wind and irrigation also matter."
                ),
            )
        )
    else:
        signals.append(
            _signal(
                signal_id="heat_stress",
                label="Heat stress",
                severity="unknown",
                value=None,
                unit="days ≥ 35 °C",
                observed="No valid maximum-temperature days in the selected period.",
                detail="The screen cannot calculate heat exposure from this response.",
                threshold="Requires valid NASA POWER T2M_MAX values.",
                basis="NASA POWER T2M_MAX",
                caveat="Missing values are not replaced with zero or with a regional average.",
            )
        )

    # 2. Dry spell ----------------------------------------------------------
    if rain:
        values = [value for _, value in rain]
        dry_days = sum(1 for value in values if value < 1.0)
        share = dry_days / len(values)
        dry_run = _longest_run(
            rows, lambda row: (_number(row.get("PRECTOTCORR")) or 0.0) < 1.0
            if _number(row.get("PRECTOTCORR")) is not None
            else False
        )
        if (share >= 0.90 and len(values) >= 7) or dry_run[0] >= 30:
            severity = "high"
        elif share >= 0.60 or dry_run[0] >= 14:
            severity = "watch"
        else:
            severity = "low"
        signals.append(
            _signal(
                signal_id="dry_spell",
                label="Dry spell",
                severity=severity,
                value=dry_days,
                unit="days < 1 mm",
                observed=(
                    f"{dry_days} of {len(values)} valid days ({share:.0%}) had less than "
                    "1 mm of precipitation."
                ),
                detail=_run_detail(*dry_run, "days below 1 mm"),
                threshold=(
                    "High: ≥90% of valid days below 1 mm (with at least 7 days), or a run "
                    "of ≥30 days. Watch: ≥60% of days, or a run of ≥14 days."
                ),
                basis="NASA POWER PRECTOTCORR",
                caveat=(
                    "Rain is not irrigation. A dry screen highlights reliance on stored soil "
                    "water and irrigation; it does not calculate crop water requirements."
                ),
            )
        )
    else:
        signals.append(
            _signal(
                signal_id="dry_spell",
                label="Dry spell",
                severity="unknown",
                value=None,
                unit="days < 1 mm",
                observed="No valid precipitation days in the selected period.",
                detail="The screen cannot calculate dry-spell exposure from this response.",
                threshold="Requires valid NASA POWER PRECTOTCORR values.",
                basis="NASA POWER PRECTOTCORR",
                caveat="A missing series is not treated as zero rainfall.",
            )
        )

    # 3. Heavy rain ---------------------------------------------------------
    if rain:
        values = [value for _, value in rain]
        heavy_days = sum(1 for value in values if value >= 10.0)
        max_date, max_value = max(rain, key=lambda pair: pair[1])
        severity = "high" if heavy_days >= 3 else ("watch" if heavy_days >= 1 else "low")
        signals.append(
            _signal(
                signal_id="heavy_rain",
                label="Heavy-rain days",
                severity=severity,
                value=heavy_days,
                unit="days ≥ 10 mm",
                observed=(
                    f"{heavy_days} of {len(values)} valid days reached at least 10 mm; "
                    f"the largest daily total was {max_value:.1f} mm on {_fmt_date(max_date)}."
                ),
                detail=(
                    "Single-day totals of 10 mm or more are screened because they can affect "
                    "infiltration, erosion and field access."
                ),
                threshold="High: ≥3 days at or above 10 mm. Watch: ≥1 such day.",
                basis="NASA POWER PRECTOTCORR",
                caveat=(
                    "This is a daily-total screen, not a flood, erosion or drainage model. "
                    "Short intense storms may be under-represented in daily data."
                ),
            )
        )
    else:
        signals.append(
            _signal(
                signal_id="heavy_rain",
                label="Heavy-rain days",
                severity="unknown",
                value=None,
                unit="days ≥ 10 mm",
                observed="No valid precipitation days in the selected period.",
                detail="The screen cannot calculate heavy-rain exposure from this response.",
                threshold="Requires valid NASA POWER PRECTOTCORR values.",
                basis="NASA POWER PRECTOTCORR",
                caveat="Missing values are not replaced with zero.",
            )
        )

    # 4. Wind ---------------------------------------------------------------
    if wind:
        values = [value for _, value in wind]
        windy_days = sum(1 for value in values if value >= 6.0)
        share = windy_days / len(values)
        if share >= 0.20:
            severity = "high"
        elif share >= 0.05:
            severity = "watch"
        else:
            severity = "low"
        wind_run = _longest_run(
            rows, lambda row: (_number(row.get("WS2M")) or 0.0) >= 6.0
            if _number(row.get("WS2M")) is not None
            else False
        )
        signals.append(
            _signal(
                signal_id="wind",
                label="Strong-wind days",
                severity=severity,
                value=windy_days,
                unit="days ≥ 6 m/s",
                observed=(
                    f"{windy_days} of {len(values)} valid days ({share:.0%}) reached at least "
                    "6 m/s (about 22 km/h) at 2 m."
                ),
                detail=_run_detail(*wind_run, "days ≥ 6 m/s"),
                threshold="High: ≥20% of valid days. Watch: ≥5% of valid days.",
                basis="NASA POWER WS2M",
                caveat=(
                    "Screening context for spraying, irrigation uniformity and young plants; "
                    "it is not a wind-erosion or structural-safety assessment."
                ),
            )
        )
    else:
        signals.append(
            _signal(
                signal_id="wind",
                label="Strong-wind days",
                severity="unknown",
                value=None,
                unit="days ≥ 6 m/s",
                observed="No valid wind days in the selected period.",
                detail="The screen cannot calculate wind exposure from this response.",
                threshold="Requires valid NASA POWER WS2M values.",
                basis="NASA POWER WS2M",
                caveat="Missing wind values are not treated as calm conditions.",
            )
        )

    # 5. Low humidity -------------------------------------------------------
    if humidity:
        values = [value for _, value in humidity]
        dry_air_days = sum(1 for value in values if value < 20.0)
        share = dry_air_days / len(values)
        if share >= 0.30:
            severity = "high"
        elif share >= 0.10:
            severity = "watch"
        else:
            severity = "low"
        signals.append(
            _signal(
                signal_id="low_humidity",
                label="Low-humidity days",
                severity=severity,
                value=dry_air_days,
                unit="days < 20%",
                observed=(
                    f"{dry_air_days} of {len(values)} valid days ({share:.0%}) had mean "
                    "relative humidity below 20%."
                ),
                detail=(
                    "Daily mean relative humidity at 2 m. Low values raise atmospheric "
                    "evaporative demand."
                ),
                threshold="High: ≥30% of valid days. Watch: ≥10% of valid days.",
                basis="NASA POWER RH2M",
                caveat=(
                    "Relative humidity is not reference evapotranspiration; it does not "
                    "replace an irrigation schedule or an ET calculation."
                ),
            )
        )
    else:
        signals.append(
            _signal(
                signal_id="low_humidity",
                label="Low-humidity days",
                severity="unknown",
                value=None,
                unit="days < 20%",
                observed="No valid humidity days in the selected period.",
                detail="The screen cannot calculate low-humidity exposure from this response.",
                threshold="Requires valid NASA POWER RH2M values.",
                basis="NASA POWER RH2M",
                caveat="Missing humidity values are not replaced with a regional average.",
            )
        )

    ranked = [signal for signal in signals if signal["severity"] != "unknown"]
    overall = max(ranked, key=lambda item: SEVERITY_ORDER[item["severity"]])["severity"] if ranked else "unknown"
    high_labels = [signal["label"] for signal in signals if signal["severity"] == "high"]
    watch_labels = [signal["label"] for signal in signals if signal["severity"] == "watch"]

    if overall == "unknown":
        summary = "No screening signal could be calculated because the response has no usable values."
    else:
        parts = []
        if high_labels:
            parts.append(f"HIGH: {', '.join(high_labels)}")
        if watch_labels:
            parts.append(f"WATCH: {', '.join(watch_labels)}")
        if not parts:
            parts.append("No high or watch signal crossed its threshold")
        summary = f"{'; '.join(parts)}. Calculated from {period_days} requested day(s), not a forecast."

    caveats = [
        "Screening rules are fixed thresholds applied to the selected historical period; they are not official warnings, forecasts or crop-loss estimates.",
        "Signals use NASA POWER grid-cell estimates and inherit their model uncertainty and multi-day latency.",
        "Missing days are excluded from each signal; no missing value is replaced with zero or a regional average.",
        "Heat and dry-spell pressures are the same inputs used by the rotation climate-resilience factor. The screen does not change rotation weights automatically.",
    ]
    if coverage < 80:
        caveats.append(f"Data coverage is {coverage:.1f}%, so screening confidence is reduced.")

    return {
        "kind": "calculated",
        "source": "Derived from NASA POWER daily point data",
        "method": (
            "Fixed, explicit thresholds applied to daily T2M_MAX, PRECTOTCORR, WS2M and RH2M. "
            "Counts describe the selected period only."
        ),
        "period_days": period_days,
        "coverage_pct": coverage,
        "confidence": confidence,
        "overall_severity": overall,
        "overall_label": SEVERITY_LABEL[overall],
        "summary": summary,
        "signals": signals,
        "caveats": caveats,
        "disclaimer": (
            "Calculated screening indicator, not an official alert, forecast or agronomic "
            "recommendation. Confirm decisions with local extension advice and field checks."
        ),
    }
