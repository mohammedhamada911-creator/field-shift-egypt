/* Field Shift Egypt — shared interface shell: views, language, toasts. */
(function () {
  "use strict";

  const FS = (window.FieldShift = window.FieldShift || {});
  const t = (key, vars) => window.FieldShiftI18n.t(key, vars);
  const esc = (value) => FS.esc(value);

  const VIEWS = ["farm", "climate", "crops", "rotation", "plan", "help"];
  let toastTimer = null;

  function viewFromHash() {
    const raw = String(window.location.hash || "").replace(/^#\/?/, "").trim();
    return VIEWS.includes(raw) ? raw : null;
  }

  function syncLanguageButtons() {
    const lang = window.FieldShiftI18n.language();
    document.querySelectorAll("[data-lang-choice]").forEach((button) => {
      const active = button.getAttribute("data-lang-choice") === lang;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function goto(view, options = {}) {
    if (!VIEWS.includes(view)) return;
    if (FS.state.view === view && !options.force) {
      if (options.scroll !== false) window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    FS.state.view = view;
    document.querySelectorAll(".view").forEach((section) => {
      const active = section.getAttribute("data-view") === view;
      section.classList.toggle("is-active", active);
      if (active) section.removeAttribute("hidden");
      else section.setAttribute("hidden", "");
    });
    document.querySelectorAll("[data-view-link]").forEach((button) => {
      const active = button.getAttribute("data-view-link") === view;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (options.hash !== false) {
      try {
        window.history.replaceState(null, "", `#${view}`);
      } catch (_error) {
        /* file:// or restricted history — navigation still works */
      }
    }
    if (options.scroll !== false) window.scrollTo({ top: 0, behavior: "smooth" });
    FS.emit("viewchange", { view });
    document.dispatchEvent(new CustomEvent("fieldshift:viewchange", { detail: { view } }));
  }

  function toast(message, kind = "info", duration = 3200) {
    const element = document.getElementById("toast");
    if (!element) return;
    window.clearTimeout(toastTimer);
    element.textContent = message;
    element.className = `toast${kind === "error" ? " toast-error" : ""}`;
    element.hidden = false;
    toastTimer = window.setTimeout(() => {
      element.hidden = true;
    }, duration);
  }

  function notice(message, kind = "info") {
    const element = document.getElementById("global-notice");
    if (!element) return;
    if (!message) {
      element.hidden = true;
      element.textContent = "";
      return;
    }
    element.textContent = message;
    element.hidden = false;
    element.dataset.kind = kind;
  }

  function renderFarmContext() {
    const farm = FS.activeFarm();
    document.querySelectorAll("[data-farm-context]").forEach((block) => {
      if (!farm) {
        block.innerHTML = `
          <span class="context-warn">${esc(t("px.farm.notSelected"))}</span>
          <button class="btn btn-small btn-ghost" type="button" data-go-view="farm">${esc(t("nav.farm"))}</button>`;
        return;
      }
      const completeness = FS.completeness(farm);
      const gov = farm.governorate ? FS.governorateLabel(farm.governorate) : "";
      const place = [gov, farm.village].filter(Boolean).join(" · ");
      block.innerHTML = `
        <span>${esc(t("px.farm.selected"))}: <strong>${esc(FS.farmLabel(farm))}</strong></span>
        ${place ? `<span class="context-meta">${esc(place)}</span>` : ""}
        <span class="context-meta">${esc(t("px.farm.completeness.value", { done: completeness.done, total: completeness.total }))}</span>
        <button class="btn btn-small btn-ghost" type="button" data-go-view="farm">${esc(t("px.farm.switch"))}</button>`;
    });
  }

  function bindDelegatedClicks() {
    document.addEventListener("click", (event) => {
      const go = event.target.closest("[data-go-view]");
      if (go) {
        event.preventDefault();
        goto(go.getAttribute("data-go-view"));
        return;
      }
      const nav = event.target.closest("[data-view-link]");
      if (nav) {
        event.preventDefault();
        goto(nav.getAttribute("data-view-link"));
      }
    });
  }

  function bindLanguage() {
    document.querySelectorAll("[data-lang-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const language = button.getAttribute("data-lang-choice");
        window.FieldShiftI18n.setLanguage(language);
        syncLanguageButtons();
      });
    });
    document.addEventListener("fieldshift:languagechange", () => {
      syncLanguageButtons();
    });
    syncLanguageButtons();
  }

  function init() {
    bindDelegatedClicks();
    bindLanguage();
    const initial = viewFromHash() || "farm";
    goto(initial, { hash: false, scroll: false });
    renderFarmContext();
    window.addEventListener("hashchange", () => {
      const view = viewFromHash();
      if (view && view !== FS.state.view) goto(view, { hash: false });
    });
  }

  FS.ui = {
    init,
    goto,
    toast,
    notice,
    renderFarmContext,
    syncLanguageButtons,
    views: VIEWS,
  };
})();
