/* Field Shift Egypt — Crop Rotation: priorities, transparent scoring, comparison. */
(function () {
  "use strict";

  const FS = (window.FieldShift = window.FieldShift || {});
  const t = (key, vars) => window.FieldShiftI18n.t(key, vars);
  const esc = (value) => FS.esc(value);
  const $ = (id) => document.getElementById(id);

  const PRIORITY_ICONS = {
    water:
      '<svg viewBox="0 0 24 24"><path d="M12 3.5c3.2 4 5.5 6.6 5.5 9.6A5.5 5.5 0 0 1 12 18.5a5.5 5.5 0 0 1-5.5-5.4c0-3 2.3-5.6 5.5-9.6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.5 13.6c0 1.4 1.1 2.5 2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    salinity:
      '<svg viewBox="0 0 24 24"><path d="M12 3v18M5 8h14M5 16h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8.5" cy="12" r="1.2" fill="currentColor"/><circle cx="15.5" cy="12" r="1.2" fill="currentColor"/></svg>',
    soil:
      '<svg viewBox="0 0 24 24"><path d="M3 17h18M6 17c1.5-3 3.5-4.5 6-4.5s4.5 1.5 6 4.5M9 8c1-1.4 2-2.1 3-2.1s2 .7 3 2.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    climate:
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    diversity:
      '<svg viewBox="0 0 24 24"><path d="M12 21v-8M12 13c-4 0-6.4-2.2-6.4-5.6C9.6 7.4 12 9.6 12 13ZM12 15.5c4 0 6.4-2.2 6.4-5.6-4 0-6.4 2.2-6.4 5.6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  };

  const CHECK_KEYS = {
    organic_matter: "px.plan.actions.om",
    ec_ds_m: "px.plan.actions.ec",
    ec: "px.plan.actions.ec",
    irrigation: "px.plan.actions.irrigation",
    irrigation_method: "px.plan.actions.irrigation",
    water_availability: "px.plan.actions.water",
    current_crops: "px.plan.actions.currentCrop",
    current_crop: "px.plan.actions.currentCrop",
    texture: "px.plan.actions.texture",
  };

  const s = { loading: false };

  function scenarioTitle(id, fallback) {
    const key = `px.scenario.${id}.title`;
    const text = t(key);
    return text === key ? fallback : text;
  }

  function factorLabel(id, fallback) {
    const key = `factor.${id}`;
    const text = t(key);
    return text === key ? fallback : text;
  }

  function scenarioName(id, fallback) {
    const key = `scenario.${id}.summary`;
    const text = t(key);
    return text === key ? fallback : text;
  }

  function confidenceLabel(value) {
    if (!value) return "";
    const key = `confidence.${value}`;
    const text = t(key);
    return text === key ? value : text;
  }

  function currentData() {
    const farm = FS.activeFarm();
    return farm ? FS.state.rotation[farm.id] || null : null;
  }

  // ------------------------------------------------------------------
  // Priorities
  // ------------------------------------------------------------------
  function renderPriorities() {
    const box = $("priority-options");
    if (!box) return;
    box.innerHTML = FS.PRIORITIES.map((id) => {
      const selected = FS.state.priorities.has(id);
      return `<button class="priority-card${selected ? " is-selected" : ""}" type="button" data-priority="${esc(
        id
      )}" aria-pressed="${selected}">
        <span class="priority-check" aria-hidden="true">✓</span>
        <span class="priority-icon" aria-hidden="true">${PRIORITY_ICONS[id] || ""}</span>
        <span class="priority-copy">
          <strong>${esc(t(`priority.${id}.title`))}</strong>
          <small>${esc(t(`priority.${id}.desc`))}</small>
        </span>
      </button>`;
    }).join("");
    const note = $("priority-note");
    if (note) {
      note.textContent = FS.state.priorities.size
        ? t("px.rotation.weightsSummary", {
            weights: FS.PRIORITIES.filter((id) => FS.state.priorities.has(id))
              .map((id) => FS.priorityLabel(id))
              .join(" · "),
          })
        : t("px.rotation.priorities.none");
    }
    const run = $("rotation-run");
    if (run) run.disabled = !FS.activeFarm();
  }

  // ------------------------------------------------------------------
  // Scoring
  // ------------------------------------------------------------------
  async function run(options = {}) {
    const farm = FS.activeFarm();
    if (!farm) {
      render();
      return null;
    }
    const silent = Boolean(options.silent);
    const climate = options.climateContext || FS.climate.context(farm);
    const days = Number(options.days || climate?.period_days || 90);
    if (!silent) {
      s.loading = true;
      const loading = $("rotation-loading");
      if (loading) loading.hidden = false;
      const root = $("rotation-root");
      if (root) root.hidden = true;
      const error = $("rotation-error");
      if (error) error.hidden = true;
      $("rotation-run")?.setAttribute("disabled", "true");
    }
    try {
      const body = {
        lat: farm.latitude,
        lon: farm.longitude,
        days: Math.max(30, Math.min(365, Math.round(days))),
        soil: FS.soilFromFarm(farm),
        weights: FS.computeWeights(),
      };
      if (climate) body.climate = climate;
      const data = await FS.api("/api/rotations/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      FS.state.rotation[farm.id] = {
        data,
        weights: body.weights,
        fetchedAt: Date.now(),
      };
      FS.emit("rotationchange", { farmId: farm.id });
      if (!silent && FS.activeFarm()?.id === farm.id) renderResults();
      return data;
    } catch (error) {
      if (!silent) {
        const box = $("rotation-error");
        if (box) box.hidden = false;
      }
      return null;
    } finally {
      s.loading = false;
      const loading = $("rotation-loading");
      if (loading) loading.hidden = true;
      $("rotation-run")?.removeAttribute("disabled");
    }
  }

  // ------------------------------------------------------------------
  // Results
  // ------------------------------------------------------------------
  function render() {
    renderPriorities();
    const farm = FS.activeFarm();
    const empty = $("rotation-empty");
    const root = $("rotation-root");
    if (!farm) {
      if (empty) empty.hidden = false;
      if (root) {
        root.hidden = true;
        root.innerHTML = "";
      }
      return;
    }
    if (empty) empty.hidden = true;
    const cached = currentData();
    if (cached) {
      renderResults();
      return;
    }
    if (root) {
      root.hidden = false;
      root.innerHTML = `<div class="empty-state">
        <div class="empty-icon" aria-hidden="true">🔄</div>
        <h2>${esc(t("px.rotation.noResult"))}</h2>
        <button class="btn btn-primary" type="button" data-rotation-start>${esc(
          t("px.rotation.calculate")
        )}</button>
      </div>`;
      root.querySelector("[data-rotation-start]")?.addEventListener("click", () => run());
    }
  }

  function renderResults() {
    const root = $("rotation-root");
    const cached = currentData();
    if (!root || !cached) return;
    const data = cached.data;
    const scenarios = [...(data.scenarios || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
    const bestId = scenarios[0]?.scenario_id;
    root.hidden = false;
    root.innerHTML = `
      ${data.climate_warning ? `<div class="alert alert-info"><div><strong>${esc(
        t("px.common.caution")
      )}</strong><p>${esc(data.climate_warning)}</p></div></div>` : ""}
      ${briefingHtml(data, scenarios)}
      <div class="rotation-list">
        ${scenarios.map((scenario, index) => scenarioHtml(scenario, bestId, index + 1)).join("")}
      </div>
      ${compareHtml(scenarios)}
      <p class="rotation-disclaimer">${esc(t("px.rotation.disclaimer"))}</p>
      <p class="rotation-disclaimer">${esc(t("px.rotation.rankingNote"))}</p>`;
    bindDetails();
  }

  function briefingHtml(data, scenarios) {
    const briefing = data.briefing;
    if (!briefing) return "";
    const leader = scenarios.find((scenario) => scenario.scenario_id === briefing.leader_id);
    const runner = scenarios.find((scenario) => scenario.scenario_id === briefing.runner_up_id);
    const separation =
      briefing.separation === "clear"
        ? t("px.rotation.brief.separated")
        : briefing.separation === "overlapping"
          ? t("px.rotation.brief.overlap")
          : t("px.rotation.brief.partly");
    return `<section class="briefing-card">
      <h2>${esc(t("px.rotation.brief.title"))}</h2>
      <p class="briefing-lead">${esc(
        t("px.rotation.brief.leader", {
          name: leader ? scenarioTitle(leader.scenario_id, leader.name) : briefing.leader_name,
        })
      )}${
        runner
          ? ` — ${esc(t("px.rotation.brief.gap", { gap: FS.num(briefing.gap_points, 1) }))}`
          : ""
      }</p>
      <div class="briefing-grid">
        <div class="briefing-item">
          <span>${esc(t("px.rotation.scoreLabel"))}</span>
          <strong>${leader ? esc(FS.num(leader.score, 1)) : "—"} / 100</strong>
        </div>
        <div class="briefing-item">
          <span>${esc(t("px.rotation.band"))}</span>
          <strong>${
            leader && leader.range
              ? FS.bidi(`${FS.num(leader.range.low, 0)} – ${FS.num(leader.range.high, 0)}`)
              : "—"
          }</strong>
        </div>
        <div class="briefing-item">
          <span>${esc(t("px.rotation.brief.strongest"))}</span>
          <strong>${esc(
            briefing.strongest_factor
              ? factorLabel(briefing.strongest_factor.id, briefing.strongest_factor.label)
              : "—"
          )}</strong>
        </div>
      </div>
      <p class="small">${esc(separation)}</p>
      ${briefingHtmlChecks(briefing)}
      <p class="briefing-note">${esc(t("px.rotation.bandNote"))}</p>
    </section>`;
  }

  function briefingHtmlChecks(briefing) {
    const checks = briefing.next_checks || [];
    if (!checks.length) return "";
    return `<div class="briefing-checks">
      <h3>${esc(t("px.rotation.brief.next"))}</h3>
      <ul>${checks
        .map((check) => {
          const key = CHECK_KEYS[check.id];
          const text = key ? t(key) : check.label;
          return `<li>${esc(text)}</li>`;
        })
        .join("")}</ul>
    </div>`;
  }

  function scenarioHtml(scenario, bestId, rank) {
    const factors = scenario.factors || [];
    const sorted = [...factors].sort((a, b) => (b.score || 0) - (a.score || 0));
    const pros = sorted.filter((factor) => (factor.score || 0) >= 60).slice(0, 2);
    const cons = sorted.filter((factor) => (factor.score || 0) < 45).slice(0, 2);
    const missing = (scenario.missing_factors || []).map((item) =>
      typeof item === "string" ? factorLabel(item, item) : factorLabel(item.id, item.label)
    );
    const sequence = (scenario.crops || [])
      .map(
        (crop) =>
          `<li>${esc(FS.cropEmoji[crop.id] || "🌱")} ${
            window.FieldShiftI18n.isArabic() && crop.name_ar ? esc(crop.name_ar) : esc(crop.name)
          }</li>`
      )
      .join("");
    const fit = factors
      .filter((factor) => factor.score !== null && factor.score !== undefined)
      .map(
        (factor) => `<span class="fit-chip ${FS.levelClass(FS.fitLevel(factor.score))}">${esc(
          t("px.rotation.factorLevel", {
            factor: factorLabel(factor.id, factor.label),
            level: FS.factorLevelLabel(factor.score),
          })
        )}</span>`
      )
      .join("");
    return `<article class="scenario-card${scenario.scenario_id === bestId ? " is-best" : ""}">
      <div class="scenario-head">
        <div class="scenario-title-wrap">
          <p class="mini-label">${esc(t("px.rotation.rank", { rank }))}${
            scenario.scenario_id === bestId ? ` · ${esc(t("px.rotation.best"))}` : ""
          }</p>
          <h2 class="scenario-title">${esc(scenarioTitle(scenario.scenario_id, scenario.name))}</h2>
          <p class="small muted">${esc(scenarioName(scenario.scenario_id, scenario.summary))}</p>
        </div>
        <div class="scenario-score">
          <strong>${FS.bidi(FS.num(scenario.score, 1))}</strong>
          <span>${esc(t("px.common.outOf100"))}</span>
        </div>
      </div>
      <div class="score-bar" role="img" aria-label="${esc(
        t("px.rotation.scoreLabel")
      )} ${esc(FS.num(scenario.score, 1))}"><i style="width:${Math.max(
        0,
        Math.min(100, scenario.score || 0)
      )}%"></i></div>
      <div class="band-row">
        <span>${esc(
          scenario.range
            ? t("px.rotation.scoreRange", {
                score: FS.num(scenario.score, 1),
                low: FS.num(scenario.range.low, 0),
                high: FS.num(scenario.range.high, 0),
              })
            : t("px.rotation.scoreLabel")
        )}</span>
        <span>${esc(t("px.rotation.band"))}: ${esc(t("px.common.lowConfidence"))}${
          scenario.confidence ? ` · ${esc(confidenceLabel(scenario.confidence))}` : ""
        }</span>
      </div>
      <ul class="sequence-wrap">${sequence}</ul>
      <p class="scenario-why">${esc(
        t(`px.scenario.${scenario.scenario_id}.rationale`) ===
          `px.scenario.${scenario.scenario_id}.rationale`
          ? scenario.rationale
          : t(`px.scenario.${scenario.scenario_id}.rationale`)
      )}</p>
      <div class="fit-chips">${fit}</div>
      <div class="pros-cons">
        <div>
          <h5>${esc(t("px.rotation.advantages"))}</h5>
          ${
            pros.length
              ? `<ul>${pros
                  .map(
                    (factor) =>
                      `<li>${esc(t(`results.factor.${factor.id}.good`))}</li>`
                  )
                  .join("")}</ul>`
              : `<p class="small muted">${esc(t("px.common.noData"))}</p>`
          }
        </div>
        <div>
          <h5>${esc(t("px.rotation.limitations"))}</h5>
          ${
            cons.length
              ? `<ul>${cons
                  .map(
                    (factor) =>
                      `<li>${esc(
                        t(
                          `results.factor.${factor.id}.${
                            (factor.score || 0) < 30 ? "weak" : "medium"
                          }`
                        )
                      )}</li>`
                  )
                  .join("")}</ul>`
              : `<p class="small muted">${esc(t("px.rotation.noMissing"))}</p>`
          }
          ${
            (scenario.risk_flags || []).length
              ? `<ul>${scenario.risk_flags
                  .map((flag) => {
                    const detailKey = `px.riskFlag.${flag.id}.detail`;
                    const detail = t(detailKey);
                    return `<li>${esc(t(`px.riskFlag.${flag.id}`))}: ${esc(
                      detail === detailKey ? flag.detail || "" : detail
                    )}</li>`;
                  })
                  .join("")}</ul>`
              : ""
          }
        </div>
      </div>
      ${
        missing.length
          ? `<p class="missing-note">${esc(t("px.rotation.missing"))}: ${esc(missing.join(" · "))}</p>`
          : `<p class="small muted">${esc(t("px.rotation.noMissing"))}</p>`
      }
      ${
        t(`px.scenario.${scenario.scenario_id}.caution`) !==
        `px.scenario.${scenario.scenario_id}.caution`
          ? `<p class="small muted">${esc(t("px.common.caution"))}: ${esc(
              t(`px.scenario.${scenario.scenario_id}.caution`)
            )}</p>`
          : ""
      }
      <details>
        <summary>${esc(t("px.rotation.factorDetails"))}</summary>
        ${factorTable(factors)}
        <p class="small muted">${esc(scenario.disclaimer || "")}</p>
      </details>
    </article>`;
  }

  function factorTable(factors) {
    return `<table class="factor-table">
      <thead><tr>
        <th>${esc(t("px.rotation.compare.factor"))}</th>
        <th>${esc(t("px.rotation.factor.weight"))}</th>
        <th>${esc(t("px.rotation.factor.score"))}</th>
        <th>${esc(t("px.rotation.factor.contribution"))}</th>
      </tr></thead>
      <tbody>
        ${(factors || [])
          .map(
            (factor) => `<tr>
              <td>
                <strong>${esc(factorLabel(factor.id, factor.label))}</strong>
                <p class="factor-method">${esc(t(`results.factor.${factor.id}.${factorTone(factor.score)}`))}</p>
                <p class="factor-method">${esc(factor.method || "")}</p>
                <p class="factor-method">${esc(t("px.rotation.factor.source"))}: ${esc(factor.source || "")}</p>
              </td>
              <td>${esc(FS.num(factor.weight_pct, 1))}%</td>
              <td class="factor-score">${
                factor.score === null || factor.score === undefined
                  ? "—"
                  : esc(FS.num(factor.score, 1))
              }</td>
              <td>${esc(FS.num(factor.contribution_points, 1))}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
  }

  function factorTone(score) {
    if (score === null || score === undefined) return "medium";
    if (score >= 70) return "good";
    if (score >= 45) return "medium";
    return "weak";
  }

  function compareHtml(scenarios) {
    if (!scenarios.length) return "";
    const firstFactors = scenarios[0].factors || [];
    return `<h2 class="section-title">${esc(t("px.rotation.compare.title"))}</h2>
      <div class="compare-wrap">
        <table class="compare-table">
          <thead>
            <tr>
              <th>${esc(t("px.rotation.compare.factor"))}</th>
              ${scenarios
                .map(
                  (scenario) =>
                    `<th>${esc(scenarioTitle(scenario.scenario_id, scenario.name))}<br><span>${FS.bidi(
                      `${FS.num(scenario.score, 1)} / 100`
                    )}</span></th>`
                )
                .join("")}
            </tr>
          </thead>
          <tbody>
            ${firstFactors
              .map((factor) => {
                const label = factorLabel(factor.id, factor.label);
                return `<tr>
                  <td>${esc(label)}</td>
                  ${scenarios
                    .map((scenario) => {
                      const match = (scenario.factors || []).find((item) => item.id === factor.id);
                      return `<td>${
                        match && match.score !== null && match.score !== undefined
                          ? `${FS.bidi(FS.num(match.score, 1))} · ${esc(
                              FS.factorLevelLabel(match.score)
                            )}`
                          : "—"
                      }</td>`;
                    })
                    .join("")}
                </tr>`;
              })
              .join("")}
            <tr>
              <td>${esc(t("px.rotation.band"))}</td>
              ${scenarios
                .map(
                  (scenario) =>
                    `<td>${
                      scenario.range
                        ? FS.bidi(`${FS.num(scenario.range.low, 0)} – ${FS.num(scenario.range.high, 0)}`)
                        : "—"
                    }</td>`
                )
                .join("")}
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  function bindDetails() {
    // No extra wiring required: <details> is native and keeps technical detail
    // hidden until a farmer or specialist opens it.
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  function bindEvents() {
    $("priority-options")?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-priority]");
      if (!card) return;
      const id = card.getAttribute("data-priority");
      if (FS.state.priorities.has(id)) FS.state.priorities.delete(id);
      else FS.state.priorities.add(id);
      FS.persistPriorities();
      renderPriorities();
    });
    $("rotation-run")?.addEventListener("click", () => run());
    $("rotation-retry")?.addEventListener("click", () => run());
    FS.on("viewchange", ({ view }) => {
      if (view === "rotation") render();
    });
    FS.on("farmchange", () => {
      if (FS.state.view === "rotation") render();
    });
  }

  function init() {
    bindEvents();
    renderPriorities();
    render();
  }

  function rerender() {
    renderPriorities();
    const cached = currentData();
    if (cached) renderResults();
    else render();
  }

  FS.rotation = {
    init,
    render,
    rerender,
    run,
    currentData,
    renderPriorities,
  };
})();
