/* Field Shift Egypt — My Farm: map, profile form, multiple farms. */
(function () {
  "use strict";

  const FS = (window.FieldShift = window.FieldShift || {});
  const t = (key, vars) => window.FieldShiftI18n.t(key, vars);
  const esc = (value) => FS.esc(value);
  const $ = (id) => document.getElementById(id);

  const s = {
    map: null,
    marker: null,
    geojson: null,
    point: null,
    location: null,
    requestId: 0,
    referenceKey: null,
    referenceData: null,
    mapReady: false,
  };

  function numOrNull(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function setValue(id, value) {
    const element = $(id);
    if (!element) return;
    element.value = value === null || value === undefined ? "" : value;
  }

  // ------------------------------------------------------------------
  // Map
  // ------------------------------------------------------------------
  function ensureMap() {
    if (s.map || !window.L || !$("farm-map")) return;
    const farm = FS.activeFarm();
    const center = s.point || (farm && farm.latitude !== undefined ? farm : FS.DEFAULT_CENTER);
    s.map = L.map("farm-map", {
      center: [Number(center.latitude ?? center.lat), Number(center.longitude ?? center.lon)],
      zoom: 6,
      minZoom: 4,
      maxZoom: 17,
      scrollWheelZoom: false,
      zoomControl: true,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(s.map);
    s.map.on("click", (event) => setPoint(event.latlng.lat, event.latlng.lng));
    if (s.point) ensureMarker();
    loadBoundaries();
    s.mapReady = true;
  }

  function invalidateMap() {
    if (!s.map) return;
    window.setTimeout(() => s.map.invalidateSize(), 60);
  }

  function loadBoundaries() {
    if (!s.map || s.geojson) return;
    fetch("/static/data/egypt_governorates.geojson")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((geojson) => {
        s.geojson = L.geoJSON(geojson, {
          style: { color: "#5f8577", weight: 1, fillColor: "#8fc6b4", fillOpacity: 0.08 },
          onEachFeature: (feature, layer) => {
            const gov = governorateFromFeature(feature);
            if (gov) layer.bindTooltip(localizedGovernorate(gov), { sticky: true });
            layer.on({
              mouseover: () => layer.setStyle({ fillOpacity: 0.2, weight: 2 }),
              mouseout: () => s.geojson?.resetStyle(layer),
              click: (event) => {
                L.DomEvent.stopPropagation(event);
                if (!gov) return;
                setPoint(gov.latitude, gov.longitude, { governorate: gov });
              },
            });
          },
        }).addTo(s.map);
      })
      .catch(() => {
        FS.ui.toast(t("px.farm.boundaryUnavailable"), "error");
      });
  }

  function governorateFromFeature(feature) {
    const name = String(feature?.properties?.shapeName || "")
      .replace(/\s+Governorate$/i, "")
      .trim();
    return FS.state.governorates.find((gov) => gov.name.toLowerCase() === name.toLowerCase()) || null;
  }

  function localizedGovernorate(gov) {
    return window.FieldShiftI18n.isArabic() && gov.name_ar ? gov.name_ar : gov.name;
  }

  function ensureMarker() {
    if (!s.map || !s.point) return;
    const latlng = [s.point.latitude, s.point.longitude];
    if (!s.marker) {
      s.marker = L.marker(latlng, { draggable: true }).addTo(s.map);
      s.marker.on("dragend", () => {
        const point = s.marker.getLatLng();
        setPoint(point.lat, point.lng);
      });
    } else {
      s.marker.setLatLng(latlng);
    }
  }

  function setPoint(lat, lon, options = {}) {
    lat = Number(lat);
    lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      FS.ui.toast(t("px.farm.invalidCoords"), "error");
      return;
    }
    s.point = { latitude: lat, longitude: lon };
    setValue("farm-lat", lat.toFixed(4));
    setValue("farm-lon", lon.toFixed(4));
    ensureMarker();
    if (s.map && options.pan !== false) s.map.panTo([lat, lon]);
    if (s.map && options.zoom && s.map.getZoom() < options.zoom) s.map.setZoom(options.zoom);

    if (options.governorate) {
      s.location = {
        latitude: lat,
        longitude: lon,
        in_egypt: true,
        governorate: {
          name: options.governorate.name,
          name_ar: options.governorate.name_ar,
          id: options.governorate.id,
        },
      };
      setValue("farm-governorate", options.governorate.name);
      setLocationNote(t("px.farm.locationReady"), "success");
      updateSummary();
      return;
    }
    updateSummary();
    if (options.resolve !== false) resolveLocation(lat, lon);
  }

  async function resolveLocation(lat, lon) {
    const requestId = ++s.requestId;
    setLocationNote(t("common.loading"), "info");
    try {
      const body = await FS.api(
        `/api/location?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
      );
      if (requestId !== s.requestId) return;
      s.location = body.location;
      if (body.location.governorate) {
        setValue("farm-governorate", body.location.governorate.name);
        setLocationNote(t("px.farm.locationReady"), "success");
      } else if (body.location.in_egypt === false) {
        setLocationNote(t("px.farm.outsideEgypt"), "warning");
      } else {
        setLocationNote(t("px.farm.locationReady"), "success");
      }
      updateSummary();
    } catch (error) {
      if (requestId !== s.requestId) return;
      setLocationNote(t("px.farm.locationError"), "warning");
      updateSummary();
    }
  }

  function setLocationNote(message, kind = "info") {
    const note = $("farm-location-note");
    if (!note) return;
    note.textContent = message;
    note.className = `small location-note location-note-${kind}`;
  }

  function updateSummary() {
    const nameEl = $("farm-location-name");
    const coordsEl = $("farm-location-coords");
    if (!nameEl || !coordsEl) return;
    if (!s.point) {
      nameEl.textContent = "—";
      coordsEl.textContent = "—";
      setLocationNote(t("px.farm.location.none"), "info");
      return;
    }
    const village = String($("farm-village")?.value || "").trim();
    const gov = s.location?.governorate;
    const govName = gov
      ? window.FieldShiftI18n.isArabic() && gov.name_ar
        ? gov.name_ar
        : gov.name
      : "";
    const parts = [govName, village].filter(Boolean);
    nameEl.textContent = parts.length ? parts.join(" · ") : t("px.farm.location.selected");
    coordsEl.textContent = FS.coords(s.point);
    coordsEl.setAttribute("dir", "ltr");
    if (s.location && s.location.in_egypt === false) {
      setLocationNote(t("px.farm.outsideEgypt"), "warning");
    }
  }

  // ------------------------------------------------------------------
  // Governorate select
  // ------------------------------------------------------------------
  function populateGovernorates() {
    const select = $("farm-governorate");
    if (!select) return;
    const current = select.value;
    const sorted = [...FS.state.governorates].sort((a, b) => a.name.localeCompare(b.name));
    select.innerHTML =
      `<option value="">${esc(t("common.choose"))}</option>` +
      sorted
        .map(
          (gov) =>
            `<option value="${esc(gov.name)}">${esc(localizedGovernorate(gov))}</option>`
        )
        .join("");
    if (current) select.value = current;
  }

  function onGovernorateChange() {
    const name = $("farm-governorate")?.value;
    if (!name) return;
    const gov = FS.governorateByName(name);
    if (!gov) return;
    setPoint(gov.latitude, gov.longitude, { governorate: gov, zoom: 8 });
  }

  // ------------------------------------------------------------------
  // Form
  // ------------------------------------------------------------------
  function blankFarm() {
    return {
      id: null,
      name: "",
      area_feddan: "",
      governorate: "",
      village: "",
      latitude: null,
      longitude: null,
      soil_texture: "",
      ph: "",
      organic_matter_pct: "",
      ec_ds_m: "",
      drainage: "",
      irrigation_method: "",
      water_source: "",
      water_availability: "",
      current_crop: "",
      previous_crops: "",
    };
  }

  function fillForm(farm, options = {}) {
    const data = farm || blankFarm();
    setValue("farm-name", data.name);
    setValue("farm-area", data.area_feddan);
    populateGovernorates();
    setValue("farm-governorate", data.governorate);
    setValue("farm-village", data.village);
    setValue("farm-texture", data.soil_texture);
    setValue("farm-ph", data.ph);
    setValue("farm-om", data.organic_matter_pct);
    setValue("farm-ec", data.ec_ds_m);
    setValue("farm-drainage", data.drainage);
    setValue("farm-irrigation", data.irrigation_method);
    setValue("farm-water-source", data.water_source);
    setValue("farm-water-availability", data.water_availability);
    setValue("farm-current-crop", data.current_crop);
    setValue("farm-previous-crops", data.previous_crops);

    const hasEc = data.ec_ds_m !== null && data.ec_ds_m !== undefined && data.ec_ds_m !== "";
    const radios = document.querySelectorAll('input[name="salinity-known"]');
    radios.forEach((radio) => {
      radio.checked = radio.value === (hasEc ? "yes" : "no");
    });
    toggleSalinity(hasEc);

    if (data.latitude !== null && data.latitude !== undefined && data.longitude !== null && data.longitude !== undefined) {
      s.point = { latitude: Number(data.latitude), longitude: Number(data.longitude) };
      setValue("farm-lat", Number(data.latitude).toFixed(4));
      setValue("farm-lon", Number(data.longitude).toFixed(4));
      s.location = data.governorate
        ? {
            latitude: Number(data.latitude),
            longitude: Number(data.longitude),
            in_egypt: true,
            governorate: {
              name: data.governorate,
              name_ar: FS.governorateByName(data.governorate)?.name_ar || "",
            },
          }
        : s.location;
      ensureMarker();
      if (s.map) {
        s.map.setView([Number(data.latitude), Number(data.longitude)], options.zoom || 11);
      }
      updateSummary();
      if (!data.governorate) resolveLocation(Number(data.latitude), Number(data.longitude));
    } else {
      s.point = null;
      s.location = null;
      setValue("farm-lat", "");
      setValue("farm-lon", "");
      updateSummary();
    }

    if (options.defaultPoint) {
      const home = FS.DEFAULT_CENTER;
      setPoint(home.lat, home.lon, { pan: false, zoom: 6, resolve: false });
      setLocationNote(t("px.farm.defaultHint"), "info");
    }

    updateCompleteness(farm);
    updateDeleteButton(Boolean(farm));
    updateReference(farm);
  }

  function toggleSalinity(show) {
    const wrap = $("salinity-input-wrap");
    if (wrap) wrap.hidden = !show;
  }

  function readForm() {
    const existing = FS.farmById(s.editingId);
    const salinityYes = document.querySelector('input[name="salinity-known"]:checked')?.value === "yes";
    return {
      ...(existing || {}),
      id: s.editingId || FS.uuid(),
      name: String($("farm-name")?.value || "").trim(),
      area_feddan: numOrNull($("farm-area")?.value),
      governorate: $("farm-governorate")?.value || s.location?.governorate?.name || "",
      village: String($("farm-village")?.value || "").trim(),
      latitude: s.point?.latitude ?? null,
      longitude: s.point?.longitude ?? null,
      soil_texture: $("farm-texture")?.value || null,
      ph: numOrNull($("farm-ph")?.value),
      organic_matter_pct: numOrNull($("farm-om")?.value),
      ec_ds_m: salinityYes ? numOrNull($("farm-ec")?.value) : null,
      drainage: $("farm-drainage")?.value || null,
      irrigation_method: $("farm-irrigation")?.value || null,
      water_source: $("farm-water-source")?.value || null,
      water_availability: $("farm-water-availability")?.value || null,
      current_crop: String($("farm-current-crop")?.value || "").trim() || null,
      previous_crops: String($("farm-previous-crops")?.value || "").trim() || null,
      source: "user input",
    };
  }

  function applyFarmToForm(farm) {
    s.editingId = farm ? farm.id : null;
    FS.state.editingFarmId = s.editingId;
    fillForm(farm, farm ? {} : { defaultPoint: true });
    if (!farm && s.map) {
      s.map.setView([FS.DEFAULT_CENTER.lat, FS.DEFAULT_CENTER.lon], 6);
    }
    if (s.map) invalidateMap();
  }

  async function saveFarm(continueToClimate = false) {
    const payload = readForm();
    if (!payload.name) {
      FS.ui.toast(t("px.farm.nameRequired"), "error");
      $("farm-name")?.focus();
      return;
    }
    if (payload.latitude === null || payload.longitude === null) {
      FS.ui.toast(t("px.farm.locationRequired"), "error");
      return;
    }
    if (payload.governorate && payload.latitude !== null) {
      const gov = FS.governorateByName(payload.governorate);
      if (gov && Math.abs(gov.latitude - payload.latitude) > 0.0001) {
        // Keep the actual map point; governorate remains a label only.
        payload.governorate = s.location?.governorate?.name || payload.governorate;
      }
    }

    const farm = FS.upsertFarm(payload);
    FS.invalidateDerived(farm.id);
    s.editingId = farm.id;
    FS.state.editingFarmId = farm.id;
    renderChips();
    updateCompleteness(farm);
    updateDeleteButton(true);
    updateReference(farm);
    FS.ui.toast(t("px.farm.savedToast"));

    try {
      const saved = await FS.api("/api/farm/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverPayload(farm)),
      });
      if (saved?.profile?.id) {
        FS.state.farms = FS.state.farms.map((item) =>
          item.id === farm.id ? { ...item, server_id: saved.profile.id } : item
        );
        FS.persistFarms();
      }
      FS.ui.toast(t("px.farm.savedServer"));
    } catch (_error) {
      FS.ui.toast(t("px.farm.serverSaveFailed"), "error");
    }

    if (continueToClimate) FS.ui.goto("climate");
  }

  function serverPayload(farm) {
    return {
      name: farm.name,
      latitude: farm.latitude,
      longitude: farm.longitude,
      soil_texture: farm.soil_texture || null,
      ph: farm.ph,
      organic_matter_pct: farm.organic_matter_pct,
      ec_ds_m: farm.ec_ds_m,
      drainage: farm.drainage || null,
      irrigation_method: farm.irrigation_method || null,
      water_source: farm.water_source || null,
      water_availability: farm.water_availability || null,
      area_feddan: farm.area_feddan,
      current_crop: farm.current_crop || null,
      previous_crops: farm.previous_crops || null,
      notes: null,
    };
  }

  function deleteFarm() {
    if (!s.editingId) return;
    if (!window.confirm(t("px.farm.deleteConfirm"))) return;
    FS.deleteFarm(s.editingId);
    s.editingId = null;
    FS.state.editingFarmId = null;
    FS.ui.toast(t("px.farm.deletedToast"));
    const next = FS.activeFarm();
    applyFarmToForm(next);
    renderChips();
    FS.ui.renderFarmContext();
  }

  // ------------------------------------------------------------------
  // Chips, completeness, reference
  // ------------------------------------------------------------------
  function renderChips() {
    const box = $("farm-chips");
    const count = $("farm-count");
    if (!box) return;
    if (!FS.state.farms.length) {
      box.innerHTML = `<span class="farm-chip-empty">${esc(t("px.farm.noFarms"))}</span>`;
      if (count) count.textContent = "";
      return;
    }
    box.innerHTML = FS.state.farms
      .map((farm) => {
        const active = farm.id === FS.state.activeFarmId;
        return `<button class="farm-chip${active ? " is-active" : ""}" type="button" data-farm-id="${esc(farm.id)}">
          <span class="chip-dot" aria-hidden="true"></span>
          <span>${esc(FS.farmLabel(farm))}</span>
        </button>`;
      })
      .join("");
    if (count) {
      count.textContent = t("px.farm.myFarms") + " · " + FS.num(FS.state.farms.length);
    }
  }

  function updateCompleteness(farm) {
    const block = $("farm-completeness");
    if (!block) return;
    if (!farm) {
      block.hidden = true;
      return;
    }
    const completeness = FS.completeness(farm);
    const percent = Math.round((completeness.done / completeness.total) * 100);
    block.hidden = false;
    block.innerHTML = `
      <p class="small"><strong>${esc(t("px.farm.completeness"))}</strong> — ${esc(
        t("px.farm.completeness.value", { done: completeness.done, total: completeness.total })
      )}</p>
      <div class="completeness-track" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
        <i style="width:${percent}%"></i>
      </div>
      <p class="completeness-list">${
        completeness.missing.length
          ? esc(t("px.farm.missing", { items: completeness.missing.map(missingLabel).join("، ") }))
          : esc(t("px.farm.noMissing"))
      }</p>`;
  }

  function missingLabel(id) {
    return t(`px.farm.missing.${id}`);
  }

  function updateDeleteButton(show) {
    const button = $("farm-delete");
    if (button) button.hidden = !show;
  }

  async function updateReference(farm) {
    const card = $("farm-reference");
    if (!card) return;
    if (!farm) {
      card.hidden = true;
      card.innerHTML = "";
      s.referenceKey = null;
      s.referenceData = null;
      return;
    }
    const key = `${farm.id}:${farm.latitude}:${farm.longitude}:${farm.governorate}`;
    if (s.referenceKey === key) {
      // Same farm: re-render from cache so a language switch is reflected.
      if (s.referenceData) card.innerHTML = referenceHtml(s.referenceData);
      return;
    }
    s.referenceKey = key;
    s.referenceData = null;
    card.hidden = false;
    card.innerHTML = `<p class="small muted">${esc(t("common.loading"))}</p>`;
    try {
      const params = new URLSearchParams();
      if (farm.governorate) params.set("governorate", farm.governorate);
      if (farm.latitude !== null) params.set("lat", farm.latitude);
      if (farm.longitude !== null) params.set("lon", farm.longitude);
      const body = await FS.api(`/api/agri/reference?${params.toString()}`);
      if (s.referenceKey !== key) return;
      if (!body.available) {
        s.referenceData = null;
        card.innerHTML = `
          <h3>${esc(t("px.farm.refLabel"))}</h3>
          <p>${esc(t("px.farm.refUnavailable"))}</p>`;
        return;
      }
      s.referenceData = body;
      card.innerHTML = referenceHtml(body);
    } catch (_error) {
      if (s.referenceKey !== key) return;
      card.innerHTML = `<p class="small muted">${esc(t("px.farm.refUnavailable"))}</p>`;
    }
  }

  function referenceHtml(body) {
    const region = body.region || {};
    const regionKey = region.id && region.id !== "unknown" ? region.id : "nile_valley";
    const regionLabel = t(`px.ref.region.${regionKey}.label`);
    const crops = (body.dominant_crops || [])
      .map((crop) => {
        const name = window.FieldShiftI18n.isArabic() && crop.name_ar ? crop.name_ar : crop.name;
        return `<span class="crop-tag">${esc(name)}</span>`;
      })
      .join("");
    const sources = (body.sources || [])
      .map(
        (source) =>
          `<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(
            source.name
          )}</a></li>`
      )
      .join("");
    return `
      <div class="section-head-inline">
        <div>
          <h3>${esc(t("px.farm.refLabel"))}${body.governorate ? " — " + esc(FS.governorateLabel(body.governorate)) : ""}</h3>
          <p class="small muted">${esc(regionLabel)}</p>
        </div>
        <span class="provenance-tag tag-ref">${esc(t("px.common.reference"))}</span>
      </div>
      <dl class="reference-list">
        <dt>${esc(t("px.farm.refSoil"))}</dt>
        <dd>${esc(t(`px.ref.region.${regionKey}.soil`))}</dd>
        <dt>${esc(t("px.farm.refWater"))}</dt>
        <dd>${esc(t(`px.ref.region.${regionKey}.water`))}</dd>
        <dt>${esc(t("px.farm.refRotation"))}</dt>
        <dd>${esc(t(`px.ref.region.${regionKey}.rotation`))}</dd>
      </dl>
      ${crops ? `<div class="reference-crops"><span class="mini-label">${esc(t("px.farm.refCrops"))}</span><div class="crop-tags">${crops}</div></div>` : ""}
      <details class="reference-details">
        <summary>${esc(t("px.farm.refEnglish"))}</summary>
        <p>${esc(body.soil_summary || "")}</p>
        <p>${esc(body.water_context || "")}</p>
        ${sources ? `<p class="small muted">${esc(t("px.farm.refSources"))}</p><ul class="small muted">${sources}</ul>` : ""}
      </details>
      <p class="small muted reference-disclaimer">${esc(t("px.farm.refDisclaimer"))}</p>`;
  }

  // ------------------------------------------------------------------
  // Events and lifecycle
  // ------------------------------------------------------------------
  function bindEvents() {
    $("farm-new")?.addEventListener("click", () => {
      applyFarmToForm(null);
      s.editingId = null;
      $("farm-name")?.focus();
    });
    $("farm-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveFarm(false);
    });
    $("farm-save-continue")?.addEventListener("click", () => saveFarm(true));
    $("farm-geolocate")?.addEventListener("click", () => {
      if (!navigator.geolocation) {
        FS.ui.toast(t("px.farm.geoUnavailable"), "error");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setPoint(position.coords.latitude, position.coords.longitude, { zoom: 13 });
          if (s.map) s.map.setView([position.coords.latitude, position.coords.longitude], 13);
        },
        () => FS.ui.toast(t("px.farm.geoError"), "error"),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
      );
    });
    $("farm-reset")?.addEventListener("click", () => {
      const home = FS.DEFAULT_CENTER;
      setPoint(home.lat, home.lon, { pan: true, zoom: 6, resolve: false });
      if (s.map) s.map.setView([home.lat, home.lon], 6);
      setLocationNote(t("px.farm.defaultHint"), "info");
    });
    $("farm-apply-coords")?.addEventListener("click", () => {
      const lat = Number($("farm-lat")?.value);
      const lon = Number($("farm-lon")?.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        FS.ui.toast(t("px.farm.invalidCoords"), "error");
        return;
      }
      setPoint(lat, lon, { zoom: 11 });
      if (s.map) s.map.setView([lat, lon], 11);
    });
    $("farm-governorate")?.addEventListener("change", onGovernorateChange);
    $("farm-village")?.addEventListener("input", updateSummary);
    document.querySelectorAll('input[name="salinity-known"]').forEach((radio) => {
      radio.addEventListener("change", () => toggleSalinity(radio.value === "yes" && radio.checked));
    });
    $("farm-chips")?.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-farm-id]");
      if (!chip) return;
      const id = chip.getAttribute("data-farm-id");
      if (!FS.farmById(id)) return;
      FS.setActiveFarm(id);
      applyFarmToForm(FS.activeFarm());
      FS.ui.renderFarmContext();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.id = "farm-delete";
    deleteButton.className = "btn btn-ghost btn-danger";
    deleteButton.hidden = true;
    deleteButton.textContent = t("px.common.delete");
    deleteButton.addEventListener("click", deleteFarm);
    document.querySelector(".form-actions")?.appendChild(deleteButton);

    FS.on("viewchange", ({ view }) => {
      if (view !== "farm") return;
      ensureMap();
      invalidateMap();
    });
  }

  function rerender() {
    populateGovernorates();
    renderChips();
    FS.ui.renderFarmContext();
    const farm = FS.activeFarm();
    if (farm) {
      s.editingId = farm.id;
      // Preserve whatever the farmer is currently typing.
      updateCompleteness(farm);
      updateReference(farm);
      updateSummary();
    } else {
      s.editingId = null;
      updateCompleteness(null);
      updateReference(null);
      updateSummary();
    }
    if (FS.state.view === "farm") {
      ensureMap();
      invalidateMap();
    }
  }

  function init() {
    bindEvents();
    populateGovernorates();
    renderChips();
    const farm = FS.activeFarm();
    s.editingId = farm ? farm.id : null;
    fillForm(farm, farm ? {} : { defaultPoint: true });
    if (FS.state.view === "farm") {
      ensureMap();
      invalidateMap();
    }
    FS.on("farmchange", () => {
      renderChips();
      FS.ui.renderFarmContext();
      if (FS.state.view === "farm") {
        // Chips and context already drove the change; refresh form from store.
        const active = FS.activeFarm();
        s.editingId = active ? active.id : null;
        fillForm(active, active ? {} : { defaultPoint: true });
      }
    });
  }

  FS.farm = {
    init,
    rerender,
    setPoint,
    saveFarm,
    readForm,
    applyFarmToForm,
    serverPayload,
  };
})();
