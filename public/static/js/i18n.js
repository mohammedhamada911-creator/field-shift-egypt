/* Field Shift Egypt — bilingual UI layer (English first, full RTL support). */
(function () {
  "use strict";

  const STORAGE_KEY = "fieldshift.lang.v3";
  const SUPPORTED = ["ar", "en"];
  // "ar" is the default mixed Egyptian Arabic + English experience. "en" is a
  // complete English interface for international users and evaluators.
  const DEFAULT_LANG = "ar";
  let current = DEFAULT_LANG;
  let dictionary = null;
  let readyPromise = null;

  function storedLanguage() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      if (SUPPORTED.includes(value)) return value;
    } catch (_error) {
      /* storage can be unavailable in private mode */
    }
    return null;
  }

  current = storedLanguage() || DEFAULT_LANG;

  function interpolate(text, vars) {
    if (!vars) return text;
    return String(text).replace(/\{(\w+)\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
    );
  }

  function t(key, vars) {
    const pack = dictionary?.[current] || {};
    const fallback = dictionary?.en || {};
    return interpolate(pack[key] ?? fallback[key] ?? key, vars);
  }

  function language() {
    return current;
  }

  function isArabic() {
    return current === "ar";
  }

  function direction() {
    return current === "ar" ? "rtl" : "ltr";
  }

  function number(value, digits = 0) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    return new Intl.NumberFormat(current === "ar" ? "ar-EG" : "en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      numberingSystem: "latn",
    }).format(Number(value));
  }

  function date(value, options = {}) {
    if (!value) return "—";
    const iso = String(value).slice(0, 10);
    const parsed = new Date(iso + "T00:00:00");
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString(current === "ar" ? "ar-EG" : "en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      numberingSystem: "latn",
      ...options,
    });
  }

  function dateTime(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString(current === "ar" ? "ar-EG" : "en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      numberingSystem: "latn",
    });
  }

  function monthName(index, short = false) {
    return t(`month${short ? ".short" : ""}.${index}`, {});
  }

  function setDocumentLanguage() {
    document.documentElement.lang = current;
    document.documentElement.dir = direction();
    document.body?.classList.toggle("lang-ar", current === "ar");
    document.body?.classList.toggle("lang-en", current === "en");
  }

  function apply(root = document) {
    if (!dictionary) return;
    setDocumentLanguage();
    document.title = t("meta.title");

    root.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      element.textContent = t(key);
    });
    root.querySelectorAll("[data-i18n-html]").forEach((element) => {
      const key = element.getAttribute("data-i18n-html");
      element.innerHTML = t(key);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.setAttribute("placeholder", t(element.getAttribute("data-i18n-placeholder")));
    });
    root.querySelectorAll("[data-i18n-aria]").forEach((element) => {
      element.setAttribute("aria-label", t(element.getAttribute("data-i18n-aria")));
    });
    root.querySelectorAll("[data-i18n-title]").forEach((element) => {
      element.setAttribute("title", t(element.getAttribute("data-i18n-title")));
    });
    root.querySelectorAll("[data-i18n-value]").forEach((element) => {
      element.setAttribute("value", t(element.getAttribute("data-i18n-value")));
    });

    const switcher = document.getElementById("lang-switch");
    if (switcher) {
      switcher.textContent = t("lang.switch");
      switcher.setAttribute("aria-label", current === "ar" ? "Switch to English" : "التبديل إلى العربية");
    }
  }

  function setLanguage(next) {
    if (!SUPPORTED.includes(next) || next === current) return;
    current = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, current);
    } catch (_error) {
      /* language still applies for this session */
    }
    apply(document);
    document.dispatchEvent(new CustomEvent("fieldshift:languagechange", { detail: { lang: current } }));
  }

  function toggleLanguage() {
    setLanguage(current === "ar" ? "en" : "ar");
  }

  function setDictionary(payload) {
    dictionary = payload;
    return dictionary;
  }

  function load() {
    if (readyPromise) return readyPromise;
    readyPromise = fetch("/static/data/i18n.json", { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`i18n HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        dictionary = payload;
        return payload;
      });
    return readyPromise;
  }

  window.FieldShiftI18n = {
    t,
    apply,
    setLanguage,
    toggleLanguage,
    language,
    isArabic,
    direction,
    number,
    date,
    dateTime,
    monthName,
    load,
    ready: () => load().then(() => apply(document)),
  };

  // Set the direction immediately so the first paint uses the default language.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setDocumentLanguage(), { once: true });
  } else {
    setDocumentLanguage();
  }
})();
