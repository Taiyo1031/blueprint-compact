(function () {
  "use strict";

  const LANGUAGE_KEY = "blueprintCompact.language";
  const buttons = [...document.querySelectorAll("[data-language-button]")];
  const saved = localStorage.getItem(LANGUAGE_KEY);
  const preferred = saved === "en" || saved === "ja"
    ? saved
    : navigator.language.toLowerCase().startsWith("ja")
      ? "ja"
      : "en";

  function setLanguage(language) {
    const value = language === "en" ? "en" : "ja";
    document.documentElement.dataset.language = value;
    document.documentElement.lang = value;
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.languageButton === value));
    }
    try {
      localStorage.setItem(LANGUAGE_KEY, value);
    } catch (_error) {
      // The guide remains usable when storage is unavailable.
    }
  }

  for (const button of buttons) {
    button.addEventListener("click", () => setLanguage(button.dataset.languageButton));
  }

  setLanguage(preferred);
})();
