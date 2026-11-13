/* Phase 4: interactive Egypt-focused farm map (Leaflet, local GeoJSON boundaries). */
(function () {
  "use strict";

  const state = {
    map: null,
    marker: null,
    geojson: null,
    point: null,
    location: null,
    tilesFailed: 0,
    built: false,
    cropFilter: "all",
    selectedCrop: null,
  };

  const $ = (id) => document.getElementById(id);
  const app = () => window.FieldShiftApp;

  function buildShell() {
    $("farm-app").innerHTML = `
      <div class="map-shell">
        <div class="surface-card map-card">
          <div class="map-toolbar">
            <div><strong>Click the map</strong> to place a farm point · scroll to zoom · drag to pan</div>
            <div class="map-tools">
              <button class="btn btn-small btn-ghost" id="map-geolocate" type="button">Use my location</button>
              <button class="btn btn-small btn-ghost" id="map-reset" type="button">Reset to Sohag</button>
            </div>
          </div>
          <div id="farm-map" role="application" aria-label="Interactive farm location map of Egypt"></div>
        </div>
        <aside class="map-side">
          <div class="surface-card">
            <p class="mini-label">Selected farm point</p>
            <p class="location-readout" id="farm-location-name">—</p>
            <p class="coord-readout" id="farm-coords">—</p>
            <div class="tag-row" id="farm-location-tags"></div>
            <p class="small muted" id="farm-location-note">Select a point on the map.</p>
            <button class="btn btn-primary w-full" id="use-map-location" type="button" style="margin-top:10px">Use for NASA climate data</button>
          </div>
          <div class="surface-card">
            <label class="field">
              <span>Jump to a governorate</span>
              <select id="map-governorate"><option value="">Choose…</option></select>
            </label>
            <p class="map-legend" style="margin-top:10px">
              <i style="background:#cfe0d5;border:1px solid #8aa898"></i> Egyptian governorate boundaries (geoBoundaries, ODbL)<br>
              <i style="background:#173f35"></i> selected farm point<br>
              The map accepts coordinates worldwide. Egyptian crop/soil reference rules are applied only inside Egypt.
            </p>
          </div>
          <div class="surface-card" id="farm-reference">
            <p class="mini-label">Local agricultural reference</p>
            <p class="small muted">Loading governorate context…</p>
          </div>
        </aside>
      </div>

      <div class="section-head">
        <div>
          <h2>Farm soil profile</h2>
          <p>User-entered values are kept separate from NASA observations and from the governorate reference dataset.</p>
        </div>
        <span class="tag tag-user">User input</span>
      </div>

      <form class="surface-card" id="farm-form" novalidate>
        <div class="form-grid form-section">
          <label class="field">
            <span>Farm / field name</span>
            <input id="farm-name" type="text" maxlength="120" placeholder="e.g. Sohag pilot field">
            <small>Stored locally; not sent to NASA.</small>
          </label>
          <label class="field">
            <span>Soil texture</span>
            <select id="soil-texture">
              <option value="">Not provided</option>
              <option value="sand">Sand</option>
              <option value="loamy_sand">Loamy sand</option>
              <option value="sandy_loam">Sandy loam</option>
              <option value="loam">Loam</option>
              <option value="silt_loam">Silt loam</option>
              <option value="clay_loam">Clay loam</option>
              <option value="clay">Clay</option>
              <option value="calcareous_sandy_loam">Calcareous sandy loam</option>
              <option value="saline_clay">Saline clay</option>
            </select>
            <small>From a soil test or field texture assessment.</small>
          </label>
        </div>
        <div class="form-grid-3 form-section">
          <label class="field">
            <span>pH</span>
            <input id="soil-ph" type="number" step="0.1" min="3" max="11" placeholder="e.g. 7.8">
          </label>
          <label class="field">
            <span>Organic matter (%)</span>
            <input id="soil-om" type="number" step="0.01" min="0" max="20" placeholder="e.g. 0.8">
          </label>
          <label class="field">
            <span>EC (dS/m)</span>
            <input id="soil-ec" type="number" step="0.01" min="0" max="100" placeholder="e.g. 1.4">
            <small>State the laboratory method where possible (ECe vs EC 1:5).</small>
          </label>
        </div>
        <div class="form-grid form-section">
          <label class="field">
            <span>Drainage</span>
            <select id="soil-drainage">
              <option value="">Not provided</option>
              <option value="well">Well drained</option>
              <option value="moderate">Moderately drained</option>
              <option value="poor">Poorly drained</option>
              <option value="excessive">Excessively drained</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label class="field">
            <span>Irrigation method</span>
            <select id="irrigation-method">
              <option value="">Not provided</option>
              <option value="furrow">Furrow / surface</option>
              <option value="flood">Flood</option>
              <option value="drip">Drip</option>
              <option value="sprinkler">Sprinkler</option>
              <option value="rainfed">Rainfed</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
        </div>
        <div class="form-grid form-section">
          <label class="field">
            <span>Water source</span>
            <select id="water-source">
              <option value="">Not provided</option>
              <option value="nile_canal">Nile canal</option>
              <option value="groundwater">Groundwater</option>
              <option value="mixed">Mixed canal + groundwater</option>
              <option value="rainfall">Rainfall</option>
              <option value="reuse">Reused drainage water</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label class="field">
            <span>Notes</span>
            <input id="farm-notes" type="text" maxlength="1000" placeholder="Optional: recent problems, salinity patches, drainage observations">
          </label>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="interpret-soil" type="submit">Interpret soil</button>
          <button class="btn btn-ghost" id="save-profile" type="button">Save farm profile</button>
          <span class="small muted" id="farm-save-status" role="status"></span>
        </div>
      </form>

      <section class="panel" id="soil-result" aria-live="polite">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Calculated indicators</p>
            <h2>What the entered soil values imply</h2>
          </div>
          <span class="tag tag-calc">Derived from user input</span>
        </div>
        <p class="muted small">Enter texture, pH, organic matter and EC, then run the interpretation. Missing fields stay missing.</p>
      </section>

      <section class="panel" id="crop-library">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Crop characteristics reference</p>
            <h2>Explore the crop trait set used by rotation scoring</h2>
          </div>
          <span class="tag">Reference data</span>
        </div>
        <div class="crop-library-layout">
          <div class="crop-browser">
            <label class="field">
              <span>Search crops</span>
              <input id="crop-search" type="search" placeholder="Try wheat, بصل, legume…" autocomplete="off">
            </label>
            <div class="crop-filter-row" id="crop-cycle-filters" role="group" aria-label="Filter crops by cycle"></div>
            <div class="crop-list" id="crop-list" role="list" aria-label="Crop trait reference set"></div>
            <p class="hint-list" style="margin-top:12px">These are indicative reference ranges from FAO irrigation, salinity and crop-ecology sources. They are not variety-specific and do not predict yield.</p>
          </div>
          <div id="crop-detail"><p class="muted small">Select a crop to view its characteristics.</p></div>
        </div>
      </section>`;

    $("map-governorate").innerHTML =
      '<option value="">Choose…</option>' +
      app().state.governorates.map((g) => `<option value="${g.name}">${g.name}${g.name_ar ? " — " + g.name_ar : ""}</option>`).join("");

    populateCrops();
  }

  function initMap() {
    const { lat, lon } = app().currentCoords();
    state.map = L.map("farm-map", {
      center: [Number.isFinite(lat) ? lat : 26.8, Number.isFinite(lon) ? lon : 31.2],
      zoom: 6,
      minZoom: 3,
      worldCopyJump: true,
    });
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    });
    tiles.on("tileerror", () => {
      state.tilesFailed += 1;
      if (state.tilesFailed === 3) app().toast("Basemap tiles are unavailable; governorate boundaries remain interactive.");
    });
    tiles.addTo(state.map);

    fetch("/static/data/egypt_governorates.geojson")
      .then((r) => r.json())
      .then((geojson) => {
        state.geojson = L.geoJSON(geojson, {
          style: { color: "#5d8576", weight: 1, fillColor: "#dfeae3", fillOpacity: 0.45 },
          onEachFeature: (feature, layer) => {
            const name = (feature.properties.shapeName || "").replace(/ Govern(orat)?e/, "");
            layer.bindTooltip(name, { sticky: true });
            layer.on("mouseover", () => layer.setStyle({ fillOpacity: 0.7, weight: 2 }));
            layer.on("mouseout", () => state.geojson.resetStyle(layer));
            layer.on("click", (event) => {
              setPoint(event.latlng.lat, event.latlng.lng, { fly: false });
            });
          },
        }).addTo(state.map);
      })
      .catch((error) => {
        console.warn("Governorate boundaries failed", error);
        app().toast("Governorate boundaries could not be loaded.");
      });

    state.map.on("click", (event) => setPoint(event.latlng.lat, event.latlng.lng));
    const current = app().currentCoords();
    setPoint(current.lat, current.lon, { skipFly: true });
  }

  function markerFor(lat, lon) {
    if (!state.marker) {
      state.marker = L.marker([lat, lon], { draggable: true }).addTo(state.map);
      state.marker.on("dragend", () => {
        const pos = state.marker.getLatLng();
        setPoint(pos.lat, pos.lng);
      });
    } else {
      state.marker.setLatLng([lat, lon]);
    }
  }

  function setPoint(lat, lon, options = {}) {
    state.point = { lat, lon };
    markerFor(lat, lon);
    $("farm-coords").textContent = `${lat.toFixed(5)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? "E" : "W"}`;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const currentZoom = state.map.getZoom();
      if (!options.skipFly) {
        state.map.flyTo([lat, lon], Math.max(currentZoom, 9), { duration: 0.6 });
      }
    }
    loadLocation(lat, lon);
  }

  async function loadLocation(lat, lon) {
    try {
      const [locRes, refRes] = await Promise.all([
        fetch(`/api/location?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`).then((r) => r.json()),
        fetch(`/api/agri/reference?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`).then((r) => r.json()),
      ]);
      state.location = locRes.location;
      renderLocation(locRes.location, refRes);
      if (locRes.location?.governorate) {
        $("map-governorate").value = locRes.location.governorate.name;
      } else {
        $("map-governorate").value = "";
      }
    } catch (error) {
      $("farm-location-note").textContent = "Location lookup failed. NASA data may still be retrievable by coordinate.";
    }
  }

  function renderLocation(location, reference) {
    const gov = location.governorate;
    $("farm-location-name").textContent = gov ? `${gov.name} Governorate` : (location.in_egypt ? "Egypt (boundary unresolved)" : "Outside Egypt");
    $("farm-location-note").textContent = gov
      ? "Egyptian reference context is available for this governorate."
      : "Egyptian crop/soil reference rules are not applied here. NASA climate retrieval remains possible.";
    $("farm-location-tags").innerHTML = `
      <span class="tag ${location.in_egypt ? "tag-verified" : "tag-limited"}">${location.in_egypt ? "Inside Egypt" : "Outside Egypt"}</span>
      <span class="tag tag-nasa">NASA POWER available</span>
      ${gov && gov.is_pilot ? '<span class="tag tag-verified">Pilot region: Sohag</span>' : ""}
      ${gov ? `<span class="tag">${gov.name_ar || gov.name}</span>` : ""}`;
    renderReference(reference, gov);
  }

  function renderReference(reference, gov) {
    const box = $("farm-reference");
    if (!reference || reference.available === false) {
      box.innerHTML = `
        <p class="mini-label">Local agricultural reference</p>
        <h3 style="margin:4px 0">No Egyptian reference applied</h3>
        <p class="small muted">This point is outside Egypt or did not match a governorate boundary. The application deliberately does not transfer Egyptian crop rules here.</p>`;
      return;
    }
    const crops = reference.dominant_crops.map((c) => `<span class="tag">${c.name}${c.name_ar ? " · " + c.name_ar : ""}</span>`).join("");
    box.innerHTML = `
      <p class="mini-label">Governorate reference · ${esc(reference.confidence)}</p>
      <h3 style="margin:4px 0">${esc(reference.governorate)}</h3>
      <p class="small">${esc(reference.region.label)} · ${esc(reference.region.water_context)}</p>
      <p class="small" style="margin-top:8px"><strong>Regional soil:</strong> ${esc(reference.soil_summary)}</p>
      <p class="small" style="margin-top:6px"><strong>Rotation context:</strong> ${esc(reference.region.rotation_note)}</p>
      <div class="tag-row" style="margin-top:9px">${crops}</div>
      <details class="ref-details"><summary>Sources &amp; caveat</summary>
        <p class="small muted">${esc(reference.disclaimer)}</p>
        <ul class="hint-list">${reference.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></li>`).join("")}</ul>
      </details>
      <p class="source-disclaimer">Reference data — not a soil test and not your farm's measured condition.</p>`;
  }

  function esc(value) {
    return app().escapeHtml(value);
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WATER_LABELS = { 1: "Very low", 2: "Low-medium", 3: "High", 4: "Very high" };

  function monthList(months) {
    return (months || []).map((month) => MONTHS[month - 1] || month).join(", ");
  }

  function cropMatches(crop, query, filter) {
    if (filter !== "all" && crop.cycle !== filter) return false;
    if (!query) return true;
    const haystack = [crop.name, crop.name_ar, crop.family, crop.role, crop.cycle]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  }

  function populateCrops() {
    const crops = app().state.crops || [];
    if (!crops.length) return;
    state.selectedCrop = state.selectedCrop || "wheat";
    const filters = [
      ["all", "All"],
      ["winter", "Winter"],
      ["summer", "Summer"],
      ["perennial", "Perennial"],
    ];
    const filterBox = $("crop-cycle-filters");
    filterBox.innerHTML = filters.map(([id, label]) => {
      const count = id === "all" ? crops.length : crops.filter((crop) => crop.cycle === id).length;
      return `<button class="crop-filter ${state.cropFilter === id ? "is-active" : ""}" type="button" data-crop-filter="${id}" aria-pressed="${state.cropFilter === id}">${label} <span>${count}</span></button>`;
    }).join("");
    filterBox.querySelectorAll("[data-crop-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.cropFilter = button.dataset.cropFilter;
        populateCrops();
      });
    });
    const search = $("crop-search");
    if (search && !search.dataset.bound) {
      search.addEventListener("input", renderCropList);
      search.dataset.bound = "1";
    }
    renderCropList();
    renderCrop(state.selectedCrop);
  }

  function renderCropList() {
    const list = $("crop-list");
    if (!list) return;
    const query = ($("crop-search")?.value || "").trim().toLowerCase();
    const crops = (app().state.crops || []).filter((crop) => cropMatches(crop, query, state.cropFilter));
    if (!crops.length) {
      list.innerHTML = `<p class="small muted" style="padding:10px 4px">No crop matches “${app().escapeHtml(query || state.cropFilter)}”. Clear the search or choose another cycle.</p>`;
      return;
    }
    list.innerHTML = crops.map((crop) => {
      const selected = crop.id === state.selectedCrop;
      return `
        <button class="crop-list-item${selected ? " is-selected" : ""}" type="button" role="listitem"
          data-crop-id="${app().escapeHtml(crop.id)}" aria-pressed="${selected}">
          <span class="crop-list-name">${app().escapeHtml(crop.name)}${crop.name_ar ? ` <small>${app().escapeHtml(crop.name_ar)}</small>` : ""}</span>
          <span class="crop-list-meta">${app().escapeHtml(crop.cycle)} · water ${app().escapeHtml(WATER_LABELS[crop.water_demand_level] || crop.water_demand || "—")}</span>
          <span class="crop-list-bars" aria-hidden="true">
            <i style="width:${(crop.heat_tolerance / 5) * 100}%" title="Heat tolerance ${crop.heat_tolerance}/5"></i>
            <i style="width:${(crop.drought_tolerance / 5) * 100}%" title="Drought tolerance ${crop.drought_tolerance}/5"></i>
          </span>
        </button>`;
    }).join("");
    list.querySelectorAll("[data-crop-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedCrop = button.dataset.cropId;
        renderCrop(state.selectedCrop);
        renderCropList();
      });
    });
  }

  function traitBar(label, value, max, note) {
    const width = Math.max(0, Math.min(100, (value / max) * 100));
    return `
      <div class="crop-trait">
        <div class="crop-trait-head"><span>${app().escapeHtml(label)}</span><strong>${app().escapeHtml(note)}</strong></div>
        <div class="crop-trait-bar"><i style="width:${width}%"></i></div>
      </div>`;
  }

  function renderCropCalendar(crop) {
    const current = new Date().getMonth() + 1;
    const planting = new Set(crop.planting_months || []);
    const harvest = new Set(crop.harvest_months || []);
    const cells = MONTHS.map((label, index) => {
      const month = index + 1;
      const plant = planting.has(month);
      const harvestMonth = harvest.has(month);
      const cls = plant && harvestMonth ? "is-both" : plant ? "is-planting" : harvestMonth ? "is-harvest" : "";
      const title = [
        plant ? "planting" : null,
        harvestMonth ? "harvest" : null,
      ].filter(Boolean).join(" + ") || "not in the reference window";
      return `<div class="cal-month ${cls}${month === current ? " is-current" : ""}" title="${app().escapeHtml(`${label}: ${title}`)}"><span>${label}</span><i></i></div>`;
    }).join("");
    return `
      <div class="crop-calendar" aria-label="Reference planting and harvest months">
        <div class="crop-calendar-head">
          <span class="mini-label">Reference crop calendar</span>
          <span class="cal-legend"><i class="cal-plant"></i>Planting <i class="cal-harvest"></i>Harvest <i class="cal-current"></i>Current month</span>
        </div>
        <div class="cal-grid">${cells}</div>
        <p class="source-disclaimer">Month windows are broad reference ranges from FAO crop-calendar material. Actual sowing and harvest dates vary by variety, governorate and season.</p>
      </div>`;
  }

  function renderCrop(cropId) {
    const crop = (app().state.crops || []).find((c) => c.id === cropId);
    if (!crop) return;
    state.selectedCrop = crop.id;
    const detail = $("crop-detail");
    const waterLabel = WATER_LABELS[crop.water_demand_level] || crop.water_demand || "—";
    detail.innerHTML = `
      <div class="crop-detail-head">
        <div>
          <p class="mini-label">${app().escapeHtml(crop.family)} · ${app().escapeHtml(crop.cycle)}</p>
          <h3 class="crop-detail-title">${app().escapeHtml(crop.name)}${crop.name_ar ? ` <span>${app().escapeHtml(crop.name_ar)}</span>` : ""}</h3>
        </div>
        <span class="tag">${app().escapeHtml(crop.role || "crop")}</span>
      </div>
      <div class="crop-trait-grid">
        ${traitBar("Water demand", crop.water_demand_level, 4, `${waterLabel} (${crop.water_demand_level}/4)`)}
        ${traitBar("Heat tolerance", crop.heat_tolerance, 5, `${crop.heat_tolerance}/5`)}
        ${traitBar("Drought tolerance", crop.drought_tolerance, 5, `${crop.drought_tolerance}/5`)}
        ${traitBar("Salinity tolerance", crop.salinity_tolerance_ece_ds_m, 10, `${crop.salinity_tolerance_ece_ds_m} dS/m ECe`)}
      </div>
      <div class="crop-detail-grid">
        <div><span class="mini-label">Family</span><strong>${app().escapeHtml(crop.family)}</strong></div>
        <div><span class="mini-label">Cycle</span><strong>${app().escapeHtml(crop.cycle)}</strong></div>
        <div><span class="mini-label">N fixation</span><strong>${crop.n_fixation ? "Yes" : "No"}</strong></div>
        <div><span class="mini-label">Soil cover</span><strong>${app().escapeHtml(crop.soil_cover)}</strong></div>
        <div><span class="mini-label">Residue</span><strong>${app().escapeHtml(crop.residue)}</strong></div>
        <div><span class="mini-label">Root depth</span><strong>${crop.root_depth_m} m</strong></div>
        <div><span class="mini-label">Kc mid-season</span><strong>${crop.kc_mid}</strong></div>
        <div><span class="mini-label">Planting</span><strong>${app().escapeHtml(monthList(crop.planting_months))}</strong></div>
        <div><span class="mini-label">Harvest</span><strong>${app().escapeHtml(monthList(crop.harvest_months))}</strong></div>
      </div>
      ${renderCropCalendar(crop)}
      <p class="small" style="margin-top:10px">${app().escapeHtml(crop.notes)}</p>
      <p class="small muted" style="margin-top:6px">Confidence: ${app().escapeHtml(crop.confidence)}. Salinity class: ${app().escapeHtml(crop.salinity_class)}. Values are indicative and vary by variety, soil and management.</p>`;
  }

  function readForm() {
    return {
      name: $("farm-name").value,
      latitude: state.point?.lat,
      longitude: state.point?.lon,
      soil_texture: $("soil-texture").value || null,
      ph: $("soil-ph").value === "" ? null : Number($("soil-ph").value),
      organic_matter_pct: $("soil-om").value === "" ? null : Number($("soil-om").value),
      ec_ds_m: $("soil-ec").value === "" ? null : Number($("soil-ec").value),
      drainage: $("soil-drainage").value || null,
      irrigation_method: $("irrigation-method").value || null,
      water_source: $("water-source").value || null,
      notes: $("farm-notes").value,
    };
  }

  async function interpret(showErrors = true) {
    const payload = readForm();
    try {
      const response = await fetch("/api/soil/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texture: payload.soil_texture,
          ph: payload.ph,
          organic_matter_pct: payload.organic_matter_pct,
          ec_ds_m: payload.ec_ds_m,
          drainage: payload.drainage,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Interpretation failed");
      renderSoil(body);
    } catch (error) {
      if (showErrors) app().toast(`Soil interpretation failed: ${error.message}`);
    }
  }

  function renderSoil(result) {
    const box = $("soil-result");
    const flags = result.summary.flags || [];
    const cards = result.interpretations.map((item) => `
      <div class="soil-factor">
        <div class="soil-factor-head">
          <div><p class="mini-label">${esc(item.factor)}</p><h3>${esc(item.class)}</h3></div>
          ${item.flag ? `<span class="pill ${item.flag === "high" ? "pill-missing" : "pill-warn"}">${esc(item.flag)} flag</span>` : ""}
        </div>
        <p class="small">${esc(item.meaning)}</p>
        <p class="soil-value">${item.value === null || item.value === undefined ? "Not provided" : `${item.value}${item.unit ? " " + esc(item.unit) : ""}`}</p>
        <details><summary>Method &amp; source</summary><p class="small muted">${esc(item.method)}${item.source ? ` <a href="${esc(item.source.url)}" target="_blank" rel="noopener">${esc(item.source.name)}</a>` : ""}</p></details>
      </div>`).join("");
    box.innerHTML = `
      <div class="panel-head">
        <div>
          <p class="eyebrow">Calculated indicators</p>
          <h2>What the entered soil values imply</h2>
        </div>
        <span class="tag tag-calc">Derived from user input</span>
      </div>
      <div class="soil-summary">
        <div><span class="mini-label">Inputs provided</span><strong>${result.summary.provided_fields}/${result.summary.total_fields}</strong></div>
        <div><span class="mini-label">Confidence</span><strong>${esc(result.summary.confidence)}</strong></div>
        <div><span class="mini-label">Flags</span><strong>${flags.length ? flags.join(", ") : "none"}</strong></div>
      </div>
      <div class="soil-grid">${cards}</div>
      <div class="warning-list"><strong>Caveats</strong><ul>${result.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>
      <p class="provenance-note">These are rule-based educational indicators. They do not prescribe fertilizer, amendment or irrigation rates. Absent inputs are not imputed.</p>`;
  }

  async function saveProfile() {
    const payload = readForm();
    const status = $("farm-save-status");
    if (!state.point) {
      app().toast("Select a farm point on the map first.");
      return;
    }
    status.textContent = "Saving…";
    try {
      const response = await fetch("/api/farm/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Save failed");
      status.textContent = `Saved locally · profile #${body.profile.id} · ${new Date(body.profile.created_at).toLocaleString("en-GB")}`;
      app().toast("Farm profile saved to local SQLite.");
      interpret(false);
    } catch (error) {
      status.textContent = "";
      app().toast(`Could not save profile: ${error.message}`);
    }
  }

  async function loadSavedProfile() {
    try {
      const response = await fetch("/api/farm/profile/latest");
      const body = await response.json();
      const profile = body.profile;
      if (!profile) return;
      $("farm-name").value = profile.name || "";
      if (profile.soil_texture) $("soil-texture").value = profile.soil_texture;
      if (profile.ph !== null) $("soil-ph").value = profile.ph;
      if (profile.organic_matter_pct !== null) $("soil-om").value = profile.organic_matter_pct;
      if (profile.ec_ds_m !== null) $("soil-ec").value = profile.ec_ds_m;
      if (profile.drainage) $("soil-drainage").value = profile.drainage;
      if (profile.irrigation_method) $("irrigation-method").value = profile.irrigation_method;
      if (profile.water_source) $("water-source").value = profile.water_source;
      if (profile.notes) $("farm-notes").value = profile.notes;
      if (Number.isFinite(profile.latitude) && Number.isFinite(profile.longitude)) {
        // Keep the marker aligned with the soil values that were just loaded.
        setPoint(profile.latitude, profile.longitude, { fly: true });
      }
      $("farm-save-status").textContent = `Loaded saved profile #${profile.id} (${new Date(profile.created_at).toLocaleDateString("en-GB")}).`;
    } catch (error) {
      console.warn("Could not load saved profile", error);
    }
  }

  function bind() {
    $("farm-form").addEventListener("submit", (event) => {
      event.preventDefault();
      interpret(true);
    });
    $("save-profile").addEventListener("click", saveProfile);

    $("map-governorate").addEventListener("change", (event) => {
      const gov = app().state.governorates.find((g) => g.name === event.target.value);
      if (!gov) return;
      setPoint(gov.latitude, gov.longitude, { fly: true });
    });
    $("map-reset").addEventListener("click", () => {
      const loc = app().state.meta.default_location;
      setPoint(loc.latitude, loc.longitude, { fly: true });
    });
    $("map-geolocate").addEventListener("click", () => {
      if (!navigator.geolocation) {
        app().toast("Geolocation is not available in this browser.");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => setPoint(position.coords.latitude, position.coords.longitude),
        () => app().toast("Could not access your location. Click the map instead.")
      );
    });
    $("use-map-location").addEventListener("click", () => {
      if (!state.point) return;
      $("latitude").value = state.point.lat;
      $("longitude").value = state.point.lon;
      app().setPeriodInputs($("period-preset").value === "custom" ? 90 : $("period-preset").value);
      app().updateLocationContext();
      app().switchTab("climate");
      app().loadClimate(true);
    });

    const auto = debounce(() => interpret(false), 600);
    ["soil-texture", "soil-ph", "soil-om", "soil-ec", "soil-drainage"].forEach((id) => {
      $(id).addEventListener("change", auto);
    });
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function init() {
    if (!state.built) {
      buildShell();
      bind();
      initMap();
      loadSavedProfile();
      state.built = true;
    } else if (state.map) {
      state.map.invalidateSize();
      // Follow a location changed in the Climate tab instead of showing a stale point.
      const current = app().currentCoords();
      if (
        Number.isFinite(current.lat) &&
        Number.isFinite(current.lon) &&
        (!state.point ||
          Math.abs(state.point.lat - current.lat) > 1e-6 ||
          Math.abs(state.point.lon - current.lon) > 1e-6)
      ) {
        setPoint(current.lat, current.lon, { fly: true });
      }
    }
  }

  window.FieldShiftFarm = { init };
})();
