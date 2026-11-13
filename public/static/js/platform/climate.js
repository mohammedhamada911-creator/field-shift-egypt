/* Field Shift Egypt — Land & Climate: NASA POWER + GIBS/CMR context. */
(function () {
  "use strict";

  const FS = (window.FieldShift = window.FieldShift || {});
  const t = (key, vars) => window.FieldShiftI18n.t(key, vars);
  const esc = (value) => FS.esc(value);
  const $ = (id) => document.getElementById(id);

  const s = {
    days: {},
    charts: {},
    loading: false,
    satelliteLoading: false,
  };

  function selectedDays(farm) {
    return s.days[farm?.id] || 90;
  }

  function destroyCharts() {
    Object.values(s.charts).forEach((chart) => {
      try {
        chart.destroy();
      } catch (_error) {
        /* chart already gone */
      }
    });
    s.charts = {};
  }

  function setLoading(loading) {
    s.loading = loading;
    const box = $("climate-loading");
    if (box) box.hidden = !loading;
    const root = $("climate-root");
    if (root && loading) root.hidden = true;
  }

  function showError(show) {
    const box = $("climate-error");
    if (box) box.hidden = !show;
  }

  function activeDays() {
    const farm = FS.activeFarm();
    return selectedDays(farm);
  }

  async function load(force = false) {
    const farm = FS.activeFarm();
    if (!farm) {
      render();
      return null;
    }
    const days = selectedDays(farm);
    showError(false);
    setLoading(true);
    try {
      const query = new URLSearchParams({
        lat: farm.latitude,
        lon: farm.longitude,
        days: String(days),
      });
      if (force) query.set("refresh", "1");
      const data = await FS.api(`/api/power?${query.toString()}`);
      FS.state.climate[farm.id] = {
        days,
        data,
        fetchedAt: Date.now(),
      };
      FS.emit("climatechange", { farmId: farm.id });
      if (FS.activeFarm()?.id === farm.id) renderData();
      return data;
    } catch (error) {
      showError(true);
      const root = $("climate-root");
      if (root) root.hidden = true;
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function getData(options = {}) {
    const farm = FS.activeFarm();
    if (!farm) return null;
    const days = options.days || selectedDays(farm);
    const cached = FS.state.climate[farm.id];
    if (!options.force && cached && cached.days === days && cached.data) {
      return cached.data;
    }
    return load(options.force);
  }

  function context(farm = FS.activeFarm()) {
    if (!farm) return null;
    const cached = FS.state.climate[farm.id];
    return cached ? FS.climateContextFromData(cached.data) : null;
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function render(options = {}) {
    const farm = FS.activeFarm();
    const empty = $("climate-empty");
    const root = $("climate-root");
    const error = $("climate-error");
    document.querySelectorAll("[data-climate-days]").forEach((button) => {
      button.classList.toggle(
        "is-active",
        Number(button.getAttribute("data-climate-days")) === activeDays()
      );
    });
    if (!farm) {
      if (empty) empty.hidden = false;
      if (root) {
        root.hidden = true;
        root.innerHTML = "";
      }
      if (error) error.hidden = true;
      setLoading(false);
      return;
    }
    if (empty) empty.hidden = true;
    const cached = FS.state.climate[farm.id];
    if (cached && cached.data && cached.days === selectedDays(farm)) {
      renderData();
      return;
    }
    destroyCharts();
    if (root) {
      root.hidden = false;
      root.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon" aria-hidden="true">🌤️</div>
          <h2>${esc(t("px.climate.load"))}</h2>
          <p class="small muted">${esc(t("px.climate.periodNote"))}</p>
          <button class="btn btn-primary" type="button" id="climate-load">${esc(
            t("px.climate.load")
          )}</button>
        </div>`;
      $("climate-load")?.addEventListener("click", () => load(false));
    }
    if (options.autoLoad) load(false);
  }

  function renderData() {
    const farm = FS.activeFarm();
    const root = $("climate-root");
    const empty = $("climate-empty");
    const cached = farm ? FS.state.climate[farm.id] : null;
    if (!farm || !root || !cached || !cached.data) return;
    if (empty) empty.hidden = true;
    showError(false);
    const data = cached.data;
    if (!Array.isArray(data.series) || !data.series.length) {
      root.hidden = false;
      root.innerHTML = `<div class="alert alert-info"><p>${esc(t("px.common.noDataYet"))}</p></div>`;
      return;
    }
    const period = data.period || {};
    const quality = data.quality || {};
    const summaries = data.summaries || {};
    const tmax = summaries.T2M_MAX || {};
    const rain = summaries.PRECTOTCORR || {};
    const solar = summaries.ALLSKY_SFC_SW_DWN || {};
    const signals = data.indicators?.signals || [];

    root.hidden = false;
    root.innerHTML = `
      <div class="climate-meta">
        <span class="provenance-tag tag-nasa">${esc(t("px.common.fromNasa"))}</span>
        <span class="small muted">${esc(t("px.climate.dateRange", {
          start: FS.date(period.first_observation),
          end: FS.date(period.last_observation),
        }))}</span>
        <span class="small muted">${esc(t("px.climate.latest"))}: ${esc(
          FS.date(quality.latest_observation)
        )}</span>
        <span class="small muted">${esc(t("px.climate.periodNote"))}</span>
      </div>

      <div class="kpi-grid">
        ${kpi(t("px.climate.kpi.tmax"), FS.num(tmax.mean, 1), "°C", t("px.climate.kpi.validDays", { count: tmax.valid_days ?? "—" }))}
        ${kpi(t("px.climate.kpi.rain"), FS.num(rain.total, 1), "mm", t("px.climate.kpi.rainDays", { count: rain.wet_days ?? "—" }))}
        ${kpi(t("px.climate.kpi.solar"), FS.num(solar.mean, 1), "kWh/m²/day", t("px.climate.kpi.validDays", { count: solar.valid_days ?? "—" }))}
        ${kpi(t("px.climate.kpi.coverage"), FS.num(quality.completeness_pct, 1), "%", t("px.climate.kpi.gapDays", { count: quality.missing_cells ?? "—" }))}
      </div>

      <div class="chart-grid">
        <section class="surface-card chart-card">
          <div class="chart-head">
            <h2>${esc(t("px.climate.chart.temp.title"))}</h2>
            <p>${esc(t("px.climate.chart.temp.sub"))}</p>
          </div>
          <div class="chart-wrap"><canvas id="chart-climate-temp" aria-label="${esc(
            t("px.climate.chart.temp.title")
          )}" role="img"></canvas></div>
          <p class="chart-note">${esc(t("px.climate.chart.hint"))}</p>
        </section>
        <section class="surface-card chart-card">
          <div class="chart-head">
            <h2>${esc(t("px.climate.chart.rain.title"))}</h2>
            <p>${esc(t("px.climate.chart.rain.sub"))}</p>
          </div>
          <div class="chart-wrap"><canvas id="chart-climate-rain" aria-label="${esc(
            t("px.climate.chart.rain.title")
          )}" role="img"></canvas></div>
          <p class="chart-note">${esc(t("px.climate.gapNote"))}</p>
        </section>
      </div>

      <section class="surface-card signals-card">
        <div class="section-head-inline">
          <div>
            <h2>${esc(t("px.climate.signals.title"))}</h2>
            <p>${esc(t("px.climate.signals.sub"))}</p>
          </div>
          <span class="signal-badge badge-${esc(FS.severityClass(data.indicators?.overall_severity))}">
            ${esc(t("px.climate.signals.overall"))}: ${esc(severityLabel(data.indicators?.overall_severity))}
          </span>
        </div>
        <div class="signal-grid">${signals.map(signalHtml).join("") || `<p class="small muted">${esc(
          t("px.climate.signal.none")
        )}</p>`}</div>
      </section>

      <section class="surface-card signals-card">
        <div class="section-head-inline">
          <div>
            <h2>${esc(t("px.climate.explain.title"))}</h2>
          </div>
        </div>
        <div id="climate-explain"></div>
        <p class="small muted">${esc(t("px.climate.sourceNote"))}</p>
      </section>

      <section class="surface-card signals-card" id="satellite-card">
        <div class="section-head-inline">
          <div>
            <h2>${esc(t("px.climate.sat.title"))}</h2>
            <p>${esc(t("px.climate.sat.sub"))}</p>
          </div>
        </div>
        <div id="satellite-body"></div>
      </section>

      <p class="small muted">${esc(t("px.climate.refreshNote"))}</p>
      ${data.served_from_cache ? `<p class="small muted">${esc(t("px.common.fromCache"))}</p>` : ""}
    `;

    renderCharts(data);
    renderExplanation(signals);
    renderSatellite();
  }

  function kpi(label, value, unit, foot) {
    return `<div class="kpi">
      <span class="mini-label">${esc(label)}</span>
      <p class="kpi-value">${esc(value)}<span class="unit">${esc(unit)}</span></p>
      <p class="kpi-foot">${esc(foot)}</p>
    </div>`;
  }

  function severityLabel(severity) {
    if (severity === "high") return t("common.high");
    if (severity === "watch") return t("common.watch");
    if (severity === "low") return t("common.low");
    return t("common.unknown");
  }

  function signalHtml(signal) {
    const key = signal.id;
    const label = t(`risk.${key}`) === `risk.${key}` ? signal.label : t(`risk.${key}`);
    const explanation = t(`risk.${key}.${signal.severity}`);
    const hasExplanation = explanation !== `risk.${key}.${signal.severity}`;
    return `<article class="signal-card signal-${esc(FS.severityClass(signal.severity))}">
      <div class="signal-head">
        <h3>${esc(label)}</h3>
        <span class="signal-badge badge-${esc(FS.severityClass(signal.severity))}">${esc(
          severityLabel(signal.severity)
        )}</span>
      </div>
      <p class="signal-value">${esc(FS.num(signal.value))} <span>${esc(signal.unit || "")}</span></p>
      ${hasExplanation ? `<p class="signal-observed">${esc(explanation)}</p>` : ""}
      <details>
        <summary>${esc(t("px.climate.signal.rule"))}</summary>
        <p>${esc(signal.observed || "")}</p>
        <p><strong>${esc(t("px.climate.signal.sourceVar"))}:</strong> ${esc(signal.basis || "")}</p>
        <p><strong>${esc(t("px.climate.signal.rule"))}:</strong> ${esc(signal.threshold || "")}</p>
        ${signal.caveat ? `<p>${esc(signal.caveat)}</p>` : ""}
      </details>
    </article>`;
  }

  function renderExplanation(signals) {
    const box = $("climate-explain");
    if (!box) return;
    const has = (id) =>
      signals.some((signal) => signal.id === id && ["high", "watch"].includes(signal.severity));
    const notes = [];
    if (has("heat_stress")) notes.push(t("px.climate.explain.heat"));
    if (has("dry_spell")) notes.push(t("px.climate.explain.rain"));
    if (!notes.length) notes.push(t("px.climate.explain.mild"));
    box.innerHTML = `<ul class="explain-list">${notes
      .map((note) => `<li>${esc(note)}</li>`)
      .join("")}</ul>`;
  }

  // ------------------------------------------------------------------
  // Charts
  // ------------------------------------------------------------------
  function renderCharts(data) {
    destroyCharts();
    if (!window.Chart) return;
    const rows = data.series || [];
    const labels = rows.map((row) => FS.shortDate(row.date));
    const max = rows.map((row) => (row.T2M_MAX === null ? null : row.T2M_MAX));
    const min = rows.map((row) => (row.T2M_MIN === null ? null : row.T2M_MIN));
    const rain = rows.map((row) => (row.PRECTOTCORR === null ? null : row.PRECTOTCORR));

    const tempCanvas = $("chart-climate-temp");
    if (tempCanvas && max.some((value) => value !== null)) {
      s.charts.temp = new Chart(tempCanvas, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: t("px.climate.kpi.tmax"),
              data: max,
              borderColor: "#a94a32",
              backgroundColor: "rgba(169, 74, 50, .12)",
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.28,
              spanGaps: false,
            },
            {
              label: t("px.climate.chart.temp.min"),
              data: min,
              borderColor: "#2b6a80",
              backgroundColor: "rgba(43, 106, 128, .10)",
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.28,
              spanGaps: false,
            },
          ],
        },
        options: chartOptions("°C"),
      });
    } else if (tempCanvas) {
      tempCanvas.closest(".chart-wrap").innerHTML = `<div class="chart-empty">${esc(
        t("px.climate.chart.empty")
      )}</div>`;
    }

    const rainCanvas = $("chart-climate-rain");
    if (rainCanvas && rain.some((value) => value !== null)) {
      s.charts.rain = new Chart(rainCanvas, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: t("px.climate.chart.rain.title"),
              data: rain,
              backgroundColor: "rgba(44, 117, 88, .55)",
              borderColor: "#2c7558",
              borderWidth: 1,
            },
          ],
        },
        options: chartOptions("mm"),
      });
    } else if (rainCanvas) {
      rainCanvas.closest(".chart-wrap").innerHTML = `<div class="chart-empty">${esc(
        t("px.climate.chart.empty")
      )}</div>`;
    }
  }

  function chartOptions(unit) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              const value = item.parsed.y;
              return `${item.dataset.label}: ${value === null ? "—" : FS.num(value, 1)} ${unit}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 8, font: { size: 10 }, autoSkip: true },
          grid: { display: false },
        },
        y: {
          ticks: { font: { size: 10 } },
          grid: { color: "rgba(109, 127, 118, .14)" },
        },
      },
    };
  }

  // ------------------------------------------------------------------
  // Satellite imagery (context only)
  // ------------------------------------------------------------------
  function renderSatellite() {
    const farm = FS.activeFarm();
    const box = $("satellite-body");
    if (!box) return;
    if (!farm) return;
    const status = FS.state.satellite[farm.id];
    if (!status) {
      box.innerHTML = `
        <button class="btn btn-ghost" type="button" id="satellite-load">${esc(
          t("px.climate.sat.load")
        )}</button>
        <p class="small muted">${esc(t("px.climate.sat.notMeasured"))}</p>`;
      $("satellite-load")?.addEventListener("click", loadSatellite);
      return;
    }
    if (status.error) {
      box.innerHTML = `<div class="alert alert-info"><div><strong>${esc(
        t("px.climate.sat.unavailable")
      )}</strong><p class="small">${esc(status.error)}</p></div></div>`;
      return;
    }
    const sources = status.payload?.sources || [];
    box.innerHTML = `
      <div class="sat-grid">
        ${sources
          .map((source) => {
            const date = source.gibs_imagery_date;
            const url = `/api/satellite/image/${encodeURIComponent(source.id)}?lat=${farm.latitude}&lon=${farm.longitude}&date=${encodeURIComponent(date || "")}`;
            const granule = source.cmr?.latest;
            const count = source.cmr?.granule_count_sampled;
            return `<article class="sat-card">
              <div class="sat-head">
                <h3>${esc(source.short_name || source.id.toUpperCase())}</h3>
                <span class="sat-badge${source.gibs_available ? "" : " sat-limited"}">${esc(
                  source.gibs_available ? t("px.climate.sat.imagery") : t("common.missing")
                )}</span>
              </div>
              ${
                source.gibs_available
                  ? `<img class="sat-preview" loading="lazy" src="${esc(url)}" alt="${esc(
                      source.name
                    )}">`
                  : `<div class="sat-preview-empty">${esc(t("px.climate.sat.unavailable"))}</div>`
              }
              <p class="sat-meta">${esc(t("px.common.observation"))}: ${esc(FS.date(date))}</p>
              ${
                granule
                  ? `<p class="sat-meta">${esc(t("px.climate.sat.granules"))}: ${esc(
                      FS.date(granule.time_start)
                    )}${count ? ` · ${esc(t("px.climate.sat.granulesCount", { count, days: 21 }))}` : ""}</p>`
                  : ""
              }
              <p class="sat-note">${esc(t("px.climate.sat.notMeasured"))}</p>
              <p class="sat-note">${esc(t("px.climate.sat.quantitative"))}</p>
              ${
                source.worldview_url
                  ? `<a class="small" href="${esc(source.worldview_url)}" target="_blank" rel="noopener noreferrer">NASA Worldview ↗</a>`
                  : ""
              }
            </article>`;
          })
          .join("")}
      </div>`;
  }

  async function loadSatellite() {
    const farm = FS.activeFarm();
    if (!farm || s.satelliteLoading) return;
    s.satelliteLoading = true;
    const box = $("satellite-body");
    if (box) {
      box.innerHTML = `<div class="inline-loading"><div class="loading-spinner" aria-hidden="true"></div><p>${esc(
        t("px.climate.sat.loading")
      )}</p></div>`;
    }
    try {
      const payload = await FS.api(
        `/api/satellite/status?lat=${encodeURIComponent(farm.latitude)}&lon=${encodeURIComponent(
          farm.longitude
        )}`
      );
      FS.state.satellite[farm.id] = { payload, fetchedAt: Date.now() };
      FS.emit("satellitechange", { farmId: farm.id });
      if (FS.activeFarm()?.id === farm.id) renderSatellite();
    } catch (error) {
      FS.state.satellite[farm.id] = { error: error.message || "unavailable" };
      if (FS.activeFarm()?.id === farm.id) renderSatellite();
    } finally {
      s.satelliteLoading = false;
    }
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  function init() {
    document.querySelectorAll("[data-climate-days]").forEach((button) => {
      button.addEventListener("click", () => {
        const farm = FS.activeFarm();
        if (!farm) return;
        const days = Number(button.getAttribute("data-climate-days"));
        s.days[farm.id] = days;
        document.querySelectorAll("[data-climate-days]").forEach((item) => {
          item.classList.toggle(
            "is-active",
            Number(item.getAttribute("data-climate-days")) === days
          );
        });
        const cached = FS.state.climate[farm.id];
        if (cached && cached.days === days) render();
        else load(false);
      });
    });
    $("climate-refresh")?.addEventListener("click", () => load(true));
    $("climate-retry")?.addEventListener("click", () => load(true));
    FS.on("viewchange", ({ view }) => {
      if (view !== "climate") return;
      const farm = FS.activeFarm();
      if (farm && !FS.state.climate[farm.id]) load(false);
      else render();
    });
    FS.on("farmchange", () => {
      destroyCharts();
      if (FS.state.view === "climate") render({ autoLoad: true });
    });
    render();
  }

  function rerender() {
    if (!FS.activeFarm()) {
      destroyCharts();
      render();
      return;
    }
    const cached = FS.state.climate[FS.activeFarm().id];
    if (cached) renderData();
    else render();
  }

  FS.climate = {
    init,
    render,
    rerender,
    load,
    getData,
    context,
    selectedDays,
  };
})();
