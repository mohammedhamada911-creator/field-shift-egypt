# Test fixtures

`power_sohag_90d.json` is an **unmodified live response** from the NASA POWER
Daily Point API, not a hand-written or fabricated payload.

- Retrieved: 2026-11-12 (UTC)
- Requested point: 26.5591 N, 31.6991 E (Sohag Governorate, Egypt)
- Requested period: 2026-08-15 to 2026-11-12
- Parameters: T2M, T2M_MAX, T2M_MIN, PRECTOTCORR, ALLSKY_SFC_SW_DWN, RH2M, WS2M, GWETROOT
- Community: AG; time standard: LST; format: JSON
- Endpoint: `https://power.larc.nasa.gov/api/temporal/daily/point`

The file is used only for deterministic parsing/API tests. The live integration
test in `tests/test_live_power.py` always contacts the real API.
