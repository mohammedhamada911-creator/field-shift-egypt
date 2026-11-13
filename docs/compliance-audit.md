# Compliance audit — Field Shift Egypt

Audit date: 2026-11-12

> The website was simplified after the recorded browser run: the public UI is now an English-first four-step journey, and the former technical workspace and Methods tab are not included in the interface. Existing browser screenshots document the previous interface only; rerun browser acceptance against the current flow before submission.
Challenge: **Field Shift: Adapting Farms with NASA Data** (NASA Space Apps Challenge 2026)
Official challenge: <https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/>

> The official challenge page could not be fetched directly from the development environment on 2026-11-12. This audit maps the challenge statement supplied for the project. Re-check the live page and current submission rules before upload.

Status terms:

- **Verified** — implemented and supported by a test, live response or browser evidence.
- **Partially verified** — implemented with a documented scope limit.
- **Pending** — not yet completed.

## Requirement-to-evidence table

| Requirement | Evidence in project | Status |
|---|---|---|
| Responds to the Field Shift challenge | Climate baseline, farm soil profile, crop characteristics and weighted rotation comparison are connected in one workflow. The scoring and climate services remain available to the guided journey; the public UI now presents only the four-step farmer flow. | Verified |
| Uses NASA Earth observations | Live NASA POWER responses for Sohag, Alexandria and Aswan; live NASA GIBS previews for SMAP/GPM/MODIS; live NASA CMR granule metadata. See `tests/test_live_power.py`, `tests/test_live_satellites.py`. | Verified |
| Displays official dataset names and source URLs | `GET /api/meta` and the README source table; the simplified results retain NASA POWER source attribution. | Verified |
| Documents variables, resolution and coverage | `GET /api/meta` and satellite cards document spatial resolution, temporal coverage, update frequency, variables and units. | Verified |
| Shows observation period and retrieval date | POWER response includes requested/observation period, latest observation and retrieval timestamp; persisted in SQLite. | Verified |
| Explains how NASA data contributes | Climate charts use POWER; rotation climate factor uses POWER heat days/rain scarcity; GIBS/CMR are labelled visual/metadata context only. | Verified |
| Uses local soil information | User enters texture, pH, organic matter, EC, drainage, irrigation and water source; stored locally and labelled **User input**. No measured external soil survey is claimed. | Verified (user-entered) |
| Includes crop characteristics | 22-crop reference dataset (`static/data/crops_egypt.json`) with water, salinity, heat/drought, cover, residue, rooting and coefficient traits. | Verified |
| Includes farmer priorities | Five configurable rotation weights, normalised to 100; unknown/negative/all-zero weight sets are rejected. | Verified |
| Compares at least three rotation strategies | Four scenarios with scores, factor breakdowns, uncertainty ranges and cautions. | Verified |
| Communicates decision uncertainty honestly | Decision brief reports leader/runner gap, separated vs overlapping sensitivity bands, strongest/weakest factors, risk flags and next checks; explicitly not a confidence interval. | Verified |
| Surfaces climate risk without fabricating forecasts | Five fixed-threshold screening signals derived from real POWER series, each with observed count, threshold, source and caveat; labelled calculated, not a forecast or official warning. | Verified |
| Makes reference crop traits explorable | Searchable 22-crop browser with cycle filters, water/heat/drought/salinity trait bars and a 12-month reference calendar. | Verified |
| Explains scoring method and weights | The backend scoring response retains factor reasons and sources; the public summary shows the comparison without a separate Methods page. | Verified |
| Communicates uncertainty and missing information | Sensitivity bands, confidence labels, missing-input handling, and explicit “not applied” behaviour for mismatched farm profiles. | Verified |
| Avoids unsupported yield/profit claims | UI and README disclaimers; no yield/profit model exists. | Verified |
| Distinguishes measured, modelled, entered and calculated data | Evidence-type cards, source tags, provenance table, reference-data caveats. | Verified |
| Egypt geographic scope | 27 governorates, Sohag pilot, polygon-based Egypt detection, no Egyptian rules outside Egypt, worldwide POWER retrieval retained. | Verified |
| Does not restrict NASA retrieval to Sohag | Live tests cover Sohag, Alexandria and Aswan; browser check covers Aswan. | Verified |
| Handles invalid coordinates, timeouts and missing data | API returns structured 4xx/5xx JSON; tests cover invalid coordinates, upstream timeout, all-fill no-data and missing cells. | Verified |
| Caching and refresh | SQLite cache with TTL tiers; cache hit/miss tests; `refresh=true` bypasses cache. | Verified |
| Quantitative SMAP/GPM/MODIS values | Public GIBS/CMR paths are integrated. Quantitative HDF5/NetCDF access requires Earthdata Login and is explicitly **not enabled**; no values are fabricated. | Partially verified (documented limit) |
| AI usage disclosure | README section and `docs/ai-usage.md`. | Verified |
| Working demonstration | Application runs locally; browser acceptance workflow passes with no console/page errors. | Verified (local) |
| Public repository / project link | No public repository has been published from this environment. | Pending |
| Submission-format demo video and final portal upload | Not produced in this environment. | Pending |
| Agricultural specialist review | Not performed. The assumptions are labelled as simplified reference rules. | Pending / recommended |

## Test evidence

Commands:

```bash
.venv/bin/pytest -q -m "not live"
.venv/bin/pytest -m live -s
.venv/bin/python scripts/browser_check.py
```

Results on 2026-11-12:

- `103 passed, 11 deselected` — deterministic unit/API tests, including 7 climate-risk threshold/missing-data tests and rotation decision-brief/risk-flag tests.
- `11 passed, 103 deselected` — live NASA POWER, GIBS and CMR tests, including live rotation scoring with real POWER climate context.
- Browser check: **PASS** — 5 climate-risk signals with thresholds; 3 satellite cards with loaded GIBS images; map click, Aswan governorate jump, Sohag reset, soil interpretation, profile save; searchable crop browser (22 crops, cycle filters, rice search, 4 trait bars, 12-month calendar); 4 weighted rotation scenarios with decision brief and risk flags; 5+ factor explanations with rules/sources; Aswan end-to-end workflow (former interface). `console_errors: []`, `page_errors: []`.

Evidence files:

- `evidence/browser-check.json`
- `evidence/final-test-results.txt`
- `evidence/phase1-climate-desktop.png`
- `evidence/phase1-climate-mobile.png`
- `evidence/phase3-satellite-desktop.png`
- `evidence/phase4-farm-desktop.png`
- `evidence/phase4-farm-mobile.png`
- `evidence/phase5-rotation-desktop.png`
- `evidence/phase5-rotation-mobile.png`
- `evidence/phase6-methods-desktop.png`
- `evidence/phase6-workflow-aswan.png`
- `evidence/enhancement-climate-risk.png`
- `evidence/enhancement-rotation-brief.png`
- `evidence/enhancement-crop-browser.png`

## Scientific limitations recorded in the product

- NASA POWER is a 0.5° assimilated/model-derived product, not an on-farm measurement.
- GIBS previews are rendered imagery, not numeric retrievals; CMR proves granule existence, not a pixel value.
- Crop and salinity traits are reference ranges from FAO sources, not variety trials.
- Governorate context is a regional synthesis, not a farm soil test or official statistic.
- Rotation scores are exploratory rule-based indicators, not yield, profit or water-use predictions.
- Climate-risk thresholds are fixed, transparent screening rules for a selected historical period; they are not forecasts, official warnings or crop-loss models.
- The rotation decision brief describes sensitivity under the stated weights and uncertainty, not a probability that one sequence will perform better.
- Outside Egypt, NASA climate retrieval remains available but Egyptian crop/soil rules are not applied.

## Submission checklist

- [x] Working application and local run instructions.
- [x] Real NASA data integrations with attribution.
- [x] Source, units, period and retrieval timestamps visible.
- [x] Transparent rotation methodology and uncertainty.
- [x] Transparent, sourced climate-risk screening and decision brief.
- [x] AI usage disclosure.
- [x] Automated test evidence and browser screenshots.
- [ ] Publish a public repository or project link.
- [ ] Record the demonstration in the current official submission format.
- [ ] Re-check the official 2026 submission instructions before upload.
- [ ] Optional: agricultural specialist review of crop and rotation assumptions.
