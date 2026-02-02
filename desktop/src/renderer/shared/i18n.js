(function () {
  const DEFAULT_LANGUAGE = "en";
  const FALLBACK_LANGUAGE = "en";
  const MISSING_PLACEHOLDER = "[MISSING] ";
  const missingLogCache = new Set();
  const STORAGE_KEY = "appLanguage";
  const localeCache = new Map();
  const listeners = new Set();
  let currentLanguage = DEFAULT_LANGUAGE;

  const normalize = (lang) => (lang === "zh" ? "zh" : "en");

  function interpolate(str, vars = {}) {
    if (!str || typeof str !== "string") return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_match, key) =>
      vars[key] != null ? String(vars[key]) : ""
    );
  }

  async function loadLocale(lang) {
    const normalized = normalize(lang);
    if (localeCache.has(normalized)) return localeCache.get(normalized);

    try {
      const res = await fetch(`./locales/${normalized}.json`, {
        cache: "no-cache",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      localeCache.set(normalized, json);
      return json;
    } catch (err) {
      console.error(`[i18n] Failed to load locale ${normalized}:`, err);
      localeCache.set(normalized, {});
      return {};
    }
  }

  function getMessage(key) {
    const langMessages = localeCache.get(currentLanguage) || {};
    const fallbackMessages = localeCache.get(FALLBACK_LANGUAGE) || {};
    return langMessages[key] ?? fallbackMessages[key] ?? null;
  }

  function t(key, vars = {}) {
    const msg = getMessage(key);
    if (!msg) {
      if (!missingLogCache.has(key)) {
        missingLogCache.add(key);
        console.warn(`[i18n] Missing translation: ${key}`);
      }
      return `${MISSING_PLACEHOLDER}${key}`;
    }
    return interpolate(msg, vars);
  }

  function applyTranslations(root = document) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      const attr = el.dataset.i18nAttr;
      const translated = t(key);
      if (!translated) return;

      if (attr) {
        el.setAttribute(attr, translated);
      } else {
        el.textContent = translated;
      }
    });
  }

  async function setLanguage(lang, options = {}) {
    const normalized = normalize(lang);
    await loadLocale(FALLBACK_LANGUAGE);
    await loadLocale(normalized);

    const next = normalized || DEFAULT_LANGUAGE;
    if (next === currentLanguage && !options.force) {
      if (options.apply !== false) {
        applyTranslations(document);
      }
      return next;
    }
    if (!options.skipPersist) {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (_) {}
    }

    currentLanguage = next;
    if (options.apply !== false) {
      applyTranslations(document);
    }
    listeners.forEach((fn) => {
      try {
        fn(next);
      } catch (_) {}
    });
    return next;
  }

  async function init(options = {}) {
    const stored = (() => {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch (_) {
        return null;
      }
    })();

    const preferredRaw =
      options.preferredLanguage ||
      stored ||
      ((navigator.language || "").toLowerCase().startsWith("zh")
        ? "zh"
        : DEFAULT_LANGUAGE);
    const preferred = normalize(preferredRaw);

    await loadLocale(FALLBACK_LANGUAGE);
    await setLanguage(preferred, { apply: options.apply !== false });
    return getLanguage();
  }

  function getLanguage() {
    return currentLanguage;
  }

  function onChange(fn) {
    if (typeof fn === "function") listeners.add(fn);
    return () => listeners.delete(fn);
  }

  window.I18n = {
    init,
    t,
    setLanguage,
    getLanguage,
    applyTranslations,
    onChange,
    normalizeLanguage: normalize,
  };
})();
