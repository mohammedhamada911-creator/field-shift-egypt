/* Field Shift Egypt — simple, English-first farmer journey. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const t = (key, vars) => window.FieldShiftI18n.t(key, vars);
  const isArabic = () => window.FieldShiftI18n.isArabic();
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));

  const STORAGE_KEY = "fieldshift.journey";
  const PRIORITIES = ["water", "salinity", "soil", "climate", "diversity"];
  const SIGNAL_PARAMETER = {
    heat_stress: "T2M_MAX",
    dry_spell: "PRECTOTCORR",
    heavy_rain: "PRECTOTCORR",
    wind: "WS2M",
    low_humidity: "RH2M",
  };
  const SOIL_FACTOR_KEYS = {
    "pH": "soil.factor.pH",
    "Organic matter": "soil.factor.Organic matter",
    "Salinity (EC)": "soil.factor.Salinity",
    "Texture and water retention": "soil.factor.Texture",
    "Drainage": "soil.factor.Drainage",
  };
  const PRIORITY_ICONS = {
    water: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c3.4 4.2 6 7.4 6 10.2A6 6 0 0 1 6 13.2C6 10.4 8.6 7.2 12 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.4 13.6a2.7 2.7 0 0 0 2.6 2.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    salinity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3.8 7.2v9.6L12 21l8.2-4.2V7.2L12 3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 10.5h8M8 13.5h8M12 10.5v6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    soil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 13c-4.5 0-7-2.4-7-6 4.5 0 7 2.4 7 6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 16c4.5 0 7-2.4 7-6-4.5 0-7 2.4-7 6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    climate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    diversity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h5l3 5 3-5h5M4 17h5l3-5 3 5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4" cy="7" r="1.5" fill="currentColor"/><circle cx="20" cy="7" r="1.5" fill="currentColor"/><circle cx="4" cy="17" r="1.5" fill="currentColor"/><circle cx="20" cy="17" r="1.5" fill="currentColor"/></svg>',
  };

  const state = {
    booted: false,
    governorates: [],
    map: null,
    marker: null,
    geojson: null,
    point: null,
    location: null,
    step: 1,
    priorities: new Set(),
    land: {},
    village: "",
    results: null,
    loading: false,
    requestId: 0,
    locationRequestId: 0,
    slowTimer: null,
  };

  // ------------------------------------------------------------------
  // Formatting helpers
  // ------------------------------------------------------------------
  function num(value, digits = 0) {
    if (value === null || value === undefined || value === "") return "—";
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return "—";
    return window.FieldShiftI18n.number(parsed, digits);
  }

  function inputNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function localizedGovernorate(gov) {
    if (!gov) return "";
    return isArabic() && gov.name_ar ? gov.name_ar : gov.name;
  }

  function localizedCrop(crop) {
    if (!crop) return "";
    return isArabic() && crop.name_ar ? crop.name_ar : crop.name;
  }

  function fitLevel(score) {
    if (score === null || score === undefined) return "unknown";
    if (score >= 70) return "good";
    if (score >= 45) return "medium";
    return "weak";
  }

  function levelLabel(level) {
    return t(`common.${level}`);
  }

  function severityLabel(severity) {
    if (severity === "high") return t("common.high");
    if (severity === "watch") return t("common.watch");
    if (severity === "low") return t("common.low");
    return t("common.noData");
  }

  function coordsText(point) {
    if (!point) return "—";
    const lat = Number(point.lat);
    const lon = Number(point.lon);
    return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
  }

  // ------------------------------------------------------------------
  // Local persistence
  // ------------------------------------------------------------------
  function loadSaved() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        point: state.point,
        village: state.village,
        land: state.land,
        priorities: [...state.priorities],
      }));
    } catch (_error) {
      /* persistence is optional */
    }
  }

  function restore(saved) {
    if (!saved) return;
    state.village = String(saved.village || "");
    state.land = saved.land && typeof saved.land === "object" ? { ...saved.land } : {};
    state.priorities = new Set(
      Array.isArray(saved.priorities) ? saved.priorities.filter((id) => PRIORITIES.includes(id)) : []
    );
    if (saved.point && Number.isFinite(Number(saved.point.lat)) && Number.isFinite(Number(saved.point.lon))) {
      state.point = { lat: Number(saved.point.lat), lon: Number(saved.point.lon) };
    }
    applyLandToForm();
  }

  // ------------------------------------------------------------------
  // Form reads / writes
  // ------------------------------------------------------------------
  function applyLandToForm() {
    const land = state.land || {};
    if ($("land-texture")) $("land-texture").value = land.texture || "";
    if ($("land-irrigation")) $("land-irrigation").value = land.irrigation_method || "";
    if ($("land-water-source")) $("land-water-source").value = land.water_source || "";
    if ($("land-water-availability")) $("land-water-availability").value = land.water_availability || "";
    if ($("land-ph")) $("land-ph").value = land.ph ?? "";
    if ($("land-om")) $("land-om").value = land.organic_matter_pct ?? "";
    if ($("land-drainage")) $("land-drainage").value = land.drainage || "";
    if ($("land-ec")) $("land-ec").value = land.ec_ds_m ?? "";
    if ($("journey-village")) $("journey-village").value = state.village || "";

    const hasEc = land.ec_ds_m !== null && land.ec_ds_m !== undefined && land.ec_ds_m !== "";
    const yesRadio = document.querySelector('input[name="salinity-known"][value="yes"]');
    const noRadio = document.querySelector('input[name="salinity-known"][value="no"]');
    if (yesRadio && noRadio) {
      yesRadio.checked = hasEc;
      noRadio.checked = !hasEc;
    }
    if ($("salinity-input-wrap")) $("salinity-input-wrap").hidden = !hasEc;
  }

  function readLand() {
    const salinityKnown = document.querySelector('input[name="salinity-known"]:checked')?.value === "yes";
    const land = {
      texture: $("land-texture")?.value || "",
      irrigation_method: $("land-irrigation")?.value || "",
      water_source: $("land-water-source")?.value || "",
      water_availability: $("land-water-availability")?.value || "",
      ph: inputNumber($("land-ph")?.value),
      organic_matter_pct: inputNumber($("land-om")?.value),
      drainage: $("land-drainage")?.value || "",
      ec_ds_m: salinityKnown ? inputNumber($("land-ec")?.value) : null,
    };
    return land;
  }

  // ------------------------------------------------------------------
  // Bootstrap
  // ------------------------------------------------------------------
  function boot() {
    if (state.booted) return;
    state.booted = true;
    const saved = loadSaved();
    restore(saved);
    bindStaticControls();
    renderPriorityOptions();
    populateGovernorateSelect();
    initMap();
    updateStepLabels();
    showStep(1, { scroll: false });
    if (state.point) {
      setPoint(state.point.lat, state.point.lon, { scroll: false, persist: false });
    }
  }

  function populateGovernorateSelect() {
    const select = $("journey-governorate");
    if (!select) return;
    const current = select.value;
    const options = [`<option value="">${esc(t("step1.governoratePlaceholder"))}</option>`];
    state.governorates.forEach((gov) => {
      const label = isArabic() && gov.name_ar ? gov.name_ar : gov.name;
      options.push(`<option value="${esc(gov.name)}">${esc(label)}</option>`);
    });
    select.innerHTML = options.join("");
    if (current) select.value = current;
  }

  function bindStaticControls() {
    $("start-journey")?.addEventListener("click", () => {
      showStep(1);
      $("step-1")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("journey-to-step2")?.addEventListener("click", () => {
      if (!state.point) {
        showLocationNote(t("step1.noPoint"), "info");
        $("journey-map")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      showStep(2);
    });
    $("step2-back")?.addEventListener("click", () => showStep(1));
    $("land-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.land = readLand();
      persist();
      showStep(3);
    });
    $("step3-back")?.addEventListener("click", () => showStep(2));
    $("step3-next")?.addEventListener("click", () => runResults());
    $("results-retry")?.addEventListener("click", () => runResults());

    $("journey-governorate")?.addEventListener("change", (event) => {
      const gov = state.governorates.find((item) => item.name === event.target.value);
      if (!gov) return;
      setPoint(gov.latitude, gov.longitude, { source: "governorate", governorate: gov });
    });
    $("journey-village")?.addEventListener("input", (event) => {
      state.village = String(event.target.value || "").slice(0, 80);
      updateLocationLabels();
      persist();
    });
    $("journey-geolocate")?.addEventListener("click", () => {
      if (!navigator.geolocation) {
        showLocationNote(t("step1.geoUnavailable"), "error");
        return;
      }
      showLocationNote(t("common.loading"), "info");
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setPoint(position.coords.latitude, position.coords.longitude, { source: "geolocate" });
        },
        () => showLocationNote(t("step1.geoError"), "error"),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
      );
    });
    $("journey-reset")?.addEventListener("click", () => {
      const sohag = state.governorates.find((gov) => gov.name === "Sohag");
      setPoint(sohag ? sohag.latitude : 26.5591, sohag ? sohag.longitude : 31.6991, { source: "governorate", governorate: sohag });
    });
    $("journey-apply-coords")?.addEventListener("click", () => {
      const lat = Number($("journey-lat")?.value);
      const lon = Number($("journey-lon")?.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        showLocationNote(t("step1.invalidCoords"), "error");
        return;
      }
      setPoint(lat, lon, { source: "coords" });
    });

    document.querySelectorAll('input[name="salinity-known"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const known = document.querySelector('input[name="salinity-known"]:checked')?.value === "yes";
        $("salinity-input-wrap").hidden = !known;
        if (!known) $("land-ec").value = "";
        state.land = readLand();
        persist();
      });
    });

    ["land-texture", "land-irrigation", "land-water-source", "land-water-availability",
      "land-ph", "land-om", "land-drainage", "land-ec"]
      .forEach((id) => {
        $(id)?.addEventListener("change", () => {
          state.land = readLand();
          persist();
        });
      });

    document.addEventListener("fieldshift:languagechange", () => {
      updateStepLabels();
      renderPriorityOptions();
      populateGovernorateSelect();
      updateLocationLabels();
        if (state.results) renderResults(state.results);
      if (state.geojson) bindGeoJsonTooltips();
    });
  }

  // ------------------------------------------------------------------
  // Map
  // ------------------------------------------------------------------
  function initMap() {
    if (state.map || !$("journey-map") || !window.L) return;
    state.map = L.map("journey-map", {
      center: [26.8, 30.8],
      zoom: 6,
      minZoom: 4,
      maxZoom: 16,
      scrollWheelZoom: false,
      zoomControl: true,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(state.map);
    state.map.on("click", (event) => {
      setPoint(event.latlng.lat, event.latlng.lng, { source: "map" });
    });
    fetch("/static/data/egypt_governorates.geojson")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((geojson) => {
        state.geojson = L.geoJSON(geojson, {
          style: {
            color: "#5f8577",
            weight: 1,
            fillColor: "#8fc6b4",
            fillOpacity: 0.09,
          },
          onEachFeature: (feature, layer) => {
            layer.on({
              mouseover: () => layer.setStyle({ fillOpacity: 0.22, weight: 2 }),
              mouseout: () => state.geojson?.resetStyle(layer),
              click: (event) => {
                L.DomEvent.stopPropagation(event);
                const gov = governorateFromFeature(feature);
                if (gov) setPoint(gov.latitude, gov.longitude, { source: "governorate", governorate: gov });
              },
            });
          },
        }).addTo(state.map);
        bindGeoJsonTooltips();
      })
      .catch(() => {
        showLocationNote(t("step1.boundaryUnavailable"), "info");
      });
  }

  function governorateFromFeature(feature) {
    const name = String(feature?.properties?.shapeName || "").replace(/\s+Governorate$/i, "").trim();
    return state.governorates.find((gov) => gov.name.toLowerCase() === name.toLowerCase());
  }

  function bindGeoJsonTooltips() {
    if (!state.geojson) return;
    state.geojson.eachLayer((layer) => {
      const gov = governorateFromFeature(layer.feature);
      if (!gov) return;
      const label = localizedGovernorate(gov);
      if (layer.getTooltip()) layer.unbindTooltip();
      layer.bindTooltip(label, { sticky: true });
    });
  }

  function ensureMarker(point) {
    if (!state.map) return;
    if (!state.marker) {
      state.marker = L.marker([point.lat, point.lon], { draggable: true }).addTo(state.map);
      state.marker.on("dragend", () => {
        const latlng = state.marker.getLatLng();
        setPoint(latlng.lat, latlng.lng, { source: "map" });
      });
    } else {
      state.marker.setLatLng([point.lat, point.lon]);
    }
  }

  function setPoint(lat, lon, options = {}) {
    lat = Number(lat);
    lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      showLocationNote(t("step1.invalidCoords"), "error");
      return;
    }
    state.point = { lat, lon };
    if (options.governorate) {
      state.location = { governorate: options.governorate, in_egypt: true, latitude: lat, longitude: lon };
      $("journey-governorate").value = options.governorate.name;
    }
    ensureMarker(state.point);
    if (state.map && options.scroll !== false) {
      state.map.panTo([lat, lon]);
    }
    if ($("journey-lat")) $("journey-lat").value = lat.toFixed(4);
    if ($("journey-lon")) $("journey-lon").value = lon.toFixed(4);
    if ($("journey-location-coords")) $("journey-location-coords").textContent = coordsText(state.point);
    updateLocationLabels();
    if (options.persist !== false) persist();
    if (options.source !== "governorate" || !options.governorate) {
      resolveLocation(lat, lon);
    } else {
      showLocationNote(t("step1.locationReady"), "success");
      updateLocationLabels();
    }
  }

  async function resolveLocation(lat, lon) {
    const requestId = ++state.locationRequestId;
    showLocationNote(t("common.loading"), "info");
    try {
      const response = await fetch(`/api/location?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
      const body = await response.json();
      if (requestId !== state.locationRequestId) return;
      if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`);
      state.location = body.location;
      if (body.location.governorate) {
        $("journey-governorate").value = body.location.governorate.name;
        showLocationNote(t("step1.locationReady"), "success");
      } else if (body.location.in_egypt) {
        showLocationNote(t("step1.boundaryUnresolved"), "warning");
      } else {
        showLocationNote(t("step1.outsideEgypt"), "warning");
      }
      updateLocationLabels();
      persist();
    } catch (_error) {
      if (requestId !== state.locationRequestId) return;
      state.location = null;
      showLocationNote(t("step1.locationError"), "warning");
      updateLocationLabels();
    }
  }

  function updateLocationLabels() {
    const nameEl = $("journey-location-name");
    if (!nameEl) return;
    const gov = state.location?.governorate;
    const govLabel = gov ? localizedGovernorate(gov) : "";
    if (state.village && govLabel) nameEl.textContent = `${state.village} — ${govLabel}`;
    else if (state.village) nameEl.textContent = state.village;
    else if (govLabel) nameEl.textContent = govLabel;
    else if (state.point) nameEl.textContent = coordsText(state.point);
    else nameEl.textContent = "—";
    if ($("journey-location-coords")) {
      $("journey-location-coords").textContent = state.point ? coordsText(state.point) : "—";
    }
  }

  function showLocationNote(message, tone) {
    const note = $("journey-location-note");
    if (!note) return;
    note.textContent = message;
    note.className = "small location-note";
    if (tone) note.classList.add(`location-note-${tone}`);
  }


  // ------------------------------------------------------------------
  // Steps
  // ------------------------------------------------------------------
  function showStep(step, options = {}) {
    state.step = step;
    document.querySelectorAll(".journey-step").forEach((section) => {
      const active = Number(section.dataset.step) === step;
      section.hidden = !active;
      section.classList.toggle("is-active", active);
    });
    if ($("journey-hero")) $("journey-hero").hidden = step !== 1;
    document.querySelectorAll("[data-progress-step]").forEach((item) => {
      const value = Number(item.dataset.progressStep);
      item.classList.toggle("is-active", value === step);
      item.classList.toggle("is-complete", value < step);
      if (value === step) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    updateStepLabels();
    if (options.scroll !== false) {
      const target = step === 1 ? $("step-1") : $("journey-progress");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (step === 1 && state.map) {
      setTimeout(() => state.map.invalidateSize(), 60);
    }
  }

  function updateStepLabels() {
    document.querySelectorAll("[data-step-text]").forEach((element) => {
      element.textContent = t("journey.step", {
        current: num(Number(element.dataset.stepText), 0),
        total: num(4, 0),
      });
    });
  }

  // ------------------------------------------------------------------
  // Priorities
  // ------------------------------------------------------------------
  function renderPriorityOptions() {
    const box = $("priority-options");
    if (!box) return;
    box.innerHTML = PRIORITIES.map((id) => {
      const selected = state.priorities.has(id);
      return `<button class="priority-card${selected ? " is-selected" : ""}" type="button"
        data-priority="${id}" aria-pressed="${selected}">
        <span class="priority-icon">${PRIORITY_ICONS[id]}</span>
        <span class="priority-copy">
          <strong>${esc(t(`priority.${id}.title`))}</strong>
          <small>${esc(t(`priority.${id}.desc`))}</small>
        </span>
        <span class="priority-check" aria-hidden="true">✓</span>
      </button>`;
    }).join("");
    box.querySelectorAll("[data-priority]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.priority;
        if (state.priorities.has(id)) state.priorities.delete(id);
        else state.priorities.add(id);
        persist();
        renderPriorityOptions();
      });
    });
  }

  function computeWeights() {
    if (!state.priorities.size) {
      return PRIORITIES.reduce((weights, id) => {
        weights[id] = 20;
        return weights;
      }, {});
    }
    return PRIORITIES.reduce((weights, id) => {
      weights[id] = state.priorities.has(id) ? 30 : 5;
      return weights;
    }, {});
  }


  // ------------------------------------------------------------------
  // Results pipeline
  // ------------------------------------------------------------------
  async function runResults() {
    if (!state.point) {
      showStep(1);
      showLocationNote(t("step1.noPoint"), "warning");
      return;
    }
    state.land = readLand();
    persist();
    const requestId = ++state.requestId;
    state.loading = true;
    state.results = null;
    showStep(4);
    $("results-root").hidden = true;
    $("results-root").innerHTML = "";
    $("results-error").hidden = true;
    $("results-loading").hidden = false;
    $("results-loading-text").textContent = t("results.loading");
    clearTimeout(state.slowTimer);
    state.slowTimer = setTimeout(() => {
      if (state.loading) $("results-loading-text").textContent = t("results.loadingSlow");
    }, 7000);

    const lat = state.point.lat;
    const lon = state.point.lon;
    const soil = soilInputs();
    const payload = {
      power: null,
      powerError: null,
      soil: null,
      soilError: null,
      rotation: null,
      rotationError: null,
    };

    try {
      const [powerOutcome, soilOutcome] = await Promise.all([
        fetchPower(lat, lon),
        fetchSoil(soil),
      ]);
      if (requestId !== state.requestId) return;
      payload.power = powerOutcome.data;
      payload.powerError = powerOutcome.error;
      payload.soil = soilOutcome.data;
      payload.soilError = soilOutcome.error;

      saveFarmProfile(lat, lon);

      const rotationOutcome = await fetchRotations(lat, lon, soil);
      if (requestId !== state.requestId) return;
      payload.rotation = rotationOutcome.data;
      payload.rotationError = rotationOutcome.error;

      if (!payload.power && !payload.rotation) {
        throw new Error(payload.powerError || payload.rotationError || "No data");
      }
      state.results = payload;
      renderResults(payload);
    } catch (error) {
      if (requestId !== state.requestId) return;
      $("results-loading").hidden = true;
      $("results-error").hidden = false;
      $("results-error-body").textContent = t("results.errorBody");
      console.error(error);
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        clearTimeout(state.slowTimer);
      }
    }
  }

  async function fetchPower(lat, lon) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75000);
    try {
      const response = await fetch(
        `/api/power?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&days=90&compact=1`,
        { signal: controller.signal }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`);
      return { data: body, error: null };
    } catch (error) {
      return { data: null, error: error.name === "AbortError" ? "timeout" : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  function soilInputs() {
    const land = state.land || {};
    const soil = {};
    if (land.texture) soil.texture = land.texture;
    if (land.ph !== null && land.ph !== undefined) soil.ph = land.ph;
    if (land.organic_matter_pct !== null && land.organic_matter_pct !== undefined) soil.organic_matter_pct = land.organic_matter_pct;
    if (land.ec_ds_m !== null && land.ec_ds_m !== undefined) soil.ec_ds_m = land.ec_ds_m;
    if (land.drainage) soil.drainage = land.drainage;
    return soil;
  }

  async function fetchSoil(soil) {
    if (!Object.keys(soil).length) return { data: null, error: null };
    try {
      const response = await fetch("/api/soil/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(soil),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`);
      return { data: body, error: null };
    } catch (error) {
      return { data: null, error: String(error) };
    }
  }

  async function fetchRotations(lat, lon, soil) {
    const body = {
      lat,
      lon,
      days: 90,
      soil: {
        ...soil,
        irrigation_method: state.land.irrigation_method || undefined,
        water_source: state.land.water_source || undefined,
      },
      weights: computeWeights(),
    };
    try {
      const response = await fetch("/api/rotations/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
      return { data: payload, error: null };
    } catch (error) {
      return { data: null, error: String(error) };
    }
  }

  function saveFarmProfile(lat, lon) {
    const land = state.land;
    const gov = state.location?.governorate;
    const name = state.village || (gov ? localizedGovernorate(gov) : "") || "Farm";
    fetch("/api/farm/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        latitude: lat,
        longitude: lon,
        soil_texture: land.texture || null,
        ph: land.ph,
        organic_matter_pct: land.organic_matter_pct,
        ec_ds_m: land.ec_ds_m,
        drainage: land.drainage || null,
        irrigation_method: land.irrigation_method || null,
        water_source: land.water_source || null,
      }),
    }).catch(() => {
      /* the summary remains usable even if the profile cannot be stored */
    });
  }

  // ------------------------------------------------------------------
  // Results rendering
  // ------------------------------------------------------------------
  function renderResults(payload) {
    const root = $("results-root");
    if (!root) return;
    $("results-loading").hidden = true;
    $("results-error").hidden = true;
    root.hidden = false;
    const missing = missingInformation(payload);
    root.innerHTML = `
      <div class="result-stack">
        ${resultCard("1", t("results.answer.land"), renderLandSummary(payload, missing), "land")}
        ${resultCard("2", t("results.answer.weather"), renderWeatherSummary(payload), "weather")}
        ${resultCard("3", t("results.answer.rotation"), renderRotationSummary(payload), "rotation")}
        ${resultCard("4", t("results.answer.action"), renderActions(payload, missing), "action")}
      </div>
      <div class="result-footer-actions">
        <button class="btn btn-ghost" type="button" data-action="change-location">${esc(t("results.newLocation"))}</button>
        <button class="btn btn-ghost" type="button" data-action="restart">${esc(t("results.actions.restart"))}</button>
        <button class="btn btn-primary" type="button" data-action="print">${esc(t("results.actions.print"))}</button>
      </div>
      <p class="result-disclaimer">${esc(t("results.disclaimer"))}</p>`;
    root.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.action;
        if (action === "print") window.print();
        if (action === "change-location") showStep(1);
        if (action === "restart") {
          state.results = null;
          $("results-root").hidden = true;
          showStep(1);
        }
      });
    });

  }

  function resultCard(number, title, body, kind) {
    return `<section class="result-card result-${kind}" aria-labelledby="result-${kind}-title">
      <div class="result-card-head">
        <span class="result-number" aria-hidden="true">${esc(number)}</span>
        <h3 id="result-${kind}-title">${esc(title)}</h3>
      </div>
      <div class="result-card-body">${body}</div>
    </section>`;
  }

  function renderLandSummary(payload) {
    const land = state.land;
    const location = state.location;
    const gov = location?.governorate;
    const waterBits = [
      land.irrigation_method ? t(`irrigation.${land.irrigation_method}`) : null,
      land.water_source ? t(`water_source.${land.water_source}`) : null,
      land.water_availability ? t(`water_availability.${land.water_availability}`) : null,
    ].filter(Boolean);
    const outside = location && location.in_egypt === false;

    const definitions = [
      [t("results.land.location"), state.village ? `${state.village}${gov ? " — " + localizedGovernorate(gov) : ""}` : (gov ? localizedGovernorate(gov) : coordsText(state.point))],
      [t("results.land.water"), waterBits.length ? waterBits.join(" · ") : t("common.notProvided")],
    ];

    return `
      <dl class="result-facts">
        ${definitions.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}
      </dl>
      ${outside ? `<div class="notice notice-warning">${esc(t("results.land.outsideEgypt"))}</div>` : ""}
      <div class="soil-summary-block">
        <h4>${esc(t("results.land.soil"))}</h4>
        ${renderSoilSummary(payload)}
      </div>
      <div class="missing-block">
        <h4>${esc(t("results.missing.title"))}</h4>
        ${missingList(payload)}
      </div>`;
  }

  function renderSoilSummary(payload) {
    const soil = payload.soil;
    if (!soil) return `<p class="muted small">${esc(t("results.soil.notProvided"))}</p>`;
    const interpretations = Array.isArray(soil.interpretations) ? soil.interpretations : [];
    const visible = interpretations.filter((item) => {
      if (!item) return false;
      if (String(item.factor || "").startsWith("Salinity")) return state.land.ec_ds_m !== null && state.land.ec_ds_m !== undefined;
      if (String(item.factor || "").startsWith("Texture")) return Boolean(state.land.texture);
      if (String(item.factor || "").startsWith("Drainage")) return Boolean(state.land.drainage);
      return item.value !== null && item.value !== undefined;
    });
    if (!visible.length) return `<p class="muted small">${esc(t("results.soil.notProvided"))}</p>`;
    return `<ul class="soil-class-list">${visible.map((item) => {
      const factorKey = SOIL_FACTOR_KEYS[item.factor] || null;
      const factorLabel = factorKey ? t(factorKey) : esc(item.factor);
      const classLabel = soilClassLabel(item);
      let value = "";
      if (item.value !== null && item.value !== undefined && item.value !== "") {
        const unit = String(item.unit || "");
        if (unit.includes("dS/m")) value = `${num(item.value, 2)} dS/m`;
        else if (unit === "%") value = `${num(item.value, 2)}%`;
        else if (unit.includes("pH")) value = num(item.value, 1);
        else if (String(item.factor || "").startsWith("Texture") || String(item.factor || "").startsWith("Drainage")) value = "";
        else value = num(item.value, 1);
      }
      return `<li><span>${esc(factorLabel)}</span><strong>${esc([classLabel, value].filter(Boolean).join(" · "))}</strong></li>`;
    }).join("")}</ul>`;
  }

  function soilClassLabel(item) {
    const factor = String(item?.factor || "");
    if (factor.startsWith("Texture")) {
      return state.land.texture ? t(`texture.${state.land.texture}`) : t("common.notProvided");
    }
    if (factor.startsWith("Drainage")) {
      return state.land.drainage ? t(`drainage.${state.land.drainage}`) : t("common.notProvided");
    }
    const key = `soil.class.${item?.class || "not provided"}`;
    const translated = t(key);
    return translated === key ? String(item?.class || t("common.notProvided")) : translated;
  }

  function renderWeatherSummary(payload) {
    const power = payload.power;
    if (!power || !power.indicators) {
      return `<p class="result-lead muted">${esc(t("results.weather.noData"))}</p>
        <p class="small muted"><a href="https://power.larc.nasa.gov/" target="_blank" rel="noopener noreferrer">${esc(t("results.weather.sourceLink"))} ↗</a></p>
      <p class="small muted">${esc(t("results.weather.caveat"))}</p>`;
    }
    const indicators = power.indicators;
    const signals = Array.isArray(indicators.signals) ? indicators.signals : [];
    const flagged = signals.filter((signal) => signal.severity === "high" || signal.severity === "watch");
    const high = flagged.filter((signal) => signal.severity === "high");
    const watch = flagged.filter((signal) => signal.severity === "watch");
    const primary = high[0] || watch[0] || null;
    const headline = primary
      ? (primary.severity === "high"
        ? t("results.weather.high", { signals: flagged.map((signal) => t(`risk.${signal.id}`)).join("، ") })
        : t("results.weather.watch", { signals: flagged.map((signal) => t(`risk.${signal.id}`)).join("، ") }))
      : t("results.weather.noMajor");
    const explanation = primary ? t(`risk.${primary.id}.${primary.severity}`) : "";
    const rows = flagged.map((signal) => `<li class="challenge challenge-${signal.severity}">
        <span class="challenge-dot" aria-hidden="true"></span>
        <div><strong>${esc(t(`risk.${signal.id}`))}</strong><p>${esc(challengeText(signal, power))}</p></div>
      </li>`).join("");
    return `
      <p class="result-lead">${esc(headline)}</p>
      ${explanation ? `<p class="result-explanation">${esc(explanation)}</p>` : ""}
      ${rows ? `<ul class="challenge-list">${rows}</ul>` : `<p class="small muted">${esc(t("results.challenges.none"))}</p>`}
      <p class="small muted">${esc(t("results.weather.period", {
        start: window.FieldShiftI18n.date(power.period?.first_observation),
        end: window.FieldShiftI18n.date(power.period?.last_observation),
      }))} ${esc(t("results.weather.coverage", { value: num(indicators.coverage_pct, 1) }))}</p>
      <p class="small muted">${esc(t("results.weather.caveat"))}</p>`;
  }

  function challengeText(signal, power) {
    const parameter = SIGNAL_PARAMETER[signal.id];
    const total = power.summaries?.[parameter]?.valid_days || power.indicators?.period_days || 0;
    const count = signal.value;
    if (signal.id === "heat_stress") return t("results.challenges.heat", { count: num(count, 0), total: num(total, 0) });
    if (signal.id === "dry_spell") return t("results.challenges.dry", { count: num(count, 0), total: num(total, 0) });
    if (signal.id === "heavy_rain") return t("results.challenges.rain", { count: num(count, 0) });
    if (signal.id === "wind") return t("results.challenges.wind", { count: num(count, 0), total: num(total, 0) });
    if (signal.id === "low_humidity") return t("results.challenges.humidity", { count: num(count, 0), total: num(total, 0) });
    return String(signal.observed || "");
  }

  function renderRotationSummary(payload) {
    if (state.location && state.location.in_egypt === false) {
      return `<div class="notice notice-warning">${esc(t("results.rotations.outsideEgypt"))}</div>`;
    }
    if (!payload.rotation) {
      return `<div class="notice notice-warning">${esc(t("results.rotations.unavailable"))}</div>
        <p class="small muted">${esc(t("results.rotations.unavailableNote"))}</p>`;
    }
    const scenarios = Array.isArray(payload.rotation.scenarios) ? payload.rotation.scenarios : [];
    if (!scenarios.length) {
      return `<div class="notice notice-warning">${esc(t("results.rotations.unavailable"))}</div>`;
    }
    return `
      <p class="result-lead muted">${esc(t("results.rotations.lede"))}</p>
      <div class="rotation-result-list">
        ${scenarios.map((scenario, index) => renderScenario(scenario, index)).join("")}
      </div>`;
  }

  function renderScenario(scenario, index) {
    const level = fitLevel(scenario.score);
    const name = t(`scenario.${scenario.scenario_id}.name`);
    const why = t(`scenario.${scenario.scenario_id}.why`);
    const caution = t(`scenario.${scenario.scenario_id}.caution`);
    const factors = Array.isArray(scenario.factors) ? scenario.factors : [];
    const selected = PRIORITIES.filter((id) => state.priorities.has(id));
    const fitFactors = selected.length ? selected : factors.slice(0, 3).map((factor) => factor.id);
    const pros = factors
      .filter((factor) => factor.score !== null && factor.score >= 55 && fitFactors.includes(factor.id))
      .slice(0, 3)
      .map((factor) => t(`results.factor.${factor.id}.${fitLevel(factor.score)}`));
    const cons = factors
      .filter((factor) => factor.score !== null && factor.score < 55)
      .slice(0, 3)
      .map((factor) => t(`results.factor.${factor.id}.${fitLevel(factor.score)}`));
    if (!pros.length) pros.push(t("results.rotations.prosFallback"));
    if (caution && !caution.startsWith("scenario.")) cons.push(caution);
    const missingFactors = (scenario.missing_factors || []).map((id) => t(`results.rotations.missingFactor.${id}`));
    if (!missingFactors.length) missingFactors.push(t("results.rotations.noMissing"));

    return `<article class="rotation-result${index === 0 ? " is-best" : ""}">
      <div class="rotation-result-head">
        <div>
          <p class="mini-label">${index === 0 ? esc(t("results.rotations.best")) : `#${num(index + 1, 0)}`}</p>
          <h4>${esc(name)}</h4>
        </div>
        <span class="fit-pill fit-${level}">${esc(t("results.rotations.fitValue", { value: levelLabel(level) }))}</span>
      </div>
      <p class="rotation-why">${esc(why)}</p>
      <p class="mini-label">${esc(t("results.rotations.crops"))}</p>
      <ol class="crop-order">
        ${(scenario.crops || []).map((crop) => `<li><span>${esc(localizedCrop(crop))}</span></li>`).join("")}
      </ol>
      <div class="rotation-columns">
        <div class="rotation-pros">
          <h5>${esc(t("results.rotations.pros"))}</h5>
          <ul>${pros.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
        </div>
        <div class="rotation-cons">
          <h5>${esc(t("results.rotations.cons"))}</h5>
          <ul>${cons.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
        </div>
      </div>
      <div class="priority-fit">
        <p class="mini-label">${esc(t("results.rotations.fit"))}</p>
        <div class="fit-chip-row">
          ${fitFactors.map((id) => {
            const factor = factors.find((item) => item.id === id);
            const factorLevel = fitLevel(factor?.score);
            return `<span class="fit-chip fit-${factorLevel}">${esc(t(`priority.short.${id}`))}: ${esc(levelLabel(factorLevel))}</span>`;
          }).join("")}
        </div>
      </div>
      <div class="rotation-missing">
        <p class="mini-label">${esc(t("results.rotations.missing"))}</p>
        <ul>${missingFactors.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
      </div>
      <details class="score-details">
        <summary>${esc(t("results.rotations.scoreDetails"))}</summary>
        <p>${esc(t("results.rotations.score", {
          score: num(scenario.score, 1),
          low: num(scenario.range?.low, 1),
          high: num(scenario.range?.high, 1),
        }))}</p>
        <ul class="factor-detail-list">
          ${factors.map((factor) => `<li><span>${esc(t(`factor.${factor.id}`))}</span>
            <strong>${factor.score === null ? esc(t("common.missing")) : `${num(factor.score, 0)}/100`}</strong>
          </li>`).join("")}
        </ul>
      </details>
    </article>`;
  }

  function renderActions(payload, missing) {
    const keys = actionKeys(payload);
    return `<p class="result-lead muted">${esc(t("results.actions.lede"))}</p>
      <ul class="action-list">
        ${keys.map((key) => `<li><span class="action-mark" aria-hidden="true">✓</span><span>${esc(t(`results.actions.${key}`))}</span></li>`).join("")}
      </ul>`;
  }

  function actionKeys(payload) {
    const land = state.land;
    const keys = [];
    if (land.ec_ds_m === null || land.ec_ds_m === undefined) keys.push("ec");
    if (!land.texture) keys.push("texture");
    if (!land.irrigation_method || !land.water_source) keys.push("irrigation");
    if (!land.water_availability) keys.push("water");
    const signals = payload.power?.indicators?.signals || [];
    if (signals.some((signal) => signal.id === "heat_stress" && (signal.severity === "high" || signal.severity === "watch"))) keys.push("heat");
    if (signals.some((signal) => signal.id === "dry_spell" && signal.severity === "high")) keys.push("dry");
    if (land.ec_ds_m !== null && land.ec_ds_m !== undefined && Number(land.ec_ds_m) >= 4) keys.push("salinity");
    if (state.location && state.location.in_egypt === false) keys.push("outsideEgypt");
    keys.push("verify");
    return [...new Set(keys)];
  }

  function missingInformation(payload) {
    const land = state.land;
    const items = [];
    if (land.ec_ds_m === null || land.ec_ds_m === undefined) items.push(t("results.missing.ec"));
    if (!land.texture) items.push(t("results.missing.texture"));
    if (!land.irrigation_method) items.push(t("results.missing.irrigation"));
    if (!land.water_source || !land.water_availability) items.push(t("results.missing.water"));
    if (land.organic_matter_pct === null || land.organic_matter_pct === undefined) items.push(t("results.missing.om"));
    if (payload.power?.indicators?.coverage_pct < 85) {
      items.push(t("results.missing.climate", { value: num(payload.power.indicators.coverage_pct, 1) }));
    }
    if (payload.powerError) items.push(t("results.missing.climateData"));
    return items;
  }

  function missingList(payload) {
    const items = missingInformation(payload);
    if (!items.length) return `<p class="small muted">${esc(t("results.missing.none"))}</p>`;
    return `<ul class="missing-list">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
      <p class="small muted">${esc(t("results.missing.note"))}</p>`;
  }


  // ------------------------------------------------------------------
  // Boot wiring
  // ------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const languageReady = window.FieldShiftI18n?.ready?.() || Promise.resolve();
    languageReady
      .then(() => fetch("/api/governorates"))
      .then((response) => {
        if (!response.ok) throw new Error(`Governorates HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        state.governorates = payload.governorates || [];
        boot();
      })
      .catch((error) => {
        console.error(error);
        state.governorates = [];
        boot();
      });
  });
})();
