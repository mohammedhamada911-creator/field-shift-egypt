/* Field Shift Egypt — shared store, helpers and persistence. */
(function () {
  "use strict";

  const FS = (window.FieldShift = window.FieldShift || {});
  const t = (key, vars) => window.FieldShiftI18n.t(key, vars);

  const FARM_KEY = "fieldshift.farms.v1";
  const ACTIVE_KEY = "fieldshift.activeFarm.v1";
  const PRIORITY_KEY = "fieldshift.priorities.v1";
  const PLAN_KEY = "fieldshift.plans.v1";

  const PRIORITIES = ["water", "salinity", "soil", "climate", "diversity"];
  const DEFAULT_CENTER = { lat: 26.5591, lon: 31.6991, name: "Sohag" };

  FS.state = {
    farms: [],
    activeFarmId: null,
    editingFarmId: null,
    view: "farm",
    governorates: [],
    crops: null,
    cropsMeta: null,
    priorities: new Set(),
    climate: {}, // farmId -> { days, data, fetchedAt }
    rotation: {}, // farmId -> { data, weights, fetchedAt }
    compatibility: {}, // farmId -> { results, fetchedAt, signature }
    satellite: {}, // farmId -> status payload
    plans: [],
    busy: {},
  };

  const listeners = new Map();
  FS.on = function (event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event).delete(handler);
  };
  FS.emit = function (event, detail) {
    (listeners.get(event) || new Set()).forEach((handler) => {
      try {
        handler(detail);
      } catch (error) {
        console.error(error);
      }
    });
  };

  FS.t = t;
  FS.PRIORITIES = PRIORITIES;
  FS.DEFAULT_CENTER = DEFAULT_CENTER;

  FS.esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));

  FS.num = function (value, digits = 0) {
    if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) {
      return "—";
    }
    return window.FieldShiftI18n.number(Number(value), digits);
  };

  // Keep numeric ranges/scores readable inside RTL text.
  FS.bidi = (value) => `<bdi dir="ltr">${FS.esc(value)}</bdi>`;

  FS.date = (value) => window.FieldShiftI18n.date(value);
  FS.dateTime = (value) => window.FieldShiftI18n.dateTime(value);

  FS.shortDate = function (iso) {
    if (!iso) return "—";
    const parsed = new Date(String(iso).slice(0, 10) + "T00:00:00");
    if (Number.isNaN(parsed.getTime())) return String(iso);
    return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  };

  FS.monthName = (index) => window.FieldShiftI18n.monthName(index, false);
  FS.monthShort = (index) => window.FieldShiftI18n.monthName(index, true);

  FS.uuid = function () {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "farm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  };

  FS.readJSON = function (key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (_error) {
      return fallback;
    }
  };

  FS.writeJSON = function (key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_error) {
      return false;
    }
  };

  FS.api = async function (url, options = {}) {
    const response = await fetch(url, options);
    let body = null;
    try {
      body = await response.json();
    } catch (_error) {
      body = null;
    }
    if (!response.ok) {
      const error = new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  };

  // ------------------------------------------------------------------
  // Farms
  // ------------------------------------------------------------------
  FS.loadFarms = function () {
    const saved = FS.readJSON(FARM_KEY, []);
    FS.state.farms = Array.isArray(saved)
      ? saved.filter((farm) => farm && Number.isFinite(Number(farm.latitude)))
      : [];
    const active = FS.readJSON(ACTIVE_KEY, null);
    const exists = FS.state.farms.some((farm) => farm.id === active);
    FS.state.activeFarmId = exists ? active : (FS.state.farms[0]?.id || null);
    if (FS.state.activeFarmId) FS.writeJSON(ACTIVE_KEY, FS.state.activeFarmId);
  };

  FS.persistFarms = function () {
    FS.writeJSON(FARM_KEY, FS.state.farms);
    FS.writeJSON(ACTIVE_KEY, FS.state.activeFarmId);
  };

  FS.farmById = (id) => FS.state.farms.find((farm) => farm.id === id) || null;

  FS.activeFarm = () => FS.farmById(FS.state.activeFarmId);

  FS.setActiveFarm = function (id) {
    if (!FS.farmById(id)) return;
    FS.state.activeFarmId = id;
    FS.persistFarms();
    FS.emit("farmchange", { farmId: id });
  };

  FS.upsertFarm = function (farm) {
    const now = new Date().toISOString();
    const existingIndex = FS.state.farms.findIndex((item) => item.id === farm.id);
    if (existingIndex >= 0) {
      FS.state.farms[existingIndex] = {
        ...FS.state.farms[existingIndex],
        ...farm,
        updated_at: now,
      };
    } else {
      FS.state.farms.unshift({ ...farm, created_at: now, updated_at: now });
      FS.state.activeFarmId = farm.id;
    }
    FS.persistFarms();
    FS.emit("farmchange", { farmId: farm.id });
    return FS.farmById(farm.id);
  };

  FS.deleteFarm = function (id) {
    FS.state.farms = FS.state.farms.filter((farm) => farm.id !== id);
    if (FS.state.activeFarmId === id) {
      FS.state.activeFarmId = FS.state.farms[0]?.id || null;
    }
    delete FS.state.climate[id];
    delete FS.state.rotation[id];
    delete FS.state.compatibility[id];
    delete FS.state.satellite[id];
    FS.persistFarms();
    FS.emit("farmchange", { farmId: FS.state.activeFarmId, deleted: id });
  };

  FS.farmLabel = function (farm) {
    if (!farm) return "—";
    if (farm.village) return farm.village;
    if (farm.name) return farm.name;
    if (farm.governorate) return FS.governorateLabel(farm.governorate);
    return FS.coords(farm);
  };

  FS.governorateLabel = function (name) {
    const gov = FS.state.governorates.find((item) => item.name === name);
    if (!gov) return name || "";
    return window.FieldShiftI18n.isArabic() && gov.name_ar ? gov.name_ar : gov.name;
  };

  FS.governorateByName = (name) =>
    FS.state.governorates.find((item) => item.name === name) || null;

  FS.coords = function (point) {
    if (!point || point.latitude === undefined) {
      if (!point || point.lat === undefined) return "—";
    }
    const lat = Number(point.latitude ?? point.lat);
    const lon = Number(point.longitude ?? point.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "—";
    return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
  };

  FS.soilFromFarm = function (farm) {
    if (!farm) return {};
    const soil = {};
    if (farm.soil_texture) soil.texture = farm.soil_texture;
    if (farm.ph !== null && farm.ph !== undefined && farm.ph !== "") soil.ph = Number(farm.ph);
    if (farm.organic_matter_pct !== null && farm.organic_matter_pct !== undefined && farm.organic_matter_pct !== "") {
      soil.organic_matter_pct = Number(farm.organic_matter_pct);
    }
    if (farm.ec_ds_m !== null && farm.ec_ds_m !== undefined && farm.ec_ds_m !== "") {
      soil.ec_ds_m = Number(farm.ec_ds_m);
    }
    if (farm.drainage) soil.drainage = farm.drainage;
    if (farm.irrigation_method) soil.irrigation_method = farm.irrigation_method;
    if (farm.water_source) soil.water_source = farm.water_source;
    return soil;
  };

  FS.completeness = function (farm) {
    if (!farm) return { done: 0, total: 8, missing: [] };
    const checks = [
      ["name", Boolean(String(farm.name || "").trim())],
      ["area", farm.area_feddan !== null && farm.area_feddan !== undefined && farm.area_feddan !== ""],
      ["texture", Boolean(farm.soil_texture)],
      ["ec", farm.ec_ds_m !== null && farm.ec_ds_m !== undefined && farm.ec_ds_m !== ""],
      ["irrigation", Boolean(farm.irrigation_method)],
      ["water_source", Boolean(farm.water_source)],
      ["water_availability", Boolean(farm.water_availability)],
      ["current_crop", Boolean(String(farm.current_crop || "").trim())],
    ];
    const missing = checks.filter(([, ok]) => !ok).map(([id]) => id);
    return { done: checks.length - missing.length, total: checks.length, missing };
  };

  FS.climateContextFromData = function (data) {
    if (!data || !Array.isArray(data.series)) return null;
    const rows = data.series;
    const maxTemps = rows.map((row) => row.T2M_MAX).filter((value) => value !== null && value !== undefined);
    if (!maxTemps.length) return null;
    const rain = rows.map((row) => row.PRECTOTCORR).filter((value) => value !== null && value !== undefined);
    return {
      period_days: rows.length,
      heat_days_35c: maxTemps.filter((value) => value >= 35).length,
      very_hot_days_40c: maxTemps.filter((value) => value >= 40).length,
      rain_total_mm: rain.length ? Math.round(rain.reduce((sum, value) => sum + value, 0) * 10) / 10 : null,
      completeness_pct: data.quality?.completeness_pct ?? null,
    };
  };

  FS.activeClimate = function () {
    const farm = FS.activeFarm();
    return farm ? FS.state.climate[farm.id] || null : null;
  };

  FS.activeRotation = function () {
    const farm = FS.activeFarm();
    return farm ? FS.state.rotation[farm.id] || null : null;
  };

  FS.invalidateDerived = function (farmId) {
    delete FS.state.rotation[farmId];
    delete FS.state.compatibility[farmId];
    FS.emit("derivedchange", { farmId });
  };

  // ------------------------------------------------------------------
  // Priorities and plans
  // ------------------------------------------------------------------
  FS.loadPriorities = function () {
    const saved = FS.readJSON(PRIORITY_KEY, []);
    FS.state.priorities = new Set(
      Array.isArray(saved) ? saved.filter((id) => PRIORITIES.includes(id)) : []
    );
  };

  FS.persistPriorities = function () {
    FS.writeJSON(PRIORITY_KEY, [...FS.state.priorities]);
  };

  FS.loadPlans = function () {
    const saved = FS.readJSON(PLAN_KEY, []);
    FS.state.plans = Array.isArray(saved) ? saved : [];
  };

  FS.persistPlans = function () {
    FS.writeJSON(PLAN_KEY, FS.state.plans.slice(0, 20));
  };

  FS.computeWeights = function () {
    if (!FS.state.priorities.size) {
      return PRIORITIES.reduce((weights, id) => {
        weights[id] = 20;
        return weights;
      }, {});
    }
    return PRIORITIES.reduce((weights, id) => {
      weights[id] = FS.state.priorities.has(id) ? 30 : 5;
      return weights;
    }, {});
  };

  FS.priorityLabel = (id) => t(`priority.short.${id}`);

  // ------------------------------------------------------------------
  // Presentation helpers
  // ------------------------------------------------------------------
  FS.levelKey = function (level) {
    if (level === "high") return "px.common.highCompat";
    if (level === "moderate") return "px.common.moderateCompat";
    if (level === "low") return "px.common.lowCompat";
    return "px.common.insufficientCompat";
  };

  FS.levelClass = (level) => `compat-${["high", "moderate", "low"].includes(level) ? level : "insufficient"}`;

  FS.severityClass = function (severity) {
    if (severity === "high") return "high";
    if (severity === "watch") return "watch";
    if (severity === "low") return "low";
    return "unknown";
  };

  FS.fitLevel = function (score) {
    if (score === null || score === undefined) return "insufficient";
    if (score >= 70) return "high";
    if (score >= 45) return "moderate";
    return "low";
  };

  FS.traitLabel = function (kind, value) {
    if (value === null || value === undefined || value === "") return "—";
    if (kind === "water") return t(`px.water.${value}`);
    if (kind === "salinity") return t(`px.salinity.${String(value).replace(/\s+/g, "_")}`);
    if (kind === "season") return t(`px.cycle.${value}`);
    if (kind === "role") return t(`px.role.${value}`);
    return String(value);
  };

  FS.factorDescription = function (factor) {
    const level = FS.fitLevel(factor.score);
    return t(`results.factor.${factor.id}.${level === "high" ? "good" : level === "moderate" ? "medium" : "weak"}`);
  };

  FS.factorLevelLabel = function (score) {
    return t(`px.common.level.${FS.fitLevel(score)}`);
  };

  FS.actionLabel = function (check) {
    if (!check) return "";
    if (check.label) return check.label;
    return t(`px.plan.actions.${check.id}`);
  };

  FS.cropEmoji = {
    wheat: "🌾", maize: "🌽", rice: "🍚", cotton: "🌿", berseem: "🍀",
    faba_bean: "🫘", chickpea: "🫘", lentil: "🫘", sorghum: "🌾", sesame: "🌱",
    potato: "🥔", tomato: "🍅", onion: "🧅", sugar_beet: "🍠", sugarcane: "🎋",
    sunflower: "🌻", groundnut: "🥜", barley: "🌾", date_palm: "🌴",
    olive: "🫒", citrus: "🍊", fig: "🍃",
  };

  FS.durationMonths = function (crop) {
    const plant = Array.isArray(crop?.planting_months) ? crop.planting_months : [];
    const harvest = Array.isArray(crop?.harvest_months) ? crop.harvest_months : [];
    if (!plant.length || !harvest.length) return null;
    let best = null;
    plant.forEach((month) => {
      harvest.forEach((end) => {
        let duration = end - month;
        if (duration <= 0) duration += 12;
        if (best === null || duration < best) best = duration;
      });
    });
    return best;
  };

  FS.monthRange = function (months) {
    if (!Array.isArray(months) || !months.length) return "—";
    const names = months.map((month) => FS.monthShort(month));
    return names.join(" · ");
  };

  FS.initState = function () {
    FS.loadFarms();
    FS.loadPriorities();
    FS.loadPlans();
  };
})();
