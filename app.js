(function () {
  "use strict";

  const STORAGE_KEY = "blueprintCompact.settings";
  const LANGUAGE_KEY = "blueprintCompact.language";

  const defaultSettings = {
    includeNodeName: true,
    includeNodeType: true,
    includeComments: true,
    includePosition: false,
    includeGuid: false,
    includePinName: true,
    includePinType: true,
    includeDefaultValue: true,
    includeExecConnections: true,
    includeDataConnections: true,
  };

  const presets = {
    compact: {
      includeNodeName: false,
      includeNodeType: true,
      includeComments: false,
      includePosition: false,
      includeGuid: false,
      includePinName: true,
      includePinType: false,
      includeDefaultValue: true,
      includeExecConnections: true,
      includeDataConnections: true,
    },
    standard: { ...defaultSettings },
    full: {
      ...defaultSettings,
      includePosition: true,
      includeGuid: true,
    },
  };

  const state = {
    language: "ja",
    rawText: "",
    graph: null,
    settings: { ...defaultSettings },
    preset: "standard",
    format: "compact-json",
    output: "",
  };

  const elements = {};
  let messageTimer = null;

  function collectElements() {
    elements.emptyState = document.getElementById("empty-state");
    elements.resultState = document.getElementById("result-state");
    elements.pasteZone = document.getElementById("paste-zone");
    elements.pasteButton = document.getElementById("paste-button");
    elements.copyButton = document.getElementById("copy-button");
    elements.markdownButton = document.getElementById("markdown-button");
    elements.downloadButton = document.getElementById("download-button");
    elements.presetSelect = document.getElementById("preset-select");
    elements.formatSelect = document.getElementById("format-select");
    elements.nodeCount = document.getElementById("node-count");
    elements.pinCount = document.getElementById("pin-count");
    elements.connectionCount = document.getElementById("connection-count");
    elements.sourceSize = document.getElementById("source-size");
    elements.outputSize = document.getElementById("output-size");
    elements.reductionValue = document.getElementById("reduction-value");
    elements.outputPreview = document.getElementById("output-preview");
    elements.sourcePreview = document.getElementById("source-preview");
    elements.message = document.getElementById("app-message");
    elements.parseWarning = document.getElementById("parse-warning");
    elements.settingInputs = [...document.querySelectorAll("[data-setting]")];
    elements.languageButtons = [...document.querySelectorAll("[data-language-button]")];
    elements.disclosureButtons = [...document.querySelectorAll(".disclosure-button")];
  }

  function loadPreferences() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (_error) {
      saved = {};
    }

    const savedLanguage = localStorage.getItem(LANGUAGE_KEY) || saved.language;
    state.language = savedLanguage === "en" || savedLanguage === "ja"
      ? savedLanguage
      : navigator.language.toLowerCase().startsWith("ja")
        ? "ja"
        : "en";
    state.preset = ["compact", "standard", "full", "custom"].includes(saved.preset)
      ? saved.preset
      : "standard";
    state.format = ["compact-json", "pretty-json", "markdown"].includes(saved.format)
      ? saved.format
      : "compact-json";
    state.settings = { ...defaultSettings, ...(saved.settings || {}) };
  }

  function savePreferences() {
    const payload = {
      language: state.language,
      preset: state.preset,
      format: state.format,
      settings: state.settings,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      localStorage.setItem(LANGUAGE_KEY, state.language);
    } catch (_error) {
      // The application remains usable when storage is unavailable.
    }
  }

  function setLanguage(language) {
    state.language = language === "en" ? "en" : "ja";
    document.documentElement.dataset.language = state.language;
    document.documentElement.lang = state.language;
    for (const button of elements.languageButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.languageButton === state.language));
    }
    elements.presetSelect.setAttribute("aria-label", state.language === "ja" ? "プリセット" : "Preset");
    elements.formatSelect.setAttribute("aria-label", state.language === "ja" ? "形式" : "Format");
    showParseWarning();
    savePreferences();
  }

  function syncControls() {
    elements.presetSelect.value = state.preset;
    elements.presetSelect.querySelector('option[value="custom"]').hidden = state.preset !== "custom";
    elements.formatSelect.value = state.format;
    for (const input of elements.settingInputs) {
      input.checked = Boolean(state.settings[input.dataset.setting]);
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function outputBytes(text) {
    return new TextEncoder().encode(text).length;
  }

  function updateOutput() {
    if (!state.graph) return;
    const filtered = BlueprintCompactExporter.filterGraph(state.graph, state.settings, state.preset);
    state.output = BlueprintCompactExporter.exportByFormat(filtered, state.format);
    const resultSize = outputBytes(state.output);
    const sourceSize = state.graph.metadata.sourceSize;
    const reduction = sourceSize ? (1 - resultSize / sourceSize) * 100 : 0;

    elements.nodeCount.textContent = state.graph.metadata.nodeCount;
    elements.pinCount.textContent = state.graph.metadata.pinCount;
    elements.connectionCount.textContent = state.graph.metadata.connectionCount;
    elements.sourceSize.textContent = formatBytes(sourceSize);
    elements.outputSize.textContent = formatBytes(resultSize);
    elements.reductionValue.textContent = reduction >= 0
      ? `${reduction.toFixed(1)}%`
      : `+${Math.abs(reduction).toFixed(1)}%`;
    elements.outputPreview.textContent = state.output;
    elements.sourcePreview.textContent = state.rawText;
    syncControls();
    savePreferences();
  }

  function translatedMessage(ja, en) {
    return state.language === "ja" ? ja : en;
  }

  function showMessage(ja, en, timeout = 0) {
    if (messageTimer) window.clearTimeout(messageTimer);
    elements.message.textContent = translatedMessage(ja, en);
    elements.message.hidden = false;
    if (timeout) {
      messageTimer = window.setTimeout(() => {
        elements.message.hidden = true;
      }, timeout);
    }
  }

  function hideMessage() {
    if (messageTimer) window.clearTimeout(messageTimer);
    elements.message.hidden = true;
  }

  function showParseWarning() {
    const count = state.graph?.metadata.warningCount || 0;
    if (!count) {
      elements.parseWarning.hidden = true;
      return;
    }
    elements.parseWarning.textContent = translatedMessage(
      `${state.graph.metadata.nodeCount}ノードを検出しました。${count}件の参照を完全には解析できませんでした。`,
      `${state.graph.metadata.nodeCount} nodes detected. ${count} references could not be fully parsed.`
    );
    elements.parseWarning.hidden = false;
  }

  function closeDisclosures() {
    for (const button of elements.disclosureButtons) {
      button.setAttribute("aria-expanded", "false");
      button.querySelector(".disclosure-symbol").textContent = "+";
      document.getElementById(button.getAttribute("aria-controls")).hidden = true;
    }
  }

  function handleBlueprintText(text) {
    try {
      const graph = BlueprintCompactParser.parseBlueprintText(text);
      state.rawText = text;
      state.graph = graph;
      hideMessage();
      elements.emptyState.hidden = true;
      elements.resultState.hidden = false;
      closeDisclosures();
      updateOutput();
      showParseWarning();
    } catch (_error) {
      showMessage(
        "Blueprintノードを認識できませんでした。Unreal Engineでノードをコピーしてから貼り付けてください。",
        "Blueprint nodes could not be detected. Copy nodes in Unreal Engine and paste them again."
      );
    }
  }

  async function pasteFromClipboard() {
    if (!navigator.clipboard?.readText) {
      showMessage(
        "このブラウザではボタンから読み取れません。Ctrl + V で貼り付けてください。",
        "Clipboard access is unavailable here. Paste with Ctrl + V instead."
      );
      return;
    }

    try {
      handleBlueprintText(await navigator.clipboard.readText());
    } catch (_error) {
      showMessage(
        "クリップボードを読み取れませんでした。Ctrl + V で貼り付けてください。",
        "The clipboard could not be read. Paste with Ctrl + V instead."
      );
    }
  }

  async function copyText(text, button) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      button.classList.add("is-copied");
      window.setTimeout(() => button.classList.remove("is-copied"), 1500);
    } catch (_error) {
      showMessage(
        "コピーできませんでした。出力を確認から手動でコピーしてください。",
        "Copy failed. Open Preview Output and copy the text manually."
      );
    }
  }

  function copyCurrentOutput() {
    if (state.graph) copyText(state.output, elements.copyButton);
  }

  function copyMarkdown() {
    if (!state.graph) return;
    const filtered = BlueprintCompactExporter.filterGraph(state.graph, state.settings, state.preset);
    copyText(BlueprintCompactExporter.exportMarkdown(filtered), elements.markdownButton);
  }

  function downloadJson() {
    if (!state.graph) return;
    const filtered = BlueprintCompactExporter.filterGraph(state.graph, state.settings, state.preset);
    const content = state.format === "compact-json"
      ? BlueprintCompactExporter.exportCompactJson(filtered)
      : BlueprintCompactExporter.exportPrettyJson(filtered);
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = (state.graph.metadata.graphName || "Blueprint").replace(/[^A-Za-z0-9_-]+/g, "_");
    link.href = url;
    link.download = `${safeName}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function toggleDisclosure(button) {
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    button.querySelector(".disclosure-symbol").textContent = expanded ? "+" : "−";
    document.getElementById(button.getAttribute("aria-controls")).hidden = expanded;
  }

  function bindEvents() {
    for (const button of elements.languageButtons) {
      button.addEventListener("click", () => setLanguage(button.dataset.languageButton));
    }

    document.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      elements.pasteZone.classList.add("is-receiving");
      window.setTimeout(() => elements.pasteZone.classList.remove("is-receiving"), 120);
      handleBlueprintText(text);
    });

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && state.graph) {
        event.preventDefault();
        copyCurrentOutput();
      }
    });

    elements.pasteButton.addEventListener("click", pasteFromClipboard);
    elements.copyButton.addEventListener("click", copyCurrentOutput);
    elements.markdownButton.addEventListener("click", copyMarkdown);
    elements.downloadButton.addEventListener("click", downloadJson);

    elements.presetSelect.addEventListener("change", () => {
      state.preset = elements.presetSelect.value;
      if (presets[state.preset]) state.settings = { ...presets[state.preset] };
      updateOutput();
    });

    elements.formatSelect.addEventListener("change", () => {
      state.format = elements.formatSelect.value;
      updateOutput();
    });

    for (const input of elements.settingInputs) {
      input.addEventListener("change", () => {
        state.settings[input.dataset.setting] = input.checked;
        state.preset = "custom";
        updateOutput();
      });
    }

    for (const button of elements.disclosureButtons) {
      button.addEventListener("click", () => toggleDisclosure(button));
    }
  }

  function initialize() {
    collectElements();
    loadPreferences();
    syncControls();
    bindEvents();
    setLanguage(state.language);
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
