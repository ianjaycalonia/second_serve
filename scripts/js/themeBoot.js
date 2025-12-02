(function applyStoredTheme() {
  try {
    var KEY = "ss_theme";
    var theme = null;
    try {
      theme = sessionStorage.getItem(KEY);
    } catch (e) {}
    if (theme !== "dark" && theme !== "light") {
      theme = "light";
    }
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    try {
      document.documentElement.setAttribute("data-theme", "light");
    } catch (_) {}
  }
})();
