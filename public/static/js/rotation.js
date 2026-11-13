/* Phase 5/6: transparent rotation comparison and weight controls. */
(function () {
  "use strict";

  const state = {
    built: false,
    meta: null,
    data: null,
    profile: null,
    location: null,
    climate: null,
    climateKey: null,
    loading: false,
    key: null,
  };

  const $ = (id) => document.getElementById(id);
  const app = () => window.FieldShiftApp;
  const esc = (value) => app().escapeHtml(value);

  function buildShell() {
    $("rotation-app").innerHTML = `
      <div class="rotation-layout">
        <aside>
          <div class="surface-card">
            <p class="mini-label">Farmer priorities</p>
            <h2 style="margin:4px 0 4px">Set the weights</h2>
            <p class="small muted">Weights are relative and normalised to 100. Set a factor to zero to remove it from the comparison.</p>
            <div id="weight-controls" style="margin-top:14px"></div>
            <p class="weight-note" id="weight-total">Loading factor definitions…</p>
            <div class="form-actions" style="margin-top:10px">
              <button class="btn btn-primary btn-small" id="score-rotations" type="button">Recompute</button>
              <button class="btn btn-ghost btn-small" id="reset-weights" type="button">Reset weights</button>
            </div>
          </div>
          <div class="surface-card" id="rotation-context" style="margin-top:12px">
            <p class="mini-label">Inputs in use</p>
            <p class="small muted">Loading farm profile and location context…</p>
          </div>
          <div class="surface-card" style="margin-top:12px">
            <p class="mini-label">How the total is built</p>
            <div class="score-formula">score = Σ(normalised weight × factor score) / Σ weights of available factors</div>
            <p class="small muted" style="margin-top:8px">The range beside each score is an 80% sensitivity band from factor uncertainty, not a probability of success.</p>
          </div>
        </aside>
        <div>
          <div id="rotation-alert"></div>
          <div id="rotation-summary"></div>
          <div id="rotation-results">
            <div class="surface-card"><p class="muted small">Loading transparent rotation comparison…</p></div>
          </div>
        </div>
      </div>`;
  }

  async function loadMeta() {
    if (state.meta) return state.meta;
    const response = await fetch("/api/rotations/scenarios");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not load rotation definitions");
    state.meta = body;
    renderWeights();
    return body;
  }

  function defaultWeights() {
    return { ...(state.meta?.default_weights || {}) };
  }

  function currentWeights() {
    const weights = {};
    (state.meta?.factors || []).forEach((factor) => {
      weights[factor.id] = Number($(`weight-${factor.id}`)?.value || 0);
    });
    return weights;
  }

  function renderWeights() {
    const box = $("weight-controls");
    box.innerHTML = state.meta.factors.map((factor) => `
      <label class="weight-row" for="weight-${factor.id}">
        <span>${esc(factor.label)}</span>
        <output id="weight-out-${factor.id}">${factor.default_weight}</output>
        <input id="weight-${factor.id}" type="range" min="0" max="50" step="5" value="${factor.default_weight}" aria-label="${esc(factor.label)} weight">
      </label>`).join("");
    state.meta.factors.forEach((factor) => {
      $(`weight-${factor.id}`).addEventListener("input", () => {
        $(`weight-out-${factor.id}`).textContent = $(`weight-${factor.id}`).value;
        updateWeightTotal();
      });
      $(`weight-${factor.id}`).addEventListener("change", debounce(() => score(), 450));
    });
    updateWeightTotal();
  }

  function updateWeightTotal() {
    const values = Object.values(currentWeights());
    const total = values.reduce((sum, value) => sum + value, 0);
    $("weight-total").textContent = total > 0
      ? `Raw total ${total}; weights are normalised before scoring.`
      : "All weights are zero — increase at least one factor.";
  }

  function resetWeights() {
    const weights = defaultWeights();
    Object.entries(weights).forEach(([key, value]) => {
      const input = $(`weight-${key}`);
      if (input) {
        input.value = value;
        $(`weight-out-${key}`).textContent = value;
      }
    });
    updateWeightTotal();
    score();
  }

  async function loadContext() {
    const { lat, lon } = app().currentCoords();
    const [locationRes, profileRes] = await Promise.allSettled([
      fetch(`/api/location?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`).then((r) => r.json()),
      fetch("/api/farm/profile/latest").then((r) => r.json()),
    ]);
    if (locationRes.status === "fulfilled") state.location = locationRes.value.location;
    if (profileRes.status === "fulfilled") state.profile = profileRes.value.profile || null;
  }

  function soilFromProfile(profile) {
    if (!profile) return {};
    return {
      ec_ds_m: profile.ec_ds_m,
      organic_matter_pct: profile.organic_matter_pct,
      ph: profile.ph,
      soil_texture: profile.soil_texture,
      drainage: profile.drainage,
      water_source: profile.water_source,
      irrigation_method: profile.irrigation_method,
    };
  }

  function profileMismatch() {
    const { lat, lon } = app().currentCoords();
    const profile = state.profile;
    if (!profile || profile.latitude == null || profile.longitude == null) return false;
    return Math.abs(profile.latitude - lat) > 0.02 || Math.abs(profile.longitude - lon) > 0.02;
  }

  async function score() {
    if (state.loading || !state.meta) return;
    const { lat, lon } = app().currentCoords();
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      $("rotation-alert").innerHTML = errorAlert("Choose a valid latitude and longitude in the Climate tab first.");
      return;
    }
    const key = `${lat},${lon}`;
    const mismatch = profileMismatch();
    const body = {
      lat,
      lon,
      days: 90,
      soil: mismatch ? {} : soilFromProfile(state.profile),
      weights: currentWeights(),
    };
    if (state.climate && state.climateKey === key) body.climate = state.climate;

    state.loading = true;
    $("score-rotations").disabled = true;
    $("rotation-results").innerHTML = `<div class="surface-card"><p class="mini-label">Computing</p><p class="small muted">Fetching NASA POWER climate context, applying farm soil inputs and scoring the scenarios…</p></div>`;
    try {
      const response = await fetch("/api/rotations/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
      state.data = payload;
      state.key = key;
      if (payload.climate_context) {
        state.climate = payload.climate_context;
        state.climateKey = key;
      }
      render();
    } catch (error) {
      $("rotation-results").innerHTML = "";
      $("rotation-alert").innerHTML = errorAlert(`Rotation scoring failed: ${error.message}`);
      app().toast(`Rotation scoring failed: ${error.message}`);
    } finally {
      state.loading = false;
      $("score-rotations").disabled = false;
    }
  }

  function errorAlert(message) {
    return `<div class="alert alert-error"><div class="alert-icon" aria-hidden="true">!</div><div><strong>Rotation comparison unavailable</strong><p>${esc(message)}</p></div></div>`;
  }

  function render() {
    const data = state.data;
    renderContext(data);
    const best = data.scenarios[0];
    const brief = data.briefing || {};
    const strongest = brief.strongest_factor;
    const weakest = brief.weakest_factor;
    const gap = brief.gap_points === null || brief.gap_points === undefined
      ? "—"
      : `${brief.gap_points > 0 ? "+" : ""}${brief.gap_points} pts`;
    $("rotation-summary").innerHTML = `
      <div class="surface-card" style="margin-bottom:12px">
        <p class="mini-label">Ranking under your weights</p>
        <h2 style="margin:4px 0">${esc(best.name)} leads at ${best.score}/100</h2>
        <p class="small muted">Sensitivity range ${best.range.low}–${best.range.high} · confidence ${esc(best.confidence)}. ${esc(data.ranking_note)}</p>
        <div class="briefing-grid">
          <div class="briefing-item">
            <span class="mini-label">Leader gap</span>
            <strong>${gap}</strong>
            <p>${esc(brief.separation || "—")} bands</p>
          </div>
          <div class="briefing-item">
            <span class="mini-label">Lifts the leader</span>
            <strong>${strongest ? esc(strongest.label) : "—"}</strong>
            <p>${strongest ? `${strongest.contribution_points} pts at ${strongest.score}/100` : "—"}</p>
          </div>
          <div class="briefing-item">
            <span class="mini-label">Limits the leader</span>
            <strong>${weakest ? esc(weakest.label) : "—"}</strong>
            <p>${weakest ? `${weakest.contribution_points} pts at ${weakest.score}/100` : "—"}</p>
          </div>
        </div>
        <p class="small" style="margin-top:10px">${esc(brief.interpretation || "")}</p>
        <p class="source-disclaimer">${esc(brief.note || "")}</p>
        ${brief.next_checks && brief.next_checks.length ? `
          <div class="briefing-checks">
            <span class="mini-label">Next checks</span>
            <ul class="hint-list">${brief.next_checks.map((check) => `<li><strong>${esc(check.label)}</strong> — ${esc(check.reason)}</li>`).join("")}</ul>
          </div>` : ""}
        ${data.climate_warning ? `<div class="warning-list">${esc(data.climate_warning)}</div>` : ""}
        ${data.climate_source !== "NASA POWER daily point data" ? `<p class="source-disclaimer">Climate context: ${esc(data.climate_source)}. A real NASA POWER context is preferred for interpretation.</p>` : ""}
      </div>`;
    $("rotation-alert").innerHTML = "";
    $("rotation-results").innerHTML = data.scenarios.map((scenario, index) => scenarioCard(scenario, index)).join("");
  }

  function renderContext(data) {
    const loc = state.location;
    const gov = loc?.governorate;
    const climate = data.climate_context;
    const profile = state.profile;
    const mismatch = profileMismatch();
    const soilFields = data.context.soil_fields_provided || [];
    const cropTag = (label, text, kind) => `<span class="tag ${kind}">${esc(label)}: ${esc(text)}</span>`;
    $("rotation-context").innerHTML = `
      <p class="mini-label">Inputs in use</p>
      <h3 style="margin:4px 0">${gov
        ? esc(gov.name + " Governorate")
        : (loc && loc.in_egypt ? "Egypt · boundary unresolved" : (loc ? "Outside Egypt" : "Location lookup unavailable"))}</h3>
      <p class="small muted">Climate point ${loc ? loc.latitude.toFixed(4) : "—"}, ${loc ? loc.longitude.toFixed(4) : "—"}</p>
      <div class="tag-row" style="margin-top:8px">
        ${cropTag("NASA", climate ? `${climate.heat_days_35c} heat days ≥35 °C` : "climate unavailable", "tag-nasa")}
        ${cropTag("NASA", climate && climate.rain_total_mm !== null ? `${climate.rain_total_mm} mm rain` : "rain n/a", "tag-nasa")}
        ${profile ? cropTag("User", `farm profile #${profile.id}${mismatch ? " (not applied)" : ""}`, mismatch ? "tag-limited" : "tag-user") : cropTag("User", "no saved farm profile", "tag-limited")}
        ${profile && !mismatch && soilFields.length ? cropTag("User", `${soilFields.length} soil field(s)`, "tag-user") : ""}
        ${climate ? cropTag("Calc", `${climate.period_days}-day context`, "tag-calc") : ""}
      </div>
      ${climate ? `<p class="small muted" style="margin-top:6px">POWER period ${esc(climate.requested_start || "—")} → ${esc(climate.requested_end || "—")} · retrieved ${esc((climate.retrieved_at || "—").slice(0, 10))} · latest observation ${esc(climate.latest_observation || "—")}.</p>` : ""}
      <p class="small" style="margin-top:10px">${profile && !mismatch
        ? `Soil EC ${profile.ec_ds_m ?? "not provided"} dS/m · organic matter ${profile.organic_matter_pct ?? "not provided"}% · ${profile.water_source || "water source not provided"}.`
        : (profile
          ? "Saved soil values were not applied because the farm profile belongs to a different point. Scores use reference crop traits only."
          : "No farm profile saved: salinity and organic-matter inputs are missing. Scores use reference crop traits only and confidence is lower.")}</p>
      ${mismatch ? `<div class="warning-list"><strong>Coordinate mismatch.</strong> The saved farm profile is at ${profile.latitude.toFixed(4)}, ${profile.longitude.toFixed(4)}, while climate scoring uses ${loc?.latitude.toFixed(4)}, ${loc?.longitude.toFixed(4)}. The profile soil was not applied.
        <button class="btn btn-small btn-ghost" id="use-farm-coords" type="button" style="margin-top:8px">Use farm coordinates</button></div>` : ""}
      ${!profile ? `<button class="btn btn-small btn-ghost" data-goto-tab="farm" type="button" style="margin-top:8px">Add soil profile</button>` : ""}
      <p class="source-disclaimer">User inputs and NASA observations are kept separate. Reference crop traits never become farm measurements.</p>`;
    if (mismatch) {
      $("use-farm-coords").addEventListener("click", () => {
        $("latitude").value = profile.latitude;
        $("longitude").value = profile.longitude;
        app().updateLocationContext();
        state.climate = null;
        state.climateKey = null;
        loadContext().then(score);
      });
    }
    document.querySelectorAll('#rotation-context [data-goto-tab]').forEach((button) => {
      button.addEventListener("click", () => app().switchTab(button.dataset.gotoTab));
    });
  }

  function scenarioCard(scenario, index) {
    const factorRows = scenario.factors.map((factor) => {
      const score = factor.score === null ? "not calculated" : `${factor.score}`;
      const width = factor.score === null ? 0 : factor.score;
      return `
        <div class="factor" title="${esc(factor.method)}">
          <span>${esc(factor.label)} <span class="muted">· ${factor.contribution_points ?? "—"} pts</span></span>
          <strong>${score}</strong>
          <div class="factor-bar"><i style="width:${width}%"></i></div>
        </div>`;
    }).join("");
    const factorDetails = scenario.factors.map((factor) => `
      <details>
        <summary>${esc(factor.label)} — ${factor.score === null ? "not calculated" : `${factor.score}/100`} (${factor.data_quality})</summary>
        <ul class="hint-list">${factor.reasons.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ul>
        <p class="small muted"><strong>Rule:</strong> ${esc(factor.method)}</p>
        <p class="small muted"><strong>Source:</strong> ${esc(factor.source)}</p>
        <p class="small muted"><strong>Sensitivity:</strong> ±${factor.uncertainty_points} points at this factor level; weight ${factor.weight_pct}%.</p>
      </details>`).join("");
    return `
      <article class="scenario-card">
        <div class="scenario-head">
          <div>
            <p class="mini-label">#${index + 1} · confidence ${esc(scenario.confidence)}</p>
            <h3 class="scenario-title">${esc(scenario.name)}</h3>
            <p class="small muted">${esc(scenario.summary)}</p>
          </div>
          <div class="score-badge">${scenario.score}<small>/100</small>
            <div class="small muted" style="text-align:right">${scenario.range.low}–${scenario.range.high}</div>
          </div>
        </div>
        <div class="score-bar"><i style="width:${scenario.score}%"></i></div>
        <div class="tag-row">${scenario.crops.map((crop) => `<span class="tag">${esc(crop.name)}${crop.n_fixation ? " · N-fixing" : ""}</span>`).join('<span class="muted" aria-hidden="true">→</span>')}</div>
        ${scenario.risk_flags && scenario.risk_flags.length ? `<div class="risk-flag-row">${scenario.risk_flags.map((flag) => `<span class="risk-flag" title="${esc(flag.detail)}">Watch · ${esc(flag.label)} · ${flag.score}/100</span>`).join("")}</div>` : ""}
        <div class="factor-list">${factorRows}</div>
        <details style="margin-top:10px">
          <summary class="small" style="cursor:pointer;color:var(--green-2);font-weight:700">Factor explanations, method and sources</summary>
          ${factorDetails}
          <p class="small" style="margin-top:8px"><strong>Why this sequence:</strong> ${esc(scenario.rationale)}</p>
          <p class="warning-list"><strong>Caution:</strong> ${esc(scenario.caution)}</p>
        </details>
        <p class="source-disclaimer">${esc(scenario.disclaimer)}</p>
      </article>`;
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  async function refresh() {
    try {
      await loadMeta();
      await loadContext();
      await score();
    } catch (error) {
      $("rotation-alert").innerHTML = errorAlert(error.message);
    }
  }

  function init() {
    if (!state.built) {
      buildShell();
      $("score-rotations").addEventListener("click", score);
      $("reset-weights").addEventListener("click", resetWeights);
      state.built = true;
      refresh();
    } else {
      const { lat, lon } = app().currentCoords();
      const key = `${lat},${lon}`;
      if (key !== state.key) {
        state.climate = null;
        state.climateKey = null;
        loadContext().then(score);
      }
    }
  }

  window.FieldShiftRotation = { init };
})();
