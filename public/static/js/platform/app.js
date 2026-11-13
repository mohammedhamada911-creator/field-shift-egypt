/* Field Shift Egypt — application boot and cross-section coordination. */
(function () {
  "use strict";

  const FS = (window.FieldShift = window.FieldShift || {});
  const $ = (id) => document.getElementById(id);
  const t = (key, vars) => window.FieldShiftI18n.t(key, vars);
  const esc = (value) => FS.esc(value);

  function addDeveloperCredits() {
    document.querySelectorAll(".view[data-view]").forEach((view) => {
      const credit = document.createElement("p");
      credit.className = "developer-credit";
      credit.textContent = "Developed by Muhammad Yamany";
      view.append(credit);
    });
  }

  async function loadGovernorates() {
    try {
      const body = await FS.api("/api/governorates");
      FS.state.governorates = body.governorates || [];
    } catch (_error) {
      FS.state.governorates = [];
    }
  }

  function updateSourceCells() {
    const farm = FS.activeFarm();
    const climate = farm ? FS.state.climate[farm.id] : null;
    const satellite = farm ? FS.state.satellite[farm.id] : null;
    const powerCell = $("source-power-latest");
    if (powerCell) {
      if (climate?.data?.period) {
        powerCell.innerHTML = `${esc(t("px.sources.observedAt", {
          date: FS.date(climate.data.period.last_observation),
        }))}<br><span class="small muted">${esc(
          t("px.sources.retrievedAt", { date: FS.dateTime(new Date(climate.fetchedAt).toISOString()) })
        )}</span>`;
      } else {
        powerCell.textContent = t("px.sources.latestLive");
      }
    }
    const note = $("sources-live-note");
    if (note) {
      note.hidden = Boolean(climate?.data);
    }
    const gibsCell = $("source-gibs-latest");
    if (gibsCell) {
      const sources = satellite?.payload?.sources || [];
      const dates = sources.map((source) => source.gibs_imagery_date).filter(Boolean).sort();
      gibsCell.textContent = dates.length ? FS.date(dates[dates.length - 1]) : "—";
    }
    const cmrCell = $("source-cmr-latest");
    if (cmrCell) {
      const sources = satellite?.payload?.sources || [];
      const dates = sources
        .map((source) => source.cmr?.latest?.time_start)
        .filter(Boolean)
        .sort();
      cmrCell.textContent = dates.length ? FS.date(dates[dates.length - 1]) : "—";
    }
  }

  function rerenderAll() {
    FS.ui.renderFarmContext();
    FS.farm.rerender();
    FS.climate.rerender();
    FS.crops.rerender();
    FS.rotation.rerender();
    FS.plan.rerender();
    updateSourceCells();
  }

  function bindGlobalEvents() {
    document.addEventListener("fieldshift:languagechange", () => {
      rerenderAll();
    });
    FS.on("farmchange", () => {
      FS.ui.renderFarmContext();
      updateSourceCells();
    });
    FS.on("viewchange", ({ view }) => {
      if (view === "help") updateSourceCells();
    });
    FS.on("climatechange", updateSourceCells);
    FS.on("satellitechange", updateSourceCells);
    document.querySelectorAll("[data-farm-context]").forEach((block) => {
      block.addEventListener("click", (event) => {
        if (event.target.closest("[data-go-view]")) FS.ui.renderFarmContext();
      });
    });
  }

  async function boot() {
    const notice = $("global-notice");
    try {
      await window.FieldShiftI18n.ready();
    } catch (_error) {
      if (notice) {
        notice.hidden = false;
        notice.textContent =
          "تعذّر تحميل نصوص الواجهة. / Interface text could not be loaded.";
      }
    }

    FS.initState();
    addDeveloperCredits();
    await loadGovernorates();

    FS.ui.init();
    FS.farm.init();
    FS.climate.init();
    await FS.crops.init();
    FS.rotation.init();
    FS.plan.init();
    bindGlobalEvents();
    updateSourceCells();

    if (FS.state.view === "climate") {
      const farm = FS.activeFarm();
      if (farm && !FS.state.climate[farm.id]) FS.climate.load(false);
    }
    if (FS.state.view === "help") updateSourceCells();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
