/* Field Shift Egypt — Suitable Crops: reference database + documented-trait compatibility. */
(function () {
  "use strict";

  const FS = (window.FieldShift = window.FieldShift || {});
  const t = (key, vars) => window.FieldShiftI18n.t(key, vars);
  const esc = (value) => FS.esc(value);
  const $ = (id) => document.getElementById(id);

  const s = {
    query: "",
    role: "",
    season: "",
    water: "",
    salinity: "",
    selected: null,
    loading: false,
    compatLoading: false,
    compatError: null,
    searchTimer: null,
  };

  function isArabic() {
    return window.FieldShiftI18n.isArabic();
  }

  function cropName(crop) {
    return isArabic() && crop.name_ar ? crop.name_ar : crop.name;
  }

  async function ensureCrops() {
    if (FS.state.crops) return;
    if (s.loading) return;
    s.loading = true;
    try {
      const body = await FS.api("/api/crops");
      FS.state.crops = body.crops || [];
      FS.state.cropsMeta = body.meta || null;
    } catch (_error) {
      FS.state.crops = FS.state.crops || [];
      FS.state.cropsMeta = null;
    } finally {
      s.loading = false;
    }
  }

  function currentSignature(farm, climate) {
    return JSON.stringify({
      farm: farm.id,
      soil: FS.soilFromFarm(farm),
      water: farm.water_availability || null,
      climate: climate || null,
    });
  }

  async function getCompatibility(force = false) {
    const farm = FS.activeFarm();
    if (!farm) return null;
    await ensureCrops();
    if (!FS.state.crops?.length) return null;
    const climate = FS.climate.context(farm);
    const signature = currentSignature(farm, climate);
    const cached = FS.state.compatibility[farm.id];
    if (!force && cached && cached.signature === signature) return cached.results;
    if (s.compatLoading) return cached?.results || null;
    s.compatLoading = true;
    s.compatError = null;
    try {
      const body = await FS.api("/api/crops/compatibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soil: FS.soilFromFarm(farm),
          climate: climate || undefined,
          water_availability: farm.water_availability || undefined,
        }),
      });
      FS.state.compatibility[farm.id] = {
        results: body.results || [],
        signature,
        fetchedAt: Date.now(),
      };
      return body.results || [];
    } catch (error) {
      s.compatError = error.message || "compatibility failed";
      return cached?.results || null;
    } finally {
      s.compatLoading = false;
    }
  }

  function compatibilityFor(cropId) {
    const farm = FS.activeFarm();
    if (!farm) return null;
    const cached = FS.state.compatibility[farm.id];
    if (!cached) return null;
    return cached.results.find((item) => item.crop_id === cropId) || null;
  }

  // ------------------------------------------------------------------
  // Filtering and grid
  // ------------------------------------------------------------------
  function filteredCrops() {
    const query = s.query.trim().toLowerCase();
    return (FS.state.crops || []).filter((crop) => {
      if (s.role && crop.role !== s.role) return false;
      if (s.season && crop.cycle !== s.season) return false;
      if (s.water && crop.water_demand !== s.water) return false;
      if (s.salinity && crop.salinity_class !== s.salinity) return false;
      if (!query) return true;
      const haystack = [crop.name, crop.name_ar, crop.family, crop.role, crop.cycle]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  function render() {
    const grid = $("crops-grid");
    if (!grid) return;
    const farm = FS.activeFarm();
    const noFarm = $("crops-no-farm");
    if (noFarm) noFarm.hidden = Boolean(farm);
    const layout = document.querySelector(".crops-layout");
    if (layout) layout.classList.toggle("has-detail", Boolean(s.selected));

    const crops = filteredCrops();
    const count = $("crops-count");
    if (count) count.textContent = t("px.crops.results", { count: crops.length });

    if (!FS.state.crops) {
      grid.innerHTML = `<div class="empty-state"><div class="loading-spinner" aria-hidden="true"></div><p class="small muted">${esc(
        t("common.loading")
      )}</p></div>`;
      return;
    }
    if (!crops.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">🔎</div><h2>${esc(
        t("px.crops.noResults")
      )}</h2></div>`;
      return;
    }

    grid.innerHTML = crops
      .map((crop) => {
        const compat = compatibilityFor(crop.id);
        const level = compat?.level || null;
        return `<button class="crop-card${s.selected === crop.id ? " is-selected" : ""}" type="button" data-crop-id="${esc(
          crop.id
        )}">
          <div class="crop-card-head">
            <span class="crop-thumb" aria-hidden="true">${esc(FS.cropEmoji[crop.id] || "🌱")}</span>
            ${
              level
                ? `<span class="compat-pill ${FS.levelClass(level)}">${esc(t(FS.levelKey(level)))}</span>`
                : ""
            }
          </div>
          <p class="crop-name">${esc(cropName(crop))}</p>
          <p class="crop-name-en">${esc(isArabic() ? crop.name : crop.name_ar || "")}</p>
          <div class="crop-tags">
            <span class="crop-tag">${esc(FS.traitLabel("season", crop.cycle))}</span>
            <span class="crop-tag">${esc(FS.traitLabel("role", crop.role))}</span>
            <span class="crop-tag">${esc(FS.traitLabel("water", crop.water_demand))}</span>
          </div>
        </button>`;
      })
      .join("");

    if (s.selected) renderDetail();
    else {
      const panel = $("crop-detail");
      if (panel) {
        panel.hidden = true;
        panel.innerHTML = "";
      }
    }
  }

  async function renderDetail() {
    const panel = $("crop-detail");
    if (!panel) return;
    const crop = (FS.state.crops || []).find((item) => item.id === s.selected);
    if (!crop) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    panel.hidden = false;
    const compat = compatibilityFor(crop.id);
    const duration = FS.durationMonths(crop);
    const sources = FS.state.cropsMeta?.sources || [];
    const advantages = advantageKeys(crop).map((key) => `<li>${esc(t(key))}</li>`);
    const limitations = limitationKeys(crop).map((key) => `<li>${esc(t(key))}</li>`);

    panel.innerHTML = `
      <div class="crop-detail-head">
        <span class="crop-thumb" aria-hidden="true">${esc(FS.cropEmoji[crop.id] || "🌱")}</span>
        <div>
          <p class="crop-detail-title">${esc(cropName(crop))}<span>${esc(crop.name)}</span></p>
          <div class="crop-tags">
            <span class="crop-tag">${esc(FS.traitLabel("season", crop.cycle))}</span>
            <span class="crop-tag">${esc(FS.traitLabel("role", crop.role))}</span>
          </div>
        </div>
        <button class="btn btn-small btn-ghost crop-detail-close" type="button" data-close-crop aria-label="${esc(
          t("px.crops.close")
        )}">✕</button>
      </div>

      ${
        compat
          ? `<div class="compat-box">
              <div class="section-head-inline" style="margin-bottom:0">
                <strong>${esc(t("px.crops.compat.title"))}</strong>
                <span class="compat-pill ${FS.levelClass(compat.level)}">${esc(t(FS.levelKey(compat.level)))}</span>
              </div>
              <p>${
                compat.score === null || compat.score === undefined
                  ? esc(t("px.common.insufficientCompat"))
                  : FS.bidi(`${FS.num(compat.score, 0)} / 100`)
              } · ${esc(
                t("px.crops.compat.basedOn", {
                  count: (compat.dimensions || []).filter((item) => item.known).length,
                })
              )}</p>
              <div class="compat-dimensions">
                ${(compat.dimensions || [])
                  .map(
                    (dimension) => `<div class="compat-dimension">
                      <div>
                        <strong>${esc(t(`px.crops.compat.dimension.${dimension.id}`))}</strong>
                        <p>${esc(reasonText(dimension))}</p>
                      </div>
                      <span class="compat-pill ${FS.levelClass(dimension.level)}">${
                        dimension.known ? esc(FS.factorLevelLabel(dimension.score)) : esc(t("common.missing"))
                      }</span>
                    </div>`
                  )
                  .join("")}
              </div>
              <p class="small muted">${esc(t("px.crops.compat.basis"))}</p>
            </div>`
          : `<p class="small muted">${esc(
              FS.activeFarm() ? t("common.loading") : t("px.crops.needFarm")
            )}</p>`
      }

      <div class="crop-trait-grid">
        ${trait(t("px.crops.trait.water"), `${FS.traitLabel("water", crop.water_demand)} (${crop.water_demand_level ?? "—"}/5)`)}
        ${trait(t("px.crops.trait.salinity"), `${FS.traitLabel("salinity", crop.salinity_class)}${crop.salinity_tolerance_ece_ds_m ? " · ECe ≤ " + FS.num(crop.salinity_tolerance_ece_ds_m, 1) : ""}`)}
        ${trait(t("px.crops.trait.heat"), `${FS.num(crop.heat_tolerance)} / 5`)}
        ${trait(t("px.crops.trait.drought"), `${FS.num(crop.drought_tolerance)} / 5`)}
        ${trait(t("px.crops.trait.duration"), duration ? t("px.crops.trait.durationValue", { months: FS.num(duration) }) : t("common.notProvided"))}
        ${trait(t("px.crops.trait.family"), crop.family || t("common.notProvided"))}
        ${trait(t("px.crops.trait.planting"), FS.monthRange(crop.planting_months))}
        ${trait(t("px.crops.trait.harvest"), FS.monthRange(crop.harvest_months))}
      </div>

      <div class="crop-list-block">
        <h4>${esc(t("px.crops.advantages"))}</h4>
        ${advantages.length ? `<ul>${advantages.join("")}</ul>` : `<p class="small muted">${esc(t("px.crops.noneDocumented"))}</p>`}
      </div>
      <div class="crop-list-block">
        <h4>${esc(t("px.crops.limitations"))}</h4>
        ${limitations.length ? `<ul>${limitations.join("")}</ul>` : `<p class="small muted">${esc(t("px.crops.noneDocumented"))}</p>`}
      </div>
      <p class="small muted">${esc(t("px.crops.derivedNote"))}</p>

      <details>
        <summary>${esc(t("px.crops.referenceNote"))}</summary>
        <p>${esc(crop.notes || t("common.notProvided"))}</p>
        <p>${esc(t("px.common.dataQuality"))}: ${esc(crop.confidence || t("common.notProvided"))}</p>
      </details>
      <details>
        <summary>${esc(t("px.crops.sources"))}</summary>
        <ul class="small muted">
          ${sources
            .map(
              (source) =>
                `<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(
                  source.name
                )}</a> — ${esc(source.used_for)}</li>`
            )
            .join("")}
        </ul>
        <p>${esc(FS.state.cropsMeta?.disclaimer || "")}</p>
      </details>
      <p class="crop-disclaimer">${esc(t("px.crops.disclaimer"))}</p>`;
  }

  function trait(label, value) {
    return `<div class="crop-trait"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function advantageKeys(crop) {
    const keys = [];
    if (["very_low", "low"].includes(crop.water_demand)) keys.push("px.crops.adv.water");
    if (["tolerant", "moderately tolerant"].includes(crop.salinity_class)) keys.push("px.crops.adv.salinity");
    if (Number(crop.heat_tolerance) >= 4) keys.push("px.crops.adv.heat");
    if (Number(crop.drought_tolerance) >= 4) keys.push("px.crops.adv.drought");
    if (crop.n_fixation || crop.role === "legume") keys.push("px.crops.adv.legume");
    if (["high", "medium"].includes(crop.soil_cover)) keys.push("px.crops.adv.cover");
    return keys;
  }

  function limitationKeys(crop) {
    const keys = [];
    if (["high", "very_high"].includes(crop.water_demand)) keys.push("px.crops.addLimit.water");
    if (crop.salinity_class === "sensitive") keys.push("px.crops.addLimit.salinity");
    if (Number(crop.heat_tolerance) <= 2) keys.push("px.crops.addLimit.heat");
    if (Number(crop.drought_tolerance) <= 2) keys.push("px.crops.addLimit.drought");
    if (crop.cycle === "perennial") keys.push("px.crops.addLimit.perennial");
    return keys;
  }

  function reasonText(dimension) {
    if (!dimension) return "";
    const params = dimension.params || {};
    const availability =
      params.availability && params.availability !== "unknown"
        ? t(`water_availability.${params.availability}`)
        : t("water_availability.unknown");
    const key = dimension.reason || "";
    const vars = {
      demand: FS.num(params.demand),
      cap: FS.num(params.cap),
      availability,
      ec: FS.num(params.ec, 2),
      tolerance: FS.num(params.tolerance, 1),
      count: FS.num(params.heat_days),
      total: FS.num(params.period_days),
      value: FS.num(params.rain_total_mm, 1),
    };
    const text = t(key, vars);
    return text === key ? dimension.level : text;
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  function bindEvents() {
    $("crops-search")?.addEventListener("input", (event) => {
      window.clearTimeout(s.searchTimer);
      const value = event.target.value;
      s.searchTimer = window.setTimeout(() => {
        s.query = value;
        render();
      }, 140);
    });
    [
      ["crops-filter-role", "role"],
      ["crops-filter-season", "season"],
      ["crops-filter-water", "water"],
      ["crops-filter-salinity", "salinity"],
    ].forEach(([id, key]) => {
      $(id)?.addEventListener("change", (event) => {
        s[key] = event.target.value;
        render();
      });
    });
    $("crops-grid")?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-crop-id]");
      if (!card) return;
      const id = card.getAttribute("data-crop-id");
      s.selected = s.selected === id ? null : id;
      render();
      if (s.selected && window.matchMedia("(max-width: 1080px)").matches) {
        $("crop-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    $("crop-detail")?.addEventListener("click", (event) => {
      if (!event.target.closest("[data-close-crop]")) return;
      s.selected = null;
      render();
    });
    FS.on("viewchange", async ({ view }) => {
      if (view !== "crops") return;
      if (!FS.state.crops) await ensureCrops();
      render();
      if (FS.activeFarm()) {
        await getCompatibility(false);
        render();
      }
    });
    FS.on("farmchange", async () => {
      s.selected = s.selected || null;
      if (FS.state.view === "crops") {
        render();
        if (FS.activeFarm()) {
          await getCompatibility(false);
          render();
        }
      }
    });
    FS.on("climatechange", () => {
      // A newer climate context can change the compatibility signature.
      if (FS.state.view === "crops" && FS.activeFarm()) {
        getCompatibility(false).then(() => render());
      }
    });
  }

  async function init() {
    bindEvents();
    await ensureCrops();
    render();
    if (FS.state.view === "crops" && FS.activeFarm()) {
      getCompatibility(false).then(() => render());
    }
  }

  function rerender() {
    render();
  }

  FS.crops = {
    init,
    render,
    rerender,
    ensureCrops,
    getCompatibility,
    compatibilityFor,
    filteredCrops,
  };
})();
