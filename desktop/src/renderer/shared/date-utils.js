(function () {
  const getLocale = () => window.I18n?.getLanguage?.() || undefined;

  function formatDate(iso, options) {
    if (!iso) return "--";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "--";
    return d.toLocaleDateString(
      getLocale(),
      options || { month: "short", day: "numeric", year: "numeric" }
    );
  }

  function formatDateTime(iso, options) {
    if (!iso) return "--";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "--";
    return d.toLocaleString(
      getLocale(),
      options || { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    );
  }

  window.DateUtils = {
    getLocale,
    formatDate,
    formatDateTime,
  };
})();
