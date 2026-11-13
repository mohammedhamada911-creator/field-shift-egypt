/* Field Shift Egypt — My Farm Plan: one summary, next actions, save/print. */
(function () {
  "use strict";

  const FS = (window.FieldShift = window.FieldShift || {});
  const t = (key, vars) => window.FieldShiftI18n.t(key, vars);
  const esc = (value) => FS.esc(value);
  const $ = (id) => document.getElementById(id);

  const s = {
    current: null,
    building: false,
    serverPlans: [],
    serverLoaded: false,
    status: null,
  };

  const LEVEL_RANK = { high: 0, moderate: 1, low: 2, insufficient: 3 };
  const MAX_ACTIONS = 7;

  function setStatus(key, vars = {}) {
    s.status = key ? { key, vars } : null;
    const status = $("plan-status");
    if (!status) return;
    if (!key) {
      status.textContent = "";
      return;
    }
    const merged = key === "px.plan.builtAt" ? { ...vars, date: FS.dateTime(vars.date) } : vars;
    status.textContent = t(key, merged);
  }

  function daysOld(endDate) {
    if (!endDate) return null;
    const parsed = new Date(String(endDate).slice(0, 10) + "T00:00:00");
    if (Number.isNaN(parsed.getTime())) return null;
    return Math.floor((Date.now() - parsed.getTime()) / 86400000);
  }

  function isOld(data) {
    const days = daysOld(data?.climate?.period?.last_observation);
    return days !== null && days > 30;
  }

  // ------------------------------------------------------------------
  // Building the plan
  // ------------------------------------------------------------------
  async function build(options = {}) {
    const farm = FS.activeFarm();
    if (!farm) {
      render();
      return null;
    }
    if (s.building) return s.current;
    s.building = true;
    const loading = $("plan-loading");
    const root = $("plan-root");
    if (loading) loading.hidden = false;
    if (root) root.hidden = true;
    setStatus("common.loading");
    $("plan-build")?.setAttribute("disabled", "true");
    try {
      const climateData = await FS.climate.getData({ force: Boolean(options.force) });
      const climateContext = climateData ? FS.climateContextFromData(climateData) : null;
      await FS.crops.ensureCrops();
      const compatibility = await FS.crops.getCompatibility(false);
      let rotation = FS.rotation.currentData();
      if (!rotation || options.force) {
        const data = await FS.rotation.run({
          silent: true,
          climateContext,
          days: climateContext?.period_days || 90,
        });
        if (data) rotation = FS.state.rotation[farm.id];
      }
      const plan = buildSnapshot(farm, climateData, compatibility, rotation?.data || null);
      s.current = plan;
      renderPlan(plan);
      setStatus("px.plan.builtAt", { date: plan.generatedAt });
      return plan;
    } catch (_error) {
      FS.ui.toast(t("px.toast.error"), "error");
      if (root) {
        root.hidden = false;
        root.innerHTML = `<div class="alert alert-error"><div><strong>${esc(
          t("px.toast.error")
        )}</strong><p>${esc(t("px.common.networkError"))}</p></div></div>`;
      }
      return null;
    } finally {
      s.building = false;
      if (loading) loading.hidden = true;
      $("plan-build")?.removeAttribute("disabled");
    }
  }

  function buildSnapshot(farm, climateData, compatibility, rotationData) {
    const completeness = FS.completeness(farm);
    const summaries = climateData?.summaries || {};
    const indicators = climateData?.indicators || {};
    const topCrops = [...(compatibility || [])]
      .sort((a, b) => {
        const rank = (LEVEL_RANK[a.level] ?? 3) - (LEVEL_RANK[b.level] ?? 3);
        if (rank !== 0) return rank;
        return (b.score ?? -1) - (a.score ?? -1);
      })
      .slice(0, 5)
      .map((item) => ({
        crop_id: item.crop_id,
        crop_name: item.crop_name,
        name_ar: item.name_ar,
        level: item.level,
        score: item.score,
        missing_dimensions: item.missing_dimensions,
        dimensions: (item.dimensions || []).map((dimension) => ({
          id: dimension.id,
          known: dimension.known,
          level: dimension.level,
          score: dimension.score,
          reason: dimension.reason,
          params: dimension.params,
        })),
      }));

    const rotation = rotationData
      ? {
          scenarios: [...(rotationData.scenarios || [])]
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .map((scenario) => ({
              scenario_id: scenario.scenario_id,
              name: scenario.name,
              score: scenario.score,
              range: scenario.range,
              confidence: scenario.confidence,
              missing_factors: scenario.missing_factors,
              factors: (scenario.factors || []).map((factor) => ({
                id: factor.id,
                label: factor.label,
                score: factor.score,
                weight_pct: factor.weight_pct,
                contribution_points: factor.contribution_points,
              })),
            })),
          briefing: rotationData.briefing,
          climate_warning: rotationData.climate_warning,
          weights: rotationData.context?.weights_normalised || null,
        }
      : null;

    const plan = {
      version: 1,
      generatedAt: new Date().toISOString(),
      farm: {
        id: farm.id,
        name: farm.name,
        label: FS.farmLabel(farm),
        governorate: farm.governorate,
        village: farm.village,
        latitude: farm.latitude,
        longitude: farm.longitude,
        area_feddan: farm.area_feddan,
        soil_texture: farm.soil_texture,
        ph: farm.ph,
        organic_matter_pct: farm.organic_matter_pct,
        ec_ds_m: farm.ec_ds_m,
        drainage: farm.drainage,
        irrigation_method: farm.irrigation_method,
        water_source: farm.water_source,
        water_availability: farm.water_availability,
        current_crop: farm.current_crop,
        previous_crops: farm.previous_crops,
      },
      completeness,
      climate: climateData
        ? {
            period: climateData.period,
            quality: climateData.quality,
            summary: {
              tmax: summaries.T2M_MAX?.mean ?? null,
              tmin: summaries.T2M_MIN?.mean ?? null,
              rain_total: summaries.PRECTOTCORR?.total ?? null,
              rain_days: summaries.PRECTOTCORR?.wet_days ?? null,
              solar: summaries.ALLSKY_SFC_SW_DWN?.mean ?? null,
              coverage: climateData.quality?.completeness_pct ?? null,
            },
            signals: (indicators.signals || []).map((signal) => ({
              id: signal.id,
              severity: signal.severity,
              value: signal.value,
              unit: signal.unit,
            })),
            overall_severity: indicators.overall_severity,
            context: FS.climateContextFromData(climateData),
            served_from_cache: Boolean(climateData.served_from_cache),
          }
        : null,
      crops: topCrops,
      rotation,
      actions: buildActions(farm, completeness, climateData, compatibility, rotationData),
    };
    return plan;
  }

  function buildActions(farm, completeness, climateData, compatibility, rotationData) {
    const actions = [];
    const missing = new Set(completeness.missing);
    if (missing.has("area")) actions.push("area");
    if (missing.has("texture")) actions.push("texture");
    if (missing.has("ec")) actions.push("ec");
    if (missing.has("irrigation") || missing.has("water_source")) actions.push("irrigation");
    if (missing.has("water_availability")) actions.push("water");
    if (missing.has("current_crop")) actions.push("currentCrop");

    if (!climateData) {
      actions.push("climate");
    } else {
      const heat = (climateData.indicators?.signals || []).find(
        (signal) => signal.id === "heat_stress"
      );
      const dry = (climateData.indicators?.signals || []).find(
        (signal) => signal.id === "dry_spell"
      );
      if (heat && ["high", "watch"].includes(heat.severity)) actions.push("heat");
      if (dry && ["high", "watch"].includes(dry.severity)) actions.push("dry");
    }

    const salinityPressure = (compatibility || []).some((item) => {
      const dimension = (item.dimensions || []).find((part) => part.id === "salinity");
      return dimension?.known && dimension.level === "low";
    });
    if (salinityPressure) actions.push("salinity");

    if (climateData && isOld({ climate: { period: climateData.period } })) actions.push("refresh");
    if (rotationData?.climate_warning) actions.push("climateContext");
    actions.push("verify");

    return [...new Set(actions)].slice(0, MAX_ACTIONS);
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function render() {
    const farm = FS.activeFarm();
    const empty = $("plan-empty");
    const root = $("plan-root");
    if (!farm) {
      if (empty) empty.hidden = false;
      if (root) root.innerHTML = "";
      return;
    }
    if (empty) empty.hidden = true;
    if (!s.current) {
      if (root) {
        root.hidden = false;
        root.innerHTML = `<div class="empty-state">
          <div class="empty-icon" aria-hidden="true">📋</div>
          <h2>${esc(t("px.plan.generate"))}</h2>
          <p class="small muted">${esc(t("px.plan.lede"))}</p>
          <button class="btn btn-primary" type="button" data-plan-start>${esc(
            t("px.plan.generate")
          )}</button>
        </div>`;
        root.querySelector("[data-plan-start]")?.addEventListener("click", () => build());
      }
      return;
    }
    renderPlan(s.current);
  }

  function renderPlan(plan) {
    const root = $("plan-root");
    if (!root || !plan) return;
    root.hidden = false;
    root.innerHTML = `
      <div class="plan-report">
        ${planHeader(plan)}
        ${planOverview(plan)}
        ${planClimate(plan)}
        ${planCrops(plan)}
        ${planRotation(plan)}
        ${planActions(plan)}
        <p class="plan-footnote">${esc(t("px.plan.reportNote"))}</p>
      </div>`;
  }

  function planHeader(plan) {
    const period = plan.climate?.period;
    return `<section class="plan-header-card">
      <span class="provenance-tag tag-calc">${esc(t("px.plan.reportMeta", {
        date: FS.dateTime(plan.generatedAt),
      }))}</span>
      <h2>${esc(t("px.plan.reportTitle", { name: plan.farm.label || plan.farm.name }))}</h2>
      <p>${esc(t("px.plan.lede"))}</p>
      <div class="plan-header-meta">
        <span>${esc(t("px.plan.dataPeriod", {
          start: FS.date(period?.first_observation),
          end: FS.date(period?.last_observation),
        }))}</span>
        ${plan.farm.governorate ? `<span>${esc(FS.governorateLabel(plan.farm.governorate))}</span>` : ""}
        <span>${esc(t("px.farm.completeness.value", {
          done: plan.completeness.done,
          total: plan.completeness.total,
        }))}</span>
      </div>
      ${isOld(plan) ? `<p class="plan-refresh-warn">${esc(t("px.plan.needsRefresh"))}</p>` : ""}
    </section>`;
  }

  function planOverview(plan) {
    const farm = plan.farm;
    const missing = plan.completeness.missing.map((id) => t(`px.farm.missing.${id}`));
    return `<section class="plan-section">
      <h2>${esc(t("px.plan.overview"))}</h2>
      <div class="plan-overview-grid">
        ${fact(t("px.plan.location"), [FS.governorateLabel(farm.governorate), farm.village].filter(Boolean).join(" · ") || FS.coords(farm))}
        ${fact(t("px.plan.area"), farm.area_feddan ? `${FS.num(farm.area_feddan, 2)} ${t("px.common.feddan")}` : t("common.notProvided"))}
        ${fact(t("px.plan.soil"), farm.soil_texture ? t(`texture.${farm.soil_texture}`) : t("common.notProvided"))}
        ${fact(t("px.plan.irrigation"), farm.irrigation_method ? t(`irrigation.${farm.irrigation_method}`) : t("common.notProvided"))}
        ${fact(t("px.plan.current"), farm.current_crop || t("common.notProvided"))}
        ${fact(t("px.plan.previous"), farm.previous_crops || t("common.notProvided"))}
      </div>
      <h3>${esc(t("px.plan.missingInfo"))}</h3>
      ${
        missing.length
          ? `<div class="plan-chips">${missing
              .map((label) => `<span class="crop-tag">${esc(label)}</span>`)
              .join("")}</div>`
          : `<p class="small muted">${esc(t("px.farm.noMissing"))}</p>`
      }
    </section>`;
  }

  function fact(label, value) {
    return `<div class="plan-fact"><span>${esc(label)}</span><strong dir="auto">${esc(
      value || t("common.notProvided")
    )}</strong></div>`;
  }

  function planClimate(plan) {
    const climate = plan.climate;
    if (!climate) {
      return `<section class="plan-section">
        <h2>${esc(t("px.plan.climate"))}</h2>
        <p class="small muted">${esc(t("px.plan.noClimate"))}</p>
      </section>`;
    }
    const signals = (climate.signals || []).filter((signal) =>
      ["high", "watch"].includes(signal.severity)
    );
    return `<section class="plan-section">
      <h2>${esc(t("px.plan.climate"))}</h2>
      <p>${esc(t("px.plan.climatePeriod", {
        start: FS.date(climate.period?.first_observation),
        end: FS.date(climate.period?.last_observation),
      }))}</p>
      <div class="plan-overview-grid">
        ${fact(t("px.climate.kpi.tmax"), `${FS.num(climate.summary.tmax, 1)} °C`)}
        ${fact(t("px.climate.kpi.rain"), `${FS.num(climate.summary.rain_total, 1)} mm`)}
        ${fact(t("px.climate.kpi.coverage"), `${FS.num(climate.summary.coverage, 1)}%`)}
      </div>
      <h3>${esc(t("px.plan.climateChallenges"))}</h3>
      ${
        signals.length
          ? `<div class="plan-chips">${signals
              .map(
                (signal) =>
                  `<span class="signal-badge badge-${esc(
                    FS.severityClass(signal.severity)
                  )}">${esc(t(`risk.${signal.id}`))}: ${esc(
                    severityLabel(signal.severity)
                  )}</span>`
              )
              .join("")}</div>`
          : `<p class="small muted">${esc(t("px.plan.climateNone"))}</p>`
      }
      <p class="small muted">${esc(t("px.climate.periodNote"))}</p>
    </section>`;
  }

  function severityLabel(severity) {
    if (severity === "high") return t("common.high");
    if (severity === "watch") return t("common.watch");
    if (severity === "low") return t("common.low");
    return t("common.unknown");
  }

  function planCrops(plan) {
    if (!plan.crops?.length) {
      return `<section class="plan-section">
        <h2>${esc(t("px.plan.crops"))}</h2>
        <p class="small muted">${esc(t("px.plan.noCrops"))}</p>
      </section>`;
    }
    return `<section class="plan-section">
      <h2>${esc(t("px.plan.crops"))}</h2>
      <p class="small muted">${esc(t("px.plan.cropsNote"))}</p>
      ${plan.crops
        .map((crop) => {
          const reasons = (crop.dimensions || [])
            .filter((dimension) => dimension.known && dimension.level !== "high")
            .slice(0, 2)
            .map((dimension) => reasonText(dimension));
          const scoreHtml =
            crop.score === null || crop.score === undefined
              ? esc(t("px.common.insufficientCompat"))
              : FS.bidi(`${FS.num(crop.score, 0)} / 100`);
          return `<div class="plan-crop-row">
            <span class="plan-crop-emoji" aria-hidden="true">${esc(
              FS.cropEmoji[crop.crop_id] || "🌱"
            )}</span>
            <div>
              <strong>${esc(
                window.FieldShiftI18n.isArabic() && crop.name_ar ? crop.name_ar : crop.crop_name
              )}</strong>
              <small>${scoreHtml}${
                reasons.length
                  ? ` · ${esc(reasons.join(" "))}`
                  : crop.missing_dimensions?.length
                    ? ` · ${esc(t("px.crops.compat.missing"))}: ${esc(
                        crop.missing_dimensions
                          .map((id) => t(`px.crops.compat.dimension.${id}`))
                          .join(" · ")
                      )}`
                    : ""
              }</small>
            </div>
            <span class="compat-pill ${FS.levelClass(crop.level)}">${esc(
              t(FS.levelKey(crop.level))
            )}</span>
          </div>`;
        })
        .join("")}
    </section>`;
  }

  function reasonText(dimension) {
    if (!dimension) return "";
    const params = dimension.params || {};
    const availability =
      params.availability && params.availability !== "unknown"
        ? t(`water_availability.${params.availability}`)
        : t("water_availability.unknown");
    const key = dimension.reason || "";
    const text = t(key, {
      demand: FS.num(params.demand),
      cap: FS.num(params.cap),
      availability,
      ec: FS.num(params.ec, 2),
      tolerance: FS.num(params.tolerance, 1),
      count: FS.num(params.heat_days),
      total: FS.num(params.period_days),
      value: FS.num(params.rain_total_mm, 1),
    });
    return text === key ? "" : text;
  }

  function planRotation(plan) {
    const rotation = plan.rotation;
    if (!rotation?.scenarios?.length) {
      return `<section class="plan-section">
        <h2>${esc(t("px.plan.rotation"))}</h2>
        <p class="small muted">${esc(t("px.plan.rotationMissing"))}</p>
      </section>`;
    }
    const leader = rotation.scenarios[0];
    return `<section class="plan-section">
      <h2>${esc(t("px.plan.rotation"))}</h2>
      <p>${esc(
        t("px.plan.rotationNote", {
          name: leader ? scenarioTitle(leader.scenario_id, leader.name) : "—",
        })
      )}</p>
      ${rotation.climate_warning ? `<p class="plan-refresh-warn">${esc(rotation.climate_warning)}</p>` : ""}
      <div class="plan-overview-grid">
        ${rotation.scenarios
          .slice(0, 4)
          .map(
            (scenario) => `<div class="plan-fact">
              <span>${esc(scenarioTitle(scenario.scenario_id, scenario.name))}</span>
              <strong>${FS.bidi(
                `${FS.num(scenario.score, 1)} / 100 · ${
                  scenario.range
                    ? `${FS.num(scenario.range.low, 0)}–${FS.num(scenario.range.high, 0)}`
                    : "—"
                }`
              )}</strong>
            </div>`
          )
          .join("")}
      </div>
      <p class="small muted">${esc(t("px.rotation.bandNote"))}</p>
    </section>`;
  }

  function scenarioTitle(id, fallback) {
    const key = `px.scenario.${id}.title`;
    const text = t(key);
    return text === key ? fallback : text;
  }

  function planActions(plan) {
    return `<section class="plan-section">
      <h2>${esc(t("px.plan.actions.title"))}</h2>
      <p class="small muted">${esc(t("px.plan.actions.lede"))}</p>
      <ul class="next-actions">
        ${plan.actions
          .map(
            (id, index) => `<li>
              <span class="action-mark" aria-hidden="true">${index + 1}</span>
              <span>${esc(t(`px.plan.actions.${id}`))}</span>
            </li>`
          )
          .join("")}
      </ul>
    </section>`;
  }

  // ------------------------------------------------------------------
  // Saving and saved plans
  // ------------------------------------------------------------------
  function savePlan() {
    if (!s.current) {
      FS.ui.toast(t("px.plan.needFarm"), "error");
      return;
    }
    const plan = s.current;
    const existing = FS.state.plans.find(
      (item) => item.farmId === plan.farm.id && item.createdAt === plan.generatedAt
    );
    const record = {
      id: existing ? existing.id : FS.uuid(),
      farmId: plan.farm.id,
      farmName: plan.farm.label || plan.farm.name,
      createdAt: plan.generatedAt,
      data: plan,
    };
    FS.state.plans = [record, ...FS.state.plans.filter((item) => item.id !== record.id)];
    FS.state.plans = FS.state.plans.slice(0, 20);
    FS.persistPlans();
    renderSaved();
    FS.ui.toast(t("px.plan.savedToast"));

    FS.api("/api/farm/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        farm_key: plan.farm.id,
        farm_name: plan.farm.label || plan.farm.name,
        latitude: plan.farm.latitude,
        longitude: plan.farm.longitude,
        payload: plan,
      }),
    }).catch(() => FS.ui.toast(t("px.plan.saveFailed"), "error"));
  }

  function renderSaved() {
    const box = $("plan-saved-list");
    if (!box) return;
    const local = FS.state.plans || [];
    const seen = new Set();
    const rows = [
      ...local.map((plan) => ({
        id: plan.id,
        title: plan.farmName || plan.data?.farm?.label || "—",
        createdAt: plan.createdAt,
        kind: "local",
        data: plan.data,
      })),
      ...s.serverPlans.map((plan) => ({
        id: `server-${plan.id}`,
        title: plan.farm_name || plan.payload?.farm?.label || "—",
        createdAt: plan.created_at,
        kind: "server",
        data: plan.payload,
      })),
    ]
      .filter((row) => {
        const stamp = String(row.createdAt || "").replace("T", " ").slice(0, 16);
        const key = `${row.title}|${stamp}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (!rows.length) {
      box.innerHTML = `<p class="small muted">${esc(t("px.plan.savedEmpty"))}</p>`;
      return;
    }
    box.innerHTML = `<div class="saved-plan-list">${rows
      .map(
        (row) => `<div class="saved-plan-row">
          <div>
            <strong>${esc(row.title)}</strong>
            <small>${esc(t("px.plan.createdAt", { date: FS.dateTime(row.createdAt) }))}${
              row.kind === "server" ? ` · ${esc(t("px.plan.analysisSaved"))}` : ""
            }</small>
          </div>
          <div class="saved-plan-actions">
            <button class="btn btn-small btn-ghost" type="button" data-open-plan="${esc(row.id)}">${esc(
              t("px.plan.open")
            )}</button>
            ${
              row.kind === "local"
                ? `<button class="btn btn-small btn-ghost btn-danger" type="button" data-delete-plan="${esc(
                    row.id
                  )}">${esc(t("px.plan.delete"))}</button>`
                : ""
            }
          </div>
        </div>`
      )
      .join("")}</div>`;

    box.querySelectorAll("[data-open-plan]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-open-plan");
        const row = rows.find((item) => item.id === id);
        if (!row?.data) {
          FS.ui.toast(t("px.toast.error"), "error");
          return;
        }
        s.current = row.data;
        renderPlan(row.data);
        setStatus("px.plan.analysisSaved");
        FS.ui.goto("plan");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
    box.querySelectorAll("[data-delete-plan]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!window.confirm(t("px.plan.deleteConfirm"))) return;
        const id = button.getAttribute("data-delete-plan");
        FS.state.plans = FS.state.plans.filter((plan) => plan.id !== id);
        FS.persistPlans();
        renderSaved();
      });
    });
  }

  async function loadServerPlans() {
    if (s.serverLoaded) return;
    s.serverLoaded = true;
    try {
      const body = await FS.api("/api/farm/analyses?limit=10");
      s.serverPlans = (body.analyses || []).filter((item) => item.payload);
      renderSaved();
    } catch (_error) {
      s.serverPlans = [];
    }
  }

  function printPlan() {
    if (!s.current) {
      FS.ui.toast(t("px.plan.needFarm"), "error");
      return;
    }
    window.print();
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  function bindEvents() {
    $("plan-build")?.addEventListener("click", () => build());
    $("plan-save")?.addEventListener("click", savePlan);
    $("plan-print")?.addEventListener("click", printPlan);
    FS.on("viewchange", ({ view }) => {
      if (view !== "plan") return;
      render();
      renderSaved();
      loadServerPlans();
    });
    FS.on("farmchange", () => {
      s.current = null;
      setStatus(null);
      if (FS.state.view === "plan") render();
    });
  }

  function init() {
    bindEvents();
    render();
    renderSaved();
  }

  function rerender() {
    if (s.current) {
      renderPlan(s.current);
      if (s.status) setStatus(s.status.key, s.status.vars);
    } else {
      render();
    }
    renderSaved();
  }

  FS.plan = {
    init,
    render,
    rerender,
    build,
    savePlan,
    renderSaved,
    printPlan,
  };
})();
