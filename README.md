# Field Shift Egypt

**Field Shift: Adapting Farms with NASA Data** — an Egypt-focused decision-support prototype for the 2026 NASA Space Apps Challenge.

The application combines real NASA Earth observations, user-entered soil information, reference crop characteristics and configurable farmer priorities to compare crop-rotation scenarios. It is deliberately transparent about what is measured, what is modelled, what is entered by the user, and what is only an exploratory indicator.

- **Pilot region:** Sohag Governorate, Egypt (26.5591° N, 31.6991° E)
- **Geographic coverage:** all 27 Egyptian governorates; NASA climate retrieval is not restricted to Sohag
- **Official challenge:** <https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/>
- **NASA endorsement:** none. This is an independent prototype; NASA does not endorse the application or its recommendations.

> **Not a recommendation engine.** Rotation scores are not yield, profit, water-use or food-security predictions. Local soil tests, variety trials and extension advice take precedence.

## What works

| Farmer-facing step | What it does |
|---|---|
| Pick a farm | Choose a point on the map, use a governorate centre, or share your location. |
| Describe the land | Add soil type, irrigation and water details; skip anything unknown. Optional lab details stay tucked away. |
| Choose priorities | Select what matters most, such as water, soil health or crop diversity. |
| Review the result | See a short climate summary, four rotation options, missing information and next steps. |

The public interface is now an English-first, four-step flow with an Arabic language switch. The Methods tab and technical workspace have been removed from the website; result cards retain short source and uncertainty notes. The detailed source and compliance notes remain in this README for the competition team.

## Quick start

Requirements: Python 3.11+ (developed on Python 3.14), internet access for live NASA data.

```bash
cd field-shift
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python app.py
```

Open <http://127.0.0.1:8000>. The interface uses semantic HTML, CSS and vanilla JavaScript served by Flask; it deliberately has no npm/React build step so it stays straightforward to run and deploy.

Optional browser acceptance test (installs Chromium once):

```bash
.venv/bin/python -m playwright install chromium
.venv/bin/python scripts/browser_check.py
```

### Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `PORT` | `8000` | Flask port |
| `FIELDSHIFT_DB` | `data/fieldshift.sqlite3` | SQLite database path |
| `FIELDSHIFT_CACHE_TTL` | `21600` (6 h) | Recent-data cache TTL in seconds |
| `FIELDSHIFT_POWER_TIMEOUT` | `45` | NASA POWER read timeout in seconds |
| `FIELDSHIFT_DEBUG` | unset | Set to `1` for Flask debug mode |

## Deploy to Vercel

The app is live at <https://field-shift-egypt.vercel.app> in the separate Vercel project `field-shift-egypt`. Vercel detects the Flask app from `app.py`, installs runtime dependencies from `requirements.txt`, and uses Python 3.12. Its static assets are mirrored under `public/static` for Vercel's CDN; keep that directory synchronized with `static` when changing the UI. The repository has a different Vercel project at its parent directory. If enabling Git-based deployments, set the Vercel Root Directory to `field-shift`.

Vercel Functions have a read-only deployment filesystem, so the app uses `/tmp/fieldshift.sqlite3` when it detects Vercel. `/tmp` is temporary and local to a function instance: cached NASA responses and server-side saved analyses may disappear or differ between instances. Browser-stored farm profiles remain in that browser. This setup is suitable for a preview/demo; use a managed persistent database and move the server-side cache and saved analyses there before relying on them in production.

## Tests

```bash
# Fast, deterministic tests (network mocked; includes a real POWER fixture)
.venv/bin/pytest -q -m "not live"

# Live integration tests (contact NASA POWER, GIBS and CMR)
.venv/bin/pytest -m live -s

```

Verified in this environment on 2026-11-12:

- **109 unit/API tests passed**, 11 deselected (live).
- **11 live tests passed**: real NASA POWER for Sohag, Alexandria and Aswan; real GIBS imagery; real CMR granule metadata; live rotation scoring using a real POWER climate context.
- **Current browser smoke check passed**: both language choices, all six primary views, 390 px mobile layout, and no browser JavaScript errors or horizontal overflow. Run it with the Flask server running using `.venv/bin/python scripts/browser_check.py`; results are saved in `evidence/current-browser-check.json` and `evidence/current-browser-smoke.png`.
- Earlier screenshots cover a former technical dashboard. They are retained as historical evidence and do not describe the current interface.
- Evidence: `evidence/browser-check.json`, `evidence/final-test-results.txt`, `evidence/phase1-climate-desktop.png`, `evidence/phase1-climate-mobile.png`, `evidence/phase3-satellite-desktop.png`, `evidence/phase4-farm-desktop.png`, `evidence/phase4-farm-mobile.png`, `evidence/phase5-rotation-desktop.png`, `evidence/phase5-rotation-mobile.png`, `evidence/phase6-methods-desktop.png`, `evidence/phase6-workflow-aswan.png`, `evidence/enhancement-climate-risk.png`, `evidence/enhancement-rotation-brief.png`, `evidence/enhancement-crop-browser.png`.

## Architecture

```text
app.py                     Flask app factory and security headers
fieldshift/
  power.py                 NASA POWER client, coordinate/date validation, retries
  processing.py            Fill handling, date normalization, summaries, unit conversion
  storage.py               SQLite schema, cache, observations, farm profiles, stats
  service.py               Cache-aware climate query and TTL policy
  indicators.py            Fixed-threshold climate-risk screening from POWER series
  geo.py                   Egyptian governorate boundaries and point lookup
  agri.py                  Soil interpretation, crop and governorate reference data
  satellites.py            NASA GIBS imagery + NASA CMR granule metadata
  rotation.py              Rule-based rotation scoring, weights, uncertainty
  api.py                   JSON API routes
templates/index.html       Single-page application shell
static/js/                 Current farmer journey plus retained legacy expert modules (not loaded by the simplified page)
static/data/               27-governorate and 22-crop reference datasets
static/vendor/             Locally vendored Chart.js, Leaflet and marker assets
tests/                     Unit, API, fixture and live integration tests
scripts/browser_check.py   Playwright acceptance workflow
docs/                      Compliance audit and AI usage disclosure
evidence/                  Screenshots and machine-readable browser evidence
```

## Data sources and attribution

| Dataset | Variables used here | Resolution / coverage | Access | Official links |
|---|---|---|---|---|
| **NASA POWER — Daily Point API** (AG community, LST) | `T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `ALLSKY_SFC_SW_DWN`, `RH2M`, `WS2M`, `GWETROOT` | 0.5° × 0.5° grid cell; 1981-01-01 to near real time, several days latency | Public, no login | [POWER](https://power.larc.nasa.gov/) · [API docs](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) |
| **NASA SMAP `SPL3SMP_E` V006** | Daytime soil-moisture imagery context; CMR granule metadata | 9 km enhanced L3, daily | GIBS/CMR public; quantitative HDF5/OPeNDAP requires Earthdata Login | [NSIDC](https://nsidc.org/data/spl3smp_e) · [DOI](https://doi.org/10.5067/OMEAKG6GJ1Q2) |
| **NASA GPM IMERG Late Run `GPM_3IMERGDL` V07** | Precipitation-rate imagery context; CMR granule metadata | 0.1° × 0.1°, daily | GIBS/CMR public; quantitative NetCDF requires Earthdata Login | [GPM IMERG](https://gpm.nasa.gov/data/imerg) · [GES DISC](https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDL_07/summary) |
| **NASA MODIS `MOD13Q1` V061** | NDVI imagery context; CMR granule metadata | 250 m, 16-day composite | GIBS/CMR public; quantitative HDF4/COG requires Earthdata Login | [LP DAAC](https://lpdaac.usgs.gov/products/mod13q1v061/) · [DOI](https://doi.org/10.5067/MODIS/MOD13Q1.061) |

### How NASA data contributes

- **POWER** supplies the climate baseline, charted variables, the heat-day / rain-scarcity pressures used by the rotation climate factor, and the five climate-risk screening signals.
- **GIBS** supplies rendered satellite previews so users can see spatial context without a credentialed data pipeline.
- **CMR** confirms that recent granules exist for the selected area and time window. CMR metadata is **not** a measured value.
- The app never asks for, stores or fakes NASA Earthdata credentials. Quantities that require login are labelled unavailable.

### Climate-risk screening

The Climate tab applies five fixed rules to the selected historical POWER window:

| Signal | Variable | High threshold | Watch threshold |
|---|---|---|---|
| Heat stress | `T2M_MAX` | ≥30% of valid days ≥35 °C, or ≥3 days ≥40 °C | ≥10% of days ≥35 °C, or ≥1 day ≥40 °C |
| Dry spell | `PRECTOTCORR` | ≥90% of days <1 mm (≥7 days), or a run ≥30 days | ≥60% of days <1 mm, or a run ≥14 days |
| Heavy rain | `PRECTOTCORR` | ≥3 days ≥10 mm | ≥1 day ≥10 mm |
| Strong wind | `WS2M` | ≥20% of valid days ≥6 m/s | ≥5% of days ≥6 m/s |
| Low humidity | `RH2M` | ≥30% of valid days <20% | ≥10% of days <20% |

Each card shows the observed count, the threshold, the source variable, the longest run where relevant, and a caveat. Overall severity is the highest non-unknown signal. Coverage below 80% is called out and lowers screening confidence. Missing days are excluded, never imputed. These are **calculated screening indicators for the selected period**, not forecasts, official warnings or crop-loss estimates; rain is not irrigation, and air temperature is not by itself crop heat stress.

### Data handling rules

- POWER fill values (`-999`) and non-finite values become `null`; a real `0.0` (for example a dry day) stays `0.0`.
- Missing dates in the requested range are explicit gaps, not zeros or interpolated values.
- Each response records its source, units, requested period, observation dates, retrieval time and cache status.
- Cache TTL depends on data age: 30 days for windows ending ≥60 days ago, 1 day for ≥14 days, otherwise the configured recent TTL.
- `refresh=true` bypasses the cache; the UI's **Refresh NASA data** button requests fresh values.

## Crop-rotation method

Four reference sequences are compared:

1. **Cereal–fodder resilience** — wheat → maize → berseem → sorghum.
2. **Salt-aware barley rotation** — barley → cotton → wheat → sorghum.
3. **Water-thrifty rotation** — barley → sorghum → chickpea → sesame.
4. **Diversified market rotation** — onion → tomato → faba bean → sunflower.

Five factors produce a 0–100 score:

| Factor | Default weight | Main inputs |
|---|---:|---|
| Water balance | 25 | Crop water-demand levels; irrigation method and water source |
| Salinity fit | 20 | Crop approximate ECe thresholds; user EC (or lower-confidence trait-only score) |
| Climate resilience | 20 | Crop heat/drought traits; POWER heat days and rain scarcity |
| Soil protection | 15 | Crop cover/residue traits; user organic matter |
| Diversity & continuity | 20 | Legume share, family diversity, season alternation |

The total is `Σ(normalised weight × factor score) / Σ weights of available factors`. Weights are normalised to 100; unknown names, negative values and all-zero weights are rejected. Every factor exposes its reasons, rule, source, data quality and uncertainty.

The displayed band propagates independent factor uncertainty: `σ = √Σ(weight × uncertainty)²`, shown as an approximately 80% sensitivity band (±1.28σ). It is a transparency device, **not** a calibrated probability of success. Crop traits are reference ranges, not variety-specific measurements.

The decision brief adds a plain-language layer on top of the ranking: the leader-to-runner gap, whether their sensitivity bands are separated or overlapping, which factor contributes most and least to the leader, and which inputs are missing. It also lists per-scenario risk flags when a factor scores below 50/100 and recommends concrete next checks (for example, add a measured EC, state the irrigation method, or review missing NASA days). The brief never upgrades a small or overlapping gap into a confident recommendation.

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness and version |
| GET | `/api/meta` | Application metadata and POWER attribution |
| GET | `/api/governorates` | 27 Egyptian governorate reference records |
| GET | `/api/location?lat=&lon=` | Egypt/outside-Egypt and governorate lookup |
| GET | `/api/power?lat=&lon=&start=&end=&days=&refresh=` | Cleaned POWER data with provenance |
| GET | `/api/storage/stats` | SQLite cache/run/observation statistics |
| GET | `/api/storage/observations` | Observation counts by source/parameter |
| GET | `/api/satellite/sources`, `/api/satellite/status` | Product metadata and live GIBS/CMR status |
| GET | `/api/satellite/image/<source>?lat=&lon=&date=` | NASA GIBS PNG preview |
| GET | `/api/crops` | 22-crop reference characteristics |
| GET | `/api/agri/reference?governorate=|lat=&lon=` | Governorate reference context |
| POST | `/api/soil/interpret` | Calculated soil indicators from user fields |
| POST/GET | `/api/farm/profile`, `/api/farm/profiles`, `/api/farm/profile/latest` | Local farm-profile persistence |
| GET | `/api/rotations/scenarios` | Scenarios, factors and default weights |
| POST | `/api/rotations/score` | Weighted scoring; optional `lat`/`lon` for live POWER context |

## Egypt-focused scope

- All 27 governorates are selectable; each has a representative centre for convenience.
- Sohag is the pilot and integration-test region.
- Sohag-specific agricultural assumptions are **not** automatically transferred to other governorates or outside Egypt.
- Egyptian crop/soil rules are applied only when the point resolves inside an Egyptian governorate polygon. A bounding-box-only “inside Egypt” label was deliberately rejected because it mislabels parts of Libya, Sudan, Saudi Arabia and the Mediterranean/Red Sea.
- NASA POWER retrieval works for coordinates worldwide; agricultural interpretation remains Egypt-scoped.

## Known limitations

- **No quantitative SMAP/GPM/MODIS point values.** NASA GIBS previews and CMR metadata are public, but the underlying granules require Earthdata Login. No credentialed subsetting worker is implemented.
- **GIBS dates can be visually blank** while processing catches up. A returned image proves the layer/date path responded, not that the selected pixel contains a valid retrieval.
- **POWER is a grid-cell product**, not an on-farm sensor, and typically lags real time by several days.
- **Climate-risk thresholds are not locally calibrated.** They are fixed, transparent screening rules for the selected period. They do not model crop stage, irrigation, soil water or yield loss, and they are not official meteorological warnings.
- **The rotation decision brief is a sensitivity aid**, not a statistical confidence interval or a probability that one sequence will outperform another.
- **No measured local soil database.** Soil values come from the user and stay marked as user input; governorate descriptions are regional reference syntheses.
- **No yield, profit, water-saving or soil-carbon model.** The rotation comparison is an exploratory, rule-based indicator.
- **Reference crop traits** vary by variety, soil and management; they are not a substitute for local trials or extension advice.
- **Basemap tiles come from OpenStreetMap** and require internet access; governorate boundaries remain usable if tiles fail.
- **Single-user local prototype**: no authentication, multi-tenancy or production deployment hardening.
- **No automated accessibility audit**; semantic landmarks and labels are present, but a formal WCAG review is still outstanding.

## AI usage disclosure

AI assistance was used during development: **DeepSeek V4.1 Flash Free via the OpenCode coding agent** helped write code, tests, interface text and documentation. **Codex desktop (GPT-6)** simplified the public interface, set English as the default language, removed the technical workspace and Methods page, and made the farmer journey load its governorate list directly. AI output was checked against the cited NASA, FAO and geospatial sources and against live API responses. AI-generated content is not presented as a verified scientific finding, and the agricultural assumptions require specialist review before real-world use. See [`docs/ai-usage.md`](docs/ai-usage.md).

## Compliance audit

The requirement-to-evidence audit is in [`docs/compliance-audit.md`](docs/compliance-audit.md). The official challenge page was not directly reachable from the development environment on 2026-11-12, so the mapping uses the challenge statement supplied for this project; re-check the live official page before submission. Summary:

| Requirement | Evidence in project | Status |
|---|---|---|
| Responds to the Field Shift challenge | Climate, soil, crop and weighted rotation modules | Verified |
| Uses NASA data | Live POWER, GIBS and CMR integrations; source attribution | Verified |
| Uses local soil information | User soil profile with explicit provenance | Verified (user-entered; no external soil survey) |
| Includes crop characteristics | 22-crop reference dataset and crop library | Verified |
| Includes farmer priorities | Five configurable weights | Verified |
| Compares rotation strategies | Four scored scenarios with explanations | Verified |
| Calculated climate-risk screening | Five explicit, sourced signals with threshold, count, coverage and caveat | Verified |
| Explains scientific limitations | Short result/footer caveats and README | Verified |
| Discloses AI usage | README and `docs/ai-usage.md` | Verified |
| Submission requirements | Working app and docs; public repository/demo not yet published | Pending final submission steps |

## References

- NASA POWER: <https://power.larc.nasa.gov/>
- NASA POWER daily API documentation: <https://power.larc.nasa.gov/docs/services/api/temporal/daily/>
- NASA GIBS API documentation: <https://nasa-gibs.github.io/gibs-api-docs/>
- NASA CMR API documentation: <https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html>
- NASA Earthdata Login: <https://urs.earthdata.nasa.gov/>
- FAO Irrigation and Drainage Paper 56: <https://www.fao.org/3/x0490e/x0490e00.htm>
- FAO Irrigation and Drainage Paper 29: <https://www.fao.org/3/t0234e/t0234e00.htm>
- FAO EcoCrop: <https://ecocrop.fao.org/>
- FAO Crop Calendar: <https://cropcalendar.app/>
- geoBoundaries (governorate boundaries, ODbL): <https://www.geoboundaries.org/>
- OpenStreetMap (basemap, ODbL): <https://www.openstreetmap.org/copyright>
