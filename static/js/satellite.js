/* Phase 3: NASA satellite context (SMAP, GPM IMERG, MODIS). */
(function () {
  "use strict";

  const state = { loading: false, data: null, key: null, error: null };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => window.FieldShiftApp.escapeHtml(value);

  function fmtDate(value) {
    if (!value) return "—";
    const iso = String(value).slice(0, 10);
    const d = new Date(iso + "T00:00:00");
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function coords() {
    return window.FieldShiftApp.currentCoords();
  }

  function statusBadge(source) {
    if (source.gibs_available && source.cmr && source.cmr.ok) {
      return '<span class="pill tag-verified">Public path verified</span>';
    }
    if (source.gibs_available || (source.cmr && source.cmr.ok)) {
      return '<span class="pill tag-limited">Partially available</span>';
    }
    return '<span class="pill pill-missing">Unavailable</span>';
  }

  function render(payload) {
    const app = $("satellite-app");
    if (!payload) {
      app.innerHTML = `<div class="alert alert-error"><div class="alert-icon">!</div><div><strong>Satellite status unavailable</strong><p>${esc(state.error || "Unknown error")}</p></div></div>`;
      return;
    }
    const { latitude, longitude } = payload.location;
    const summary = payload.summary;
    const cards = payload.sources.map((source) => {
      const latest = source.cmr && source.cmr.latest;
      const imageUrl = `/api/satellite/image/${encodeURIComponent(source.id)}?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&date=${encodeURIComponent(source.gibs_imagery_date || "")}`;
      const granules = (source.cmr && source.cmr.granules) || [];
      return `
        <article class="surface-card sat-card">
          <div class="sat-head">
            <div>
              <p class="mini-label">${esc(source.provider)}</p>
              <h2 class="sat-name">${esc(source.short_name)}</h2>
            </div>
            ${statusBadge(source)}
          </div>
          <p class="sat-meta">${esc(source.name)}</p>

          <figure class="sat-figure">
            ${source.gibs_available
              ? `<img class="sat-preview" src="${imageUrl}" alt="NASA GIBS ${esc(source.gibs_layer_label)} preview near ${latitude.toFixed(3)}, ${longitude.toFixed(3)}" loading="lazy">`
              : `<div class="sat-preview sat-preview-empty">Imagery not available for this date.<br><span>${esc(source.gibs_error || "NASA GIBS returned no image.")}</span></div>`}
            <figcaption class="sat-caption">
              <span>NASA GIBS · ${esc(source.gibs_layer_label)}</span>
              <span>${fmtDate(source.gibs_imagery_date)}</span>
            </figcaption>
          </figure>
          <p class="sat-note">${esc(source.gibs_note)}</p>

          <dl class="sat-kv">
            <div><dt>Resolution</dt><dd>${esc(source.spatial_resolution)}</dd></div>
            <div><dt>Coverage</dt><dd>${esc(source.temporal_coverage)}</dd></div>
            <div><dt>Update</dt><dd>${esc(source.update_frequency)}</dd></div>
            <div><dt>Variable / unit</dt><dd>${esc(source.variables)} · ${esc(source.units)}</dd></div>
          </dl>

          <div class="access-box ${source.quantitative_available ? "access-ok" : "access-limited"}">
            <p class="mini-label">Quantitative values</p>
            <p><span class="status-dot ${source.quantitative_available ? "status-ok" : "status-limited"}"></span>${source.quantitative_available ? "Available" : "Requires NASA Earthdata Login"}</p>
            <p class="small">${esc(source.quantitative_note)}</p>
          </div>

          <div class="granule-box">
            <div class="granule-head">
              <p class="mini-label">CMR granule metadata</p>
              <span class="small">${source.cmr && source.cmr.ok ? `${source.cmr.granule_count_sampled} recent granule(s) sampled` : "Search unavailable"}</span>
            </div>
            ${latest
              ? `<p class="granule-title">${esc(latest.title)}</p>
                 <p class="small muted">Observation start: ${fmtDate(latest.time_start)} · CMR updated ${fmtDate(latest.updated)}</p>`
              : `<p class="small muted">${esc((source.cmr && source.cmr.expected_note) || "No recent granule metadata returned for this window.")}</p>`}
            ${granules.length > 1 ? `<details class="granule-details"><summary>List sampled granules</summary><ul>${granules.slice(1).map((g) => `<li>${esc(g.title)}<br><span class="muted">${fmtDate(g.time_start)}</span></li>`).join("")}</ul></details>` : ""}
          </div>

          <div class="sat-actions">
            <a class="btn btn-small btn-ghost" href="${esc(source.worldview_url)}" target="_blank" rel="noopener">Open in NASA Worldview ↗</a>
            <a class="btn btn-small btn-ghost" href="${esc(source.docs_url)}" target="_blank" rel="noopener">Official product page ↗</a>
            <a class="btn btn-small btn-ghost" href="${esc(source.doi)}" target="_blank" rel="noopener">DOI ↗</a>
          </div>
        </article>`;
    });

    app.innerHTML = `
      <div class="sat-summary">
        <div><span class="mini-label">Location</span><strong>${latitude.toFixed(4)}, ${longitude.toFixed(4)}</strong></div>
        <div><span class="mini-label">GIBS imagery</span><strong>${summary.imagery_available}/${summary.total} sources</strong></div>
        <div><span class="mini-label">CMR metadata</span><strong>${summary.cmr_available}/${summary.total} sources</strong></div>
        <div><span class="mini-label">Quantitative</span><strong>${summary.quantitative_available}/${summary.total} enabled</strong></div>
        <button class="btn btn-small btn-ghost" id="refresh-satellite" type="button">Refresh status</button>
      </div>
      <div class="alert alert-info">
        <div>
          <strong>What is verified here</strong>
          <p>${esc(payload.access_note)} GIBS previews are rendered imagery, not numeric point values. CMR metadata proves that granules exist; it does not contain the measured value.</p>
        </div>
      </div>
      <div class="sat-grid">${cards.join("")}</div>
      <section class="panel" style="margin-top:16px">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Access limitations</p>
            <h2>Why three cards say “Earthdata Login required”</h2>
          </div>
        </div>
        <div class="method-grid">
          <div class="surface-card method-card">
            <h3>What we do not do</h3>
            <p>We do not ask for your Earthdata password, scrape credentials, or substitute zeros, climatology or another product when a quantitative granule is inaccessible.</p>
          </div>
          <div class="surface-card method-card">
            <h3>How to go further</h3>
            <p>A production deployment can add an Earthdata-authenticated subsetting worker (e.g. OPeNDAP/earthaccess) with explicit consent, encryption and an audit trail. That worker is outside this MVP's verified scope.</p>
            <p class="ref">Earthdata Login: <a href="https://urs.earthdata.nasa.gov/" target="_blank" rel="noopener">urs.earthdata.nasa.gov</a> · CMR API: <a href="https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html" target="_blank" rel="noopener">CMR documentation</a></p>
          </div>
        </div>
      </section>
      <p class="provenance-note">Satellite status retrieved ${esc(fmtDate(payload.checked_at))} from NASA GIBS and NASA CMR. Product names, resolutions and coverage are from the official product documentation listed on each card. NASA does not endorse this application.</p>`;
    $("refresh-satellite").addEventListener("click", () => load(true));
  }

  function renderLoading() {
    $("satellite-app").innerHTML = `
      <div class="surface-card">
        <p class="mini-label">Checking NASA GIBS and CMR</p>
        <h2 style="margin:6px 0 4px">Verifying public data paths…</h2>
        <p class="muted small">Fetching rendered imagery availability and recent granule metadata for the selected coordinate. Quantitative values are not requested.</p>
      </div>`;
  }

  async function load(force = false) {
    if (state.loading) return;
    const { lat, lon } = coords();
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      state.error = "Choose a valid farm coordinate in the Climate tab first.";
      render(null);
      return;
    }
    const key = `${lat},${lon}`;
    if (!force && state.data && state.key === key) {
      render(state.data);
      return;
    }
    state.loading = true;
    state.error = null;
    renderLoading();
    try {
      const response = await fetch(`/api/satellite/status?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`);
      state.data = body;
      state.key = key;
      render(body);
    } catch (error) {
      state.error = String(error);
      render(null);
    } finally {
      state.loading = false;
    }
  }

  window.FieldShiftSatellite = {
    init() { load(false); },
    refresh() { load(true); },
  };
})();
