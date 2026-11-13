/* Field Shift Egypt — shared application shell and NASA POWER climate view. */
(function () {
  "use strict";

  const state = {
    meta: null,
    governorates: [],
    crops: [],
    location: null,
    power: null,
    requestId: 0,
    loading: false,
    activeTab: "climate",
  };

  const $ = (id) => document.getElementById(id);
  const charts = window.FieldShiftCharts;
  let resolveReady;
  const readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });

  function fmt(value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return Number(value).toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function fmtDate(value) {
    if (!value) return "—";
    const date = new Date(value + (value.length === 10 ? "T00:00:00" : ""));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function fmtDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function formatAge(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return `${Math.round(value)}s`;
    if (value < 3600) return `${Math.round(value / 60)}m`;
    if (value < 86400) return `${Math.floor(value / 3600)}h ${Math.round((value % 3600) / 60)}m`;
    return `${Math.floor(value / 86400)}d ${Math.round((value % 86400) / 3600)}h`;
  }

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { el.hidden = true; }, 3800);
  }

  function currentCoords() {
    return {
      lat: Number($("latitude").value),
      lon: Number($("longitude").value),
    };
  }

  function setPeriodInputs(days) {
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const start = new Date(end);
    start.setDate(end.getDate() - (Number(days) - 1));
    $("start-date").value = isoDate(start);
    $("end-date").value = isoDate(end);
    const custom = $("period-preset").value === "custom";
    $("start-date").disabled = !custom;
    $("end-date").disabled = !custom;
  }

  async function loadBootstrap() {
    const [metaRes, govRes, cropsRes] = await Promise.all([
      fetch("/api/meta").then((r) => r.json()),
      fetch("/api/governorates").then((r) => r.json()),
      fetch("/api/crops").then((r) => r.json()),
    ]);
    state.meta = metaRes;
    state.governorates = govRes.governorates || [];
    state.crops = cropsRes.crops || [];
    populateGovernorates();
    const defaultLocation = metaRes.default_location;
    if (defaultLocation) {
      $("latitude").value = defaultLocation.latitude;
      $("longitude").value = defaultLocation.longitude;
      const gov = state.governorates.find((item) => item.name === defaultLocation.governorate);
      if (gov) $("governorate-select").value = gov.name;
    }
    setPeriodInputs(90);
    await updateLocationContext();
    await loadClimate();
  }

  function populateGovernorates() {
    const select = $("governorate-select");
    const options = ['<option value="">Custom coordinate</option>'];
    state.governorates.forEach((gov) => {
      const label = gov.name_ar ? `${gov.name} — ${gov.name_ar}` : gov.name;
      options.push(`<option value="${gov.name}">${label}${gov.is_pilot ? " · pilot" : ""}</option>`);
    });
    select.innerHTML = options.join("");
  }

  async function updateLocationContext() {
    const { lat, lon } = currentCoords();
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    $("hero-coords").textContent = `${lat.toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
    try {
      const response = await fetch(`/api/location?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Location lookup failed");
      state.location = body.location;
      const gov = body.location.governorate;
      if (gov) {
        $("hero-location").textContent = `${gov.name} Governorate`;
        $("governorate-select").value = gov.name;
      } else if (body.location.in_egypt) {
        $("hero-location").textContent = "Egypt · boundary not resolved";
        $("governorate-select").value = "";
      } else {
        $("hero-location").textContent = "Location outside Egypt";
        $("governorate-select").value = "";
      }
      const note = gov
        ? "Egypt-focused MVP: local crop and soil references are available for this governorate."
        : "NASA climate data may still be available, but Egyptian soil/crop rules and rotation scores do not apply outside Egypt.";
      $("hero-note").textContent = note;
    } catch (error) {
      console.warn(error);
    }
  }

  function showError(title, message, detail) {
    $("error-title").textContent = title;
    $("error-message").textContent = message || "Unknown error.";
    $("error-detail").textContent = detail || "";
    $("climate-error").hidden = false;
  }

  function hideError() {
    $("climate-error").hidden = true;
  }

  function showInfo(message) {
    const el = $("climate-info");
    if (!message) {
      el.hidden = true;
      return;
    }
    el.textContent = message;
    el.hidden = false;
  }

  async function loadClimate(force = false) {
    if (state.loading) return;
    hideError();
    showInfo("");
    const { lat, lon } = currentCoords();
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showError("Invalid coordinate", "Enter numeric latitude and longitude before loading data.");
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      showError("Invalid coordinate", "Latitude must be between −90 and 90 and longitude between −180 and 180.");
      return;
    }

    const preset = $("period-preset").value;
    let query;
    if (preset === "custom") {
      const start = $("start-date").value;
      const end = $("end-date").value;
      if (!start || !end) {
        showError("Dates required", "Choose both a start and end date for a custom period.");
        return;
      }
      query = `lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&start=${start}&end=${end}`;
    } else {
      query = `lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&days=${preset}`;
    }
    if (force) query += "&refresh=1";

    const requestId = ++state.requestId;
    state.loading = true;
    const button = $("load-climate");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Contacting NASA…";
    $("hero-note").textContent = "Requesting real observations from NASA POWER…";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);

    try {
      const response = await fetch(`/api/power?${query}`, { signal: controller.signal });
      const body = await response.json();
      if (requestId !== state.requestId) return;
      if (!response.ok) {
        const err = body.error || {};
        showError(
          err.code === "power_timeout" ? "NASA POWER timed out" : "NASA POWER request failed",
          err.message || `HTTP ${response.status}`,
          [err.detail, err.hint].filter(Boolean).join(" · ")
        );
        $("hero-note").textContent = "The last request failed. Existing charts, if any, are from the previous successful load.";
        return;
      }
      state.power = body;
      renderPower(body);
    } catch (error) {
      if (requestId !== state.requestId) return;
      const message = error.name === "AbortError"
        ? "The request exceeded 90 seconds. NASA POWER may be slow or unreachable."
        : "Could not reach the local API. Is the Flask server running?";
      showError("Could not load climate data", message, String(error));
      $("hero-note").textContent = "No data were loaded. No placeholder values were generated.";
    } finally {
      clearTimeout(timer);
      if (requestId === state.requestId) {
        state.loading = false;
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  function renderPower(data) {
    const { source, period, summaries, quality, series, power } = data;
    const latest = period.last_observation;
    $("hero-latest").textContent = latest ? fmtDate(latest) : "No valid date";
    $("hero-completeness").textContent = `${fmt(quality.completeness_pct, 1)}%`;
    const cache = data.cache;
    const cacheSuffix = cache && cache.hit
      ? ` · cache ${formatAge(cache.age_seconds)} old`
      : " · fresh request";
    $("hero-note").textContent = `Real NASA POWER response${cacheSuffix} · ${quality.days} requested days · ${quality.valid_cells} valid cells. Grid-cell estimates, not farm sensors.`;
    $("query-source").textContent = `NASA POWER · ${source.community} · ${source.time_standard}${cache && cache.hit ? " · cached" : ""}`;

    const temp = summaries.T2M || {};
    const rain = summaries.PRECTOTCORR || {};
    const solar = summaries.ALLSKY_SFC_SW_DWN || {};
    $("kpi-temp").textContent = fmt(temp.mean, 1);
    $("kpi-temp-foot").textContent = temp.valid_days
      ? `${temp.valid_days} valid days · range ${fmt(temp.min, 1)}–${fmt(temp.max, 1)} °C`
      : "No valid temperature observations";
    $("kpi-rain").textContent = fmt(rain.total, Math.abs(rain.total || 0) < 1 ? 2 : 1);
    $("kpi-rain-foot").textContent = rain.valid_days
      ? `${rain.valid_days} valid days · ${rain.wet_days} day(s) ≥ 0.1 mm`
      : "No valid precipitation observations";
    $("kpi-solar").textContent = fmt(solar.mean, 2);
    $("kpi-solar-foot").textContent = solar.valid_days
      ? `${solar.valid_days} valid days · range ${fmt(solar.min, 2)}–${fmt(solar.max, 2)}`
      : "No valid solar observations";
    $("kpi-gaps").textContent = fmt(100 - quality.completeness_pct, 1);
    $("kpi-gaps-foot").textContent = `${quality.missing_cells} of ${quality.days * quality.parameters} cells missing · gaps kept as null`;

    renderRisk(data.indicators);

    $("source-name").textContent = source.name;
    $("source-url").textContent = "power.larc.nasa.gov ↗";
    $("source-url").href = source.url;
    const units = [...new Set(source.parameters.map((p) => p.unit))].filter(Boolean);
    $("source-units").textContent = units.join(" · ");
    $("source-period").textContent = period.first_observation && latest
      ? `${fmtDate(period.first_observation)} → ${fmtDate(latest)}`
      : "No valid observations";
    $("source-requested").textContent = `Requested: ${fmtDate(period.requested_start)} → ${fmtDate(period.requested_end)} (${period.days_requested} days)`;
    $("source-latest").textContent = latest ? fmtDate(latest) : "—";
    $("source-retrieved").textContent = cache && cache.hit
      ? `Retrieved ${fmtDateTime(source.retrieved_at)} UTC · served from SQLite cache (${formatAge(cache.age_seconds)} old)`
      : `Retrieved ${fmtDateTime(source.retrieved_at)} UTC · fresh NASA POWER request`;
    $("provenance-note").textContent =
      `${source.note} POWER source streams: ${(power.sources || []).join(", ") || "not reported"}. ` +
      "Missing/fill values are returned as null, never zero. NASA does not endorse this application.";

    renderQualityTable(summaries);
    renderRaw(data);
    charts.renderTemperature(series);
    charts.renderWater(series);
    charts.renderSoil(series);

    if (rain.valid_days && rain.wet_days === 0) {
      $("water-note").textContent = `Bars: daily precipitation. No day reached 0.1 mm (max ${fmt(rain.max_daily, 2)} mm/day); zeros are real observations. Line: all-sky shortwave radiation.`;
    } else {
      $("water-note").textContent = "Bars: daily precipitation. Line: all-sky shortwave radiation. Gaps indicate missing data.";
    }
    $("temp-note").textContent = `Mean, maximum and minimum daily temperature. ${temp.valid_days ? `${temp.valid_days} valid days; ${temp.missing_days} missing.` : "No valid days."}`;
    $("soil-note").textContent = "Root-zone wetness is a POWER/MERRA-2 model proxy (not SMAP) shown as a 0–1 fraction. Humidity is daily mean at 2 m.";

    const warnings = [];
    if (quality.completeness_pct < 90) {
      warnings.push(`Data completeness is ${fmt(quality.completeness_pct, 1)}%. Missing cells remain visible as gaps and are not treated as zero.`);
    }
    if (latest) {
      const lag = Math.round((new Date(period.requested_end + "T00:00:00") - new Date(latest + "T00:00:00")) / 86400000);
      if (lag > 7) warnings.push(`Latest valid observation is ${lag} days before the requested end date; this reflects NASA POWER source latency.`);
    }
    if (power.messages && power.messages.length) {
      warnings.push(`POWER API messages: ${power.messages.join("; ")}`);
    }
    showInfo(warnings.join(" "));
  }

  function renderRisk(indicators) {
    const badge = $("risk-overall-badge");
    const confidence = $("risk-confidence");
    const grid = $("risk-signals");
    const note = $("risk-note");
    if (!badge || !grid) return;

    if (!indicators || !Array.isArray(indicators.signals)) {
      badge.className = "risk-badge risk-unknown";
      badge.textContent = "No data";
      confidence.textContent = "Load data to calculate";
      grid.innerHTML = '<p class="muted small">No screening signals are available for this response.</p>';
      note.textContent = "Every signal exposes its threshold and observed count. Missing days are excluded, never replaced with zero.";
      return;
    }

    const severity = indicators.overall_severity || "unknown";
    badge.className = `risk-badge risk-${severity}`;
    badge.textContent = `${indicators.overall_label || "No data"} overall`;
    const confidenceLabel = { high: "high", medium: "medium", low: "low" }[indicators.confidence] || "unknown";
    confidence.textContent = `${confidenceLabel} screening confidence · ${fmt(indicators.coverage_pct, 1)}% data coverage`;

    grid.innerHTML = indicators.signals.map((signal) => {
      const level = signal.severity || "unknown";
      const value = signal.value === null || signal.value === undefined ? "—" : fmt(signal.value, 0);
      return `
        <article class="risk-card risk-${level}">
          <div class="risk-card-head">
            <h3>${escapeHtml(signal.label)}</h3>
            <span class="risk-badge risk-${level}">${escapeHtml(signal.severity_label || "No data")}</span>
          </div>
          <p class="risk-value">${value}<span>${escapeHtml(signal.unit || "")}</span></p>
          <p class="risk-observed">${escapeHtml(signal.observed)}</p>
          <details>
            <summary>Threshold, method &amp; source</summary>
            <p><strong>Threshold:</strong> ${escapeHtml(signal.threshold)}</p>
            <p><strong>Detail:</strong> ${escapeHtml(signal.detail)}</p>
            <p><strong>Source:</strong> ${escapeHtml(signal.basis)} · calculated indicator</p>
            <p>${escapeHtml(signal.caveat)}</p>
          </details>
        </article>`;
    }).join("");

    note.textContent = `${indicators.summary} ${indicators.disclaimer}`;
  }

  function renderQualityTable(summaries) {
    const rows = Object.values(summaries).map((item) => {
      const missingClass = item.missing_days > 0 ? "pill pill-missing" : "pill";
      const value = item.parameter === "PRECTOTCORR"
        ? `${fmt(item.total, Math.abs(item.total || 0) < 1 ? 2 : 1)} mm total`
        : `${fmt(item.mean, item.parameter === "GWETROOT" ? 3 : 1)} ${item.unit || ""}`;
      return `
        <tr>
          <td><strong>${escapeHtml(item.label)}</strong></td>
          <td><code>${escapeHtml(item.parameter)}</code></td>
          <td>${escapeHtml(item.unit || "—")}</td>
          <td class="num">${item.valid_days}</td>
          <td><span class="${missingClass}">${item.missing_days}</span></td>
          <td>${fmtDate(item.last_observation)}</td>
          <td class="num">${value}</td>
        </tr>`;
    });
    $("quality-table").innerHTML = rows.join("");
  }

  function renderRaw(data) {
    const payload = {
      source: {
        name: data.source.name,
        api_version: data.source.api_version,
        community: data.source.community,
        time_standard: data.source.time_standard,
        retrieved_at: data.source.retrieved_at,
        power_sources: data.source.sources,
      },
      location: data.location,
      period: data.period,
      quality: data.quality,
      summaries: data.summaries,
      power_messages: data.power.messages,
      sample_rows: data.series.slice(0, 3),
    };
    $("raw-json").textContent = JSON.stringify(payload, null, 2);
    $("raw-meta").textContent =
      `Processed envelope · ${data.series.length} date rows · raw fill value ${data.power.fill_value} · ` +
      `first/last header ${data.power.header_start}–${data.power.header_end}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
  }

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll(".tab-link").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tab === tab);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      const active = panel.id === `tab-${tab}`;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    const hooks = {
      satellite: window.FieldShiftSatellite,
      farm: window.FieldShiftFarm,
      rotation: window.FieldShiftRotation,
      methods: window.FieldShiftMethods,
    };
    const hook = hooks[tab];
    if (hook && typeof hook.init === "function") hook.init();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function bind() {
    document.querySelectorAll(".tab-link").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.tab));
    });
    document.querySelectorAll("[data-goto-tab]").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.gotoTab));
    });

    $("climate-form").addEventListener("submit", (event) => {
      event.preventDefault();
      updateLocationContext();
      loadClimate();
    });
    $("load-climate").addEventListener("click", () => loadClimate(true));
    $("retry-climate").addEventListener("click", () => loadClimate(true));

    $("governorate-select").addEventListener("change", (event) => {
      const gov = state.governorates.find((item) => item.name === event.target.value);
      if (!gov) return;
      $("latitude").value = gov.latitude;
      $("longitude").value = gov.longitude;
      $("hero-location").textContent = `${gov.name} Governorate`;
      updateLocationContext();
      toast(`${gov.name}: representative centre loaded. Click the farm map later to refine the location.`);
    });

    $("period-preset").addEventListener("change", (event) => {
      if (event.target.value === "custom") {
        $("start-date").disabled = false;
        $("end-date").disabled = false;
      } else {
        setPeriodInputs(event.target.value);
      }
    });

    $("toggle-raw").addEventListener("click", (event) => {
      const drawer = $("raw-drawer");
      drawer.hidden = !drawer.hidden;
      event.currentTarget.setAttribute("aria-expanded", String(!drawer.hidden));
      event.currentTarget.textContent = drawer.hidden ? "Show observation period" : "Hide observation period";
    });

    ["latitude", "longitude"].forEach((id) => {
      $(id).addEventListener("change", updateLocationContext);
    });

    document.querySelectorAll("[data-switch]").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.switch));
    });
  }

  window.FieldShiftApp = {
    state,
    switchTab,
    toast,
    fmt,
    fmtDate,
    fmtDateTime,
    escapeHtml,
    loadClimate,
    setPeriodInputs,
    updateLocationContext,
    currentCoords,
  };

  document.addEventListener("DOMContentLoaded", () => {
    bind();
    loadBootstrap().catch((error) => {
      console.error(error);
      showError("Application initialisation failed", "Could not load reference metadata or governorates.", String(error));
    });
  });
})();
