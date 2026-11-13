# AI usage disclosure — Field Shift Egypt

## Tool used

- **Models:** DeepSeek V4.1 Flash Free; GPT-6
- **Harnesses:** OpenCode coding agent; Codex desktop assistant
- **Role:** AI coding and writing assistants during the 2026 NASA Space Apps Challenge prototype.

## What the AI assisted with

- Python/Flask application code and API routes.
- JavaScript interface code and CSS.
- Test suites, fixtures and the Playwright acceptance script.
- Data-source documentation, README text, Methods-page copy and this disclosure.
- Reviewing edge cases such as missing values, invalid coordinates, cache behaviour and mismatched farm profiles.
- Codex simplified the user-facing interface, switched its default language to English, removed the technical workspace and Methods page, and made the journey load its governorate list directly.

## What was verified rather than assumed

- NASA POWER responses were retrieved live for Sohag, Alexandria and Aswan and checked against the requested variables, dates and units.
- NASA GIBS images and NASA CMR granule metadata were fetched live for SMAP, GPM IMERG and MODIS.
- Automated tests exercise fill values, missing dates, invalid coordinates, upstream failures, cache hits/refresh and rotation calculations.
- The recorded browser acceptance workflow checked the former technical dashboard, charts, satellite images, map interactions, saved profile, rotation explanations and the Aswan workflow. The simplified public interface was changed after that browser run, so rerun browser acceptance before submission.

## Limits and responsibilities

- AI-generated text is **not** presented as a verified scientific finding.
- Crop, salinity and rotation assumptions are simplified reference rules compiled from FAO sources. They have not been reviewed by an agricultural specialist and must not replace local soil tests, variety trials or extension advice.
- No quantitative SMAP/GPM/MODIS values were generated or inferred. Where NASA Earthdata Login is required, the application states the limitation instead of inventing data.
- NASA branding is used only for factual source attribution. The project does not imply NASA endorsement.
- Any future changes to the application should repeat the live and browser checks before claiming functionality.

## Human review checklist before submission

- [ ] Re-read the official 2026 challenge statement and submission rules.
- [ ] Check that all cited source URLs still resolve.
- [ ] Re-run `.venv/bin/pytest -q -m "not live"`.
- [ ] Re-run `.venv/bin/pytest -m live -s`.
- [ ] Replace the old browser script with a check for the simplified journey, then run it.
- [ ] Review agricultural assumptions with a qualified specialist if possible.
- [ ] Confirm the final repository/public link and demo format.
