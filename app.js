(function () {
  "use strict";

  const STORAGE_KEY = "blueprintCompact.settings";
  const LANGUAGE_KEY = "blueprintCompact.language";

  const defaultSettings = {
    includeNodeName: true,
    includeNodeType: true,
    includeNodeProperties: true,
    includeComments: true,
    includePosition: false,
    includeGuid: false,
    includePinName: true,
    includePinType: true,
    includeDefaultValue: true,
    includeExecConnections: true,
    includeDataConnections: true,
    includeAiInstructions: true,
  };

  const presets = {
    compact: {
      includeNodeProperties: true,
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
      includeAiInstructions: true,
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
    sourceInput: null,
    previewTruncated: false,
    busy: false,
    graph: null,
    settings: { ...defaultSettings },
    preset: "standard",
    format: "compact-json",
    output: "",
    clipboardStatus: "ready",
  };

  const elements = {};
  let messageTimer = null;
  let activeWorker = null;
  let conversionId = 0;
  let rejectConversion = null;

  function collectElements() {
    elements.emptyState = document.getElementById("empty-state");
    elements.resultState = document.getElementById("result-state");
    elements.pasteZone = document.getElementById("paste-zone");
    elements.pasteButton = document.getElementById("paste-button");
    elements.repeatConvertButton = document.getElementById("repeat-convert-button");
    elements.copyButton = document.getElementById("copy-button");
    elements.downloadButton = document.getElementById("download-button");
    elements.presetSelect = document.getElementById("preset-select");
    elements.formatButtons = [...document.querySelectorAll("[data-format]")];
    elements.formatSwitch = document.querySelector(".format-switch");
    elements.outputSection = document.querySelector(".output-section");
    elements.actionStatus = document.getElementById("action-status");
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
    elements.fileInput = document.getElementById("file-input");
    elements.busyStatus = document.getElementById("busy-status");
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
    elements.formatSwitch?.setAttribute("aria-label", state.language === "ja" ? "出力形式" : "Output format");
    if (state.graph) {
      state.clipboardStatus = "changed";
      updateOutput();
    }
    renderActionStatus();
    showParseWarning();
    savePreferences();
  }

  function syncControls() {
    elements.presetSelect.value = state.preset;
    elements.presetSelect.querySelector('option[value="custom"]').hidden = state.preset !== "custom";
    for (const button of elements.formatButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.format === state.format));
    }
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
    state.output = BlueprintCompactExporter.exportByFormat(filtered, state.format, {
      language: state.language,
      includeAiInstructions: state.settings.includeAiInstructions,
    });
    const resultSize = outputBytes(state.output);
    const sourceSize = state.graph.metadata.sourceSize;
    const reduction = sourceSize ? (1 - resultSize / sourceSize) * 100 : 0;

    const actor = state.graph.metadata.graphType === "Actor";
    document.documentElement.dataset.contentKind = actor ? "actor" : "graph";
    elements.nodeCount.textContent = state.graph.metadata.nodeCount || 0;
    document.getElementById("detected-kind").textContent = translatedMessage(
      actor ? "Actorの構成を読み取りました" : `${state.graph.metadata.graphType} ノードを検出`,
      actor ? "Actor configuration detected" : `${state.graph.metadata.graphType} nodes detected`
    );
    elements.pinCount.textContent = state.graph.metadata.pinCount || 0;
    elements.connectionCount.textContent = state.graph.metadata.connectionCount || 0;
    if (actor) {
      document.getElementById("actor-counts").textContent = translatedMessage(
        `${state.graph.metadata.actorCount} Actor / ${state.graph.metadata.objectCount} Object / ${state.graph.metadata.instanceCount.toLocaleString()} インスタンス行`,
        `${state.graph.metadata.actorCount} Actors / ${state.graph.metadata.objectCount} Objects / ${state.graph.metadata.instanceCount.toLocaleString()} instance rows`
      );
    }
    elements.sourceSize.textContent = formatBytes(sourceSize);
    elements.outputSize.textContent = formatBytes(resultSize);
    elements.reductionValue.textContent = reduction >= 0
      ? `${reduction.toFixed(1)}%`
      : `+${Math.abs(reduction).toFixed(1)}%`;
    elements.outputPreview.textContent = state.output.slice(0, 100000);
    document.getElementById("output-truncated").hidden = state.output.length <= 100000;
    elements.sourcePreview.textContent = state.rawText + (state.previewTruncated ? translatedMessage(
      "\n…表示は先頭部分のみです。全件は「元データを保存」から確認できます。",
      "\n…Preview truncated. Save the original data to inspect every row."
    ) : "");
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

  function renderActionStatus() {
    if (!elements.actionStatus) return;
    const messages = {
      ready: [
        "クリックすると、現在のクリップボード内容で置き換わります。",
        "Click to replace this result with the current clipboard contents.",
      ],
      copied: [
        `${state.format === "markdown" ? "Markdown" : "JSON"}としてクリップボードにコピー済みです。`,
        `Copied as ${state.format === "markdown" ? "Markdown" : "JSON"} to the clipboard.`,
      ],
      changed: [
        "出力を更新しました。必要なら下のボタンでコピーしてください。",
        "The output changed. Copy it with the button below when ready.",
      ],
    };
    const [ja, en] = messages[state.clipboardStatus] || messages.ready;
    elements.actionStatus.textContent = translatedMessage(ja, en);
  }

  function showParseWarning() {
    const count = state.graph?.metadata.warningCount || 0;
    if (!count) {
      elements.parseWarning.hidden = true;
      return;
    }
    elements.parseWarning.textContent = state.graph.metadata.graphType === "Actor" ? translatedMessage(
      `${count}件の確認事項があります。未解析の行: ${state.graph.metadata.ignoredLines}、連続していない配列: ${state.graph.metadata.irregularArrays}。完全な内容は元データも確認してください。`,
      `${count} warnings: ${state.graph.metadata.ignoredLines} unparsed lines and ${state.graph.metadata.irregularArrays} non-contiguous arrays. Consult the original data for completeness.`
    ) : translatedMessage(
      `${state.graph.metadata.nodeCount}ノードを検出しました。確認事項 ${count}件：未解決の接続・参照、未検証の汎用ノード、または読み取り対象外のオブジェクトがあります。部分コピーや未対応形式の可能性があります。出力のmetadataも確認してください。`,
      `${state.graph.metadata.nodeCount} nodes detected with ${count} warnings: unresolved links/references, unverified generic nodes, or skipped objects. This may be a partial selection or unsupported format. Check the output metadata.`
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

  function setBusy(busy, progress = null) {
    state.busy = busy;
    document.getElementById("conversion-progress").hidden = !busy;
    document.getElementById("cancel-conversion").disabled = false;
    document.querySelectorAll("[data-file-button], #paste-button, #repeat-convert-button, #copy-button, #download-button").forEach((button) => { button.disabled = busy; });
    elements.busyStatus.textContent = translatedMessage("読み取り・変換中", "Reading and converting") + (progress === null ? "…" : `… ${progress}%`);
  }

  function parseInput(input) {
    if (!window.Worker) return Promise.reject(new Error("WORKER_UNAVAILABLE"));
    return new Promise((resolve, reject) => {
      rejectConversion = reject;
      const worker = new Worker("conversion-worker.js");
      activeWorker = worker;
      worker.onmessage = ({ data }) => {
        if (data.progress !== undefined) { setBusy(true, data.progress); return; }
        worker.terminate();
        activeWorker = null;
        rejectConversion = null;
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      };
      worker.onerror = () => {
        worker.terminate();
        activeWorker = null;
        rejectConversion = null;
        reject(new Error("WORKER_UNAVAILABLE"));
      };
      worker.postMessage(input instanceof File ? { file: input } : { text: input });
    });
  }

  async function handleBlueprintText(input, { autoCopy = false, feedbackButton = null } = {}) {
    if (state.busy) return false;
    const id = ++conversionId;
    setBusy(true);
    try {
      const { graph, sourcePreview, previewTruncated } = await parseInput(input);
      if (id !== conversionId) return false;
      document.getElementById("cancel-conversion").disabled = true;
      state.rawText = sourcePreview;
      state.sourceInput = input;
      state.previewTruncated = previewTruncated;
      state.graph = graph;
      hideMessage();
      elements.emptyState.hidden = true;
      elements.resultState.hidden = false;
      closeDisclosures();
      updateOutput();
      showParseWarning();
      state.clipboardStatus = "ready";
      if (autoCopy) {
        const copied = await copyText(state.output, feedbackButton || elements.copyButton);
        state.clipboardStatus = copied ? "copied" : "ready";
      }
      renderActionStatus();
      // Keep the next conversion button visible after repeated use.
      return true;
    } catch (error) {
      if (error.message === "CANCELLED") return false;
      if (error.message === "WORKER_UNAVAILABLE") showMessage(
        "処理を開始できませんでした。公開サイト、またはHTTPサーバーから開いてください。",
        "Could not start processing. Open the published site or serve this folder over HTTP."
      );
      else showMessage(
        "データを読み取れませんでした。Blueprint・Material・PCGのノード、またはレベル上のActorをコピーし、途切れていないテキストを使用してください。ファイルはUTF-8形式にしてください。",
        "Could not read the data. Use complete Blueprint, Material, PCG node text or level Actor clipboard text. Files must use UTF-8 encoding."
      );
      return false;
    } finally {
      if (id === conversionId) setBusy(false);
    }
  }

  async function convertFromClipboard(button) {
    if (!navigator.clipboard?.readText) {
      showMessage(
        "このブラウザではボタンから読み取れません。Ctrl + V で貼り付けてください。",
        "Clipboard access is unavailable here. Paste with Ctrl + V instead."
      );
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        showMessage(
          "クリップボードが空です。Unreal EngineでノードかActorをコピーしてください。",
          "The clipboard is empty. Copy nodes or Actors in Unreal Engine first."
        );
        return;
      }
      await handleBlueprintText(text, { autoCopy: true, feedbackButton: button });
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
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("COPY_FAILED");
      }
      if (button) {
        button.classList.add("is-copied");
        window.setTimeout(() => button.classList.remove("is-copied"), 1500);
      }
      return true;
    } catch (_error) {
      showMessage(
        "コピーできませんでした。下のプレビューから手動でコピーしてください。",
        "Copy failed. Use the preview below to copy manually."
      );
      return false;
    }
  }

  async function copyCurrentOutput() {
    if (!state.graph) return;
    const copied = await copyText(state.output, elements.copyButton);
    if (copied) {
      state.clipboardStatus = "copied";
      renderActionStatus();
    }
  }

  function downloadJson() {
    if (!state.graph) return;
    const filtered = BlueprintCompactExporter.filterGraph(state.graph, state.settings, state.preset);
    const content = state.format === "compact-json"
      ? BlueprintCompactExporter.exportCompactJson(filtered, {
          language: state.language,
          includeAiInstructions: state.settings.includeAiInstructions,
        })
      : BlueprintCompactExporter.exportPrettyJson(filtered, {
          language: state.language,
          includeAiInstructions: state.settings.includeAiInstructions,
        });
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
    for (const button of document.querySelectorAll("[data-file-button]")) {
      button.addEventListener("click", () => elements.fileInput.click());
    }
    elements.fileInput.addEventListener("change", () => {
      const file = elements.fileInput.files[0];
      elements.fileInput.value = "";
      if (file) handleBlueprintText(file, { autoCopy: true });
    });
    document.getElementById("cancel-conversion").addEventListener("click", () => {
      conversionId++;
      activeWorker?.terminate();
      activeWorker = null;
      rejectConversion?.(new Error("CANCELLED"));
      rejectConversion = null;
      setBusy(false);
      showMessage("処理を中止しました。", "Conversion cancelled.");
    });
    document.getElementById("save-source").addEventListener("click", () => {
      if (!state.sourceInput) return;
      const blob = state.sourceInput instanceof File ? state.sourceInput : new Blob([state.sourceInput], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "unreal-source.txt";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    for (const button of elements.languageButtons) {
      button.addEventListener("click", () => setLanguage(button.dataset.languageButton));
    }

    document.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      elements.pasteZone.classList.add("is-receiving");
      window.setTimeout(() => elements.pasteZone.classList.remove("is-receiving"), 120);
      handleBlueprintText(text, {
        autoCopy: true,
        feedbackButton: elements.repeatConvertButton || elements.pasteButton,
      });
    });

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && state.graph) {
        event.preventDefault();
        copyCurrentOutput();
      }
    });

    elements.pasteButton.addEventListener("click", () => convertFromClipboard(elements.pasteButton));
    elements.repeatConvertButton.addEventListener("click", () => convertFromClipboard(elements.repeatConvertButton));
    elements.copyButton.addEventListener("click", copyCurrentOutput);
    elements.downloadButton.addEventListener("click", downloadJson);

    elements.presetSelect.addEventListener("change", () => {
      state.preset = elements.presetSelect.value;
      if (presets[state.preset]) state.settings = { ...presets[state.preset] };
      state.clipboardStatus = "changed";
      updateOutput();
      renderActionStatus();
    });

    for (const button of elements.formatButtons) {
      button.addEventListener("click", () => {
        state.format = button.dataset.format;
        state.clipboardStatus = "changed";
        updateOutput();
        renderActionStatus();
      });
    }

    for (const input of elements.settingInputs) {
      input.addEventListener("change", () => {
        state.settings[input.dataset.setting] = input.checked;
        state.preset = "custom";
        state.clipboardStatus = "changed";
        updateOutput();
        renderActionStatus();
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
