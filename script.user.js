// ==UserScript==
// @name         Crowdin Localization Tools
// @namespace    https://yuzu.kirameki.cafe/
// @version      1.1.4
// @description  A tool for translating Crowdin projects using a CSV file
// @author       Yuzu (YuzuZensai)
// @match        https://crowdin.com/editor/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/YuzuZensai/Crowdin-Localization-Tools/refs/heads/main/script.user.js
// @downloadURL  https://raw.githubusercontent.com/YuzuZensai/Crowdin-Localization-Tools/refs/heads/main/script.user.js
// @connect      github.com
// @connect      raw.githubusercontent.com
// ==/UserScript==

// Global configuration
const CONFIG = {
  defaultVisible: true,
  defaultPosition: { right: "20px", bottom: "20px" },
  windowDimensions: {
    width: "600px",
    height: "600px",
  },

  debug: true,

  // Update check
  updateCheckUrl:
    "https://raw.githubusercontent.com/YuzuZensai/Crowdin-Localization-Tools/main/data/version.json",
  autoUpdateInterval: 15 * 60 * 1000, // 15 minutes

  // Remote CSV
  remoteCSVUrl:
    "https://raw.githubusercontent.com/YuzuZensai/Crowdin-Localization-Tools/main/data/data.csv",
  allowLocalOverride: true,
  allowUrlOverride: true,

  // Crowdin editor
  textboxSelector: ".editor-panel__editor-container textarea",
  stringNumberSelector: "#file_options > li:nth-child(4) > a:nth-child(1)",
  editorSourceContainer: ".editor-current-translation-source",
  sourceStringContainer: "#source_phrase_container",

  autoSearchInterval: 1000,
  fuzzyThreshold: 0.7,

  metadata: {
    version: "1.1.4",
    repository: "https://github.com/YuzuZensai/Crowdin-Localization-Tools",
    authorGithub: "https://github.com/YuzuZensai",
  },
};

function log(type, message, data = null) {
  if (!CONFIG.debug) return;

  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[Crowdin Localization Tools][${timestamp}]`;

  switch (type.toLowerCase()) {
    case "info":
      console.log(`${prefix} ℹ️ ${message}`, data || "");
      break;
    case "warn":
      console.warn(`${prefix} ⚠️ ${message}`, data || "");
      break;
    case "error":
      console.error(`${prefix} ❌ ${message}`, data || "");
      break;
    case "success":
      console.log(`${prefix} ✅ ${message}`, data || "");
      break;
    case "debug":
      console.debug(`${prefix} 🔍 ${message}`, data || "");
      break;
  }
}

function sanitizeHTML(str) {
  if (typeof str !== "string") return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Just for good measure, remove any potential script tags, even if they're encoded
function validateCSVField(field) {
  if (typeof field !== "string") {
    return "";
  }

  field = field
    .replace(/<\s*script[^>]*>.*?<\s*\/\s*script\s*>/gi, "")
    .replace(/&lt;\s*script[^&]*&gt;.*?&lt;\/\s*script\s*&gt;/gi, "");

  // Remove potential event handlers
  field = field.replace(/\bon\w+\s*=\s*["']?[^"']*["']?/gi, "");

  // Remove data URLs
  field = field.replace(/data:[^,]*,/gi, "");

  // Remove any HTML tags
  field = field.replace(/<[^>]*>/g, "");

  return field.trim();
}

function validateCSVEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return {
    source: validateCSVField(entry.source),
    target: validateCSVField(entry.target),
    note: validateCSVField(entry.note),
    category: validateCSVField(entry.category),
  };
}

function levenshteinDistance(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function similarity(s1, s2) {
  if (s1.length === 0 || s2.length === 0) return 0;
  const longerLength = Math.max(s1.length, s2.length);
  return (longerLength - levenshteinDistance(s1, s2)) / longerLength;
}

function TranslatorTool() {
  var container;
  var translationData = [];
  var resultsDiv;
  var searchInput;
  var isDragging = false;
  var dragOffsetX = 0;
  var dragOffsetY = 0;
  var toggleButton;
  var visible = CONFIG.defaultVisible;
  var lastSearchedText = "";
  var autoSearchIntervalId = null;
  var updateLink;
  var currentCSVSource = null;
  var categoryColors = new Map();

  // Common words that shouldn't be matched individually or in pairs
  const COMMON_WORDS = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "up",
    "about",
    "into",
    "over",
    "after",
    "is",
    "are",
    "was",
    "were",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "should",
    "could",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "as",
  ]);

  function isSignificantPhrase(phrase) {
    const words = phrase.toLowerCase().split(/\s+/);
    // If it's a single word, it should be longer than 3 chars and not common
    if (words.length === 1) {
      return words[0].length > 3 && !COMMON_WORDS.has(words[0]);
    }
    // For multi-word phrases, at least one word should be significant
    return words.some((word) => word.length > 3 && !COMMON_WORDS.has(word));
  }

  function generateColorForCategory(category) {
    if (!category) return null;
    if (categoryColors.has(category)) {
      return categoryColors.get(category);
    }

    const predefinedColors = {
      UI: "#c6dbe1",
      "Unity / 3D": "#3d3d3d",
      "Trust Rank": "#e6cff2",
      "Instance Type": "#d4edbc",
      "Avatar Performance Rank": "#ffc8aa",
      "VRChat Specific": "#bfe1f6",
      Common: "#e6e6e6",
    };

    if (predefinedColors[category]) {
      categoryColors.set(category, predefinedColors[category]);
      return predefinedColors[category];
    }

    let hash = 0;
    for (let i = 0; i < category.length; i++) {
      hash = category.charCodeAt(i) + ((hash << 5) - hash);
    }

    const hue = Math.abs(hash % 360);
    const color = `hsl(${hue}, 65%, 55%)`;
    categoryColors.set(category, color);
    return color;
  }

  function isColorBright(color) {
    // Convert hex to RGB
    let r, g, b;
    if (color.startsWith("#")) {
      const hex = color.replace("#", "");
      r = parseInt(hex.substr(0, 2), 16);
      g = parseInt(hex.substr(2, 2), 16);
      b = parseInt(hex.substr(4, 2), 16);
    } else if (color.startsWith("hsl")) {
      // Convert HSL to RGB
      const matches = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
      if (matches) {
        const h = parseInt(matches[1]) / 360;
        const s = parseInt(matches[2]) / 100;
        const l = parseInt(matches[3]) / 100;

        if (s === 0) {
          r = g = b = l * 255;
        } else {
          const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
          };

          const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
          const p = 2 * l - q;
          r = hue2rgb(p, q, h + 1 / 3) * 255;
          g = hue2rgb(p, q, h) * 255;
          b = hue2rgb(p, q, h - 1 / 3) * 255;
        }
      } else {
        r = g = b = 128; // Fallback to gray if parsing fails
      }
    } else {
      r = g = b = 128; // Fallback to gray
    }

    // Convert RGB values to 0-1 range
    const rr = r / 255;
    const gg = g / 255;
    const bb = b / 255;

    // Calculate relative luminance (WCAG 2.0)
    const luminance =
      0.2126 *
        (rr <= 0.03928 ? rr / 12.92 : Math.pow((rr + 0.055) / 1.055, 2.4)) +
      0.7152 *
        (gg <= 0.03928 ? gg / 12.92 : Math.pow((gg + 0.055) / 1.055, 2.4)) +
      0.0722 *
        (bb <= 0.03928 ? bb / 12.92 : Math.pow((bb + 0.055) / 1.055, 2.4));

    // Calculate YIQ
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;

    // Combine both methods
    // For pastel colors (high luminance but moderate YIQ)
    if (luminance > 0.7) {
      return true; // Definitely bright
    } else if (luminance > 0.5 && yiq > 128) {
      return true; // Moderately bright and good YIQ
    }
    return false;
  }

  function createCategoryChip(category) {
    if (!category) return "";

    const color = generateColorForCategory(category);
    const textColor = isColorBright(color) ? "#000000" : "#ffffff";
    return `<span style="
      display: inline-block;
      padding: 2px 8px;
      margin: 2px;
      border-radius: 12px;
      font-size: 11px;
      background-color: ${color};
      color: ${textColor};
      white-space: nowrap;
      ">${category}</span>`;
  }

  function init() {
    log("info", "Initializing translator tool");
    createUI();
    createToggleButton();
    setupEventListeners();
    setupExternalTextboxListener();
    setupCrowdinEditorListener();

    const sourceToggle = document.querySelector("#source-toggle");
    if (!sourceToggle || !sourceToggle.checked) {
      fetchRemoteCSV(CONFIG.remoteCSVUrl);
    }

    setInterval(() => {
      log("info", "Running automatic update check");
      checkForUpdates();
    }, CONFIG.autoUpdateInterval);

    setTimeout(() => {
      checkForEditorContent(true);
    }, 2000);

    log(
      "success",
      "Crowdin Localization Tools version " +
        CONFIG.metadata.version +
        " by " +
        CONFIG.metadata.authorGithub +
        " initialized successfully"
    );
  }

  function createUI() {
    log("info", "Creating UI elements");

    // Container
    container = document.createElement("div");
    container.id = "translator-tool";
    container.style.position = "fixed";
    container.style.bottom = CONFIG.defaultPosition.bottom;
    container.style.right = CONFIG.defaultPosition.right;
    container.style.width = CONFIG.windowDimensions.width;
    container.style.height = CONFIG.windowDimensions.height;
    container.style.backgroundColor = "#fff";
    container.style.border = "1px solid #e0e0e0";
    container.style.borderRadius = "8px";
    container.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    container.style.zIndex = "9999";
    container.style.display = CONFIG.defaultVisible ? "flex" : "none";
    container.style.flexDirection = "column";
    container.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

    // Header
    var header = document.createElement("div");
    header.style.padding = "12px 16px";
    header.style.backgroundColor = "#f8f9fa";
    header.style.borderBottom = "1px solid #e0e0e0";
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.cursor = "move";

    var title = document.createElement("h3");
    title.textContent = "Crowdin Localization Tools";
    title.style.margin = "0";
    title.style.fontSize = "16px";
    title.style.fontWeight = "600";
    title.style.color = "#1a73e8";

    var closeButton = document.createElement("button");
    closeButton.textContent = "×";
    closeButton.style.border = "none";
    closeButton.style.background = "none";
    closeButton.style.cursor = "pointer";
    closeButton.style.fontSize = "24px";
    closeButton.style.color = "#666";
    closeButton.style.padding = "0 4px";
    closeButton.style.lineHeight = "1";
    closeButton.addEventListener("click", function () {
      log("info", "Close button clicked");
      toggleVisibility();
    });

    header.appendChild(title);
    header.appendChild(closeButton);
    container.appendChild(header);

    // Tab menu
    var tabMenu = document.createElement("div");
    tabMenu.style.padding = "0 16px";
    tabMenu.style.backgroundColor = "#f8f9fa";
    tabMenu.style.borderBottom = "1px solid #e0e0e0";
    tabMenu.style.display = "flex";
    tabMenu.style.gap = "16px";

    var mainTab = createTab("Translator", true);
    var settingsTab = createTab("Settings", false);

    tabMenu.appendChild(mainTab);
    tabMenu.appendChild(settingsTab);
    container.appendChild(tabMenu);

    // Content containers
    var mainContent = createMainContent();
    var settingsContent = createSettingsContent();

    container.appendChild(mainContent);
    container.appendChild(settingsContent);

    // Footer
    var footer = createFooter();
    container.appendChild(footer);

    // Inject
    try {
      document.body.appendChild(container);
      log("success", "Main container added to document body");
    } catch (error) {
      log("error", "Error appending container to body:", error);
    }

    setupDraggable(header);

    log("success", "UI elements created successfully");
  }

  function createTab(text, isActive) {
    var tab = document.createElement("button");
    tab.textContent = text;
    tab.style.padding = "12px 16px";
    tab.style.border = "none";
    tab.style.background = "none";
    tab.style.borderBottom = isActive
      ? "2px solid #1a73e8"
      : "2px solid transparent";
    tab.style.color = isActive ? "#1a73e8" : "#666";
    tab.style.cursor = "pointer";
    tab.style.fontSize = "14px";
    tab.style.fontWeight = "500";
    tab.style.transition = "all 0.2s ease";

    tab.addEventListener("click", function () {
      switchTab(text.toLowerCase());
    });

    return tab;
  }

  function createMainContent() {
    var content = document.createElement("div");
    content.id = "translator-main-content";
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.flexGrow = "1";
    content.style.padding = "16px";
    content.style.height = "100%";
    content.style.boxSizing = "border-box";
    content.style.minHeight = "0";

    // Search container
    var searchContainer = document.createElement("div");
    searchContainer.style.position = "relative";
    searchContainer.style.marginBottom = "16px";
    searchContainer.style.flexShrink = "0";

    // Current string label
    var currentStringLabel = document.createElement("div");
    currentStringLabel.style.fontSize = "12px";
    currentStringLabel.style.color = "#666";
    currentStringLabel.style.marginBottom = "4px";
    currentStringLabel.style.padding = "4px";
    currentStringLabel.style.backgroundColor = "#f8f9fa";
    currentStringLabel.style.borderRadius = "4px";
    currentStringLabel.style.whiteSpace = "nowrap";
    currentStringLabel.style.overflow = "hidden";
    currentStringLabel.style.textOverflow = "ellipsis";
    currentStringLabel.textContent = "Current string: ";
    currentStringLabel.id = "current-string-label";
    searchContainer.appendChild(currentStringLabel);

    // Search input
    searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search translations...";
    searchInput.style.width = "100%";
    searchInput.style.padding = "10px 12px";
    searchInput.style.border = "2px solid #e0e0e0";
    searchInput.style.borderRadius = "6px";
    searchInput.style.fontSize = "14px";
    searchInput.style.boxSizing = "border-box";
    searchInput.style.transition = "all 0.2s ease";
    searchInput.style.backgroundColor = "#f8f9fa";
    searchInput.style.outline = "none";

    searchInput.addEventListener("mouseover", function () {
      if (document.activeElement !== this) {
        this.style.borderColor = "#ccc";
      }
    });
    searchInput.addEventListener("mouseout", function () {
      if (document.activeElement !== this) {
        this.style.borderColor = "#e0e0e0";
      }
    });
    searchInput.addEventListener("focus", function () {
      this.style.borderColor = "#1a73e8";
      this.style.backgroundColor = "#fff";
    });
    searchInput.addEventListener("blur", function () {
      this.style.borderColor = "#e0e0e0";
      this.style.backgroundColor = "#f8f9fa";
    });

    searchContainer.appendChild(searchInput);
    content.appendChild(searchContainer);

    resultsDiv = document.createElement("div");
    resultsDiv.style.display = "flex";
    resultsDiv.style.flexDirection = "column";
    resultsDiv.style.flexGrow = "1";
    resultsDiv.style.minHeight = "0";
    resultsDiv.style.padding = "8px";
    resultsDiv.style.backgroundColor = "#fff";
    resultsDiv.style.borderRadius = "4px";
    resultsDiv.style.overflow = "hidden";

    content.appendChild(resultsDiv);

    return content;
  }

  function createSettingsContent() {
    var content = document.createElement("div");
    content.id = "translator-settings-content";
    content.style.display = "none";
    content.style.flexDirection = "column";
    content.style.flexGrow = "1";
    content.style.padding = "16px";
    content.style.gap = "16px";

    // CSV Source Settings
    var csvSourceSection = document.createElement("div");
    csvSourceSection.style.marginBottom = "20px";

    var csvSourceTitle = document.createElement("h4");
    csvSourceTitle.textContent = "CSV Source Settings";
    csvSourceTitle.style.margin = "0 0 12px 0";
    csvSourceTitle.style.color = "#333";

    // Source Type Toggle
    var sourceToggleContainer = document.createElement("div");
    sourceToggleContainer.style.display = "flex";
    sourceToggleContainer.style.alignItems = "center";
    sourceToggleContainer.style.marginBottom = "16px";
    sourceToggleContainer.style.gap = "8px";

    var sourceToggle = document.createElement("input");
    sourceToggle.type = "checkbox";
    sourceToggle.id = "source-toggle";
    sourceToggle.style.margin = "0";
    sourceToggle.checked = false;

    var sourceToggleLabel = document.createElement("label");
    sourceToggleLabel.htmlFor = "source-toggle";
    sourceToggleLabel.textContent = "Use Local File";
    sourceToggleLabel.style.fontSize = "14px";
    sourceToggleLabel.style.color = "#666";
    sourceToggleLabel.style.userSelect = "none";
    sourceToggleLabel.style.cursor = "pointer";

    sourceToggleContainer.appendChild(sourceToggle);
    sourceToggleContainer.appendChild(sourceToggleLabel);

    // Remote URL Input Container
    var urlContainer = document.createElement("div");
    urlContainer.style.marginBottom = "16px";

    var urlLabel = document.createElement("label");
    urlLabel.textContent = "Remote CSV URL";
    urlLabel.style.display = "block";
    urlLabel.style.marginBottom = "8px";
    urlLabel.style.fontSize = "14px";
    urlLabel.style.color = "#666";

    var remoteUrlInput = document.createElement("input");
    remoteUrlInput.type = "text";
    remoteUrlInput.value = CONFIG.remoteCSVUrl;
    remoteUrlInput.placeholder = "Enter remote CSV URL";
    remoteUrlInput.style.width = "100%";
    remoteUrlInput.style.padding = "8px 12px";
    remoteUrlInput.style.border = "1px solid #e0e0e0";
    remoteUrlInput.style.borderRadius = "4px";
    remoteUrlInput.style.boxSizing = "border-box";
    remoteUrlInput.style.fontSize = "14px";

    urlContainer.appendChild(urlLabel);
    urlContainer.appendChild(remoteUrlInput);

    // Local File Input Container
    var fileContainer = document.createElement("div");
    fileContainer.style.marginBottom = "16px";
    fileContainer.style.display = "none";

    var fileLabel = document.createElement("label");
    fileLabel.textContent = "Local CSV File";
    fileLabel.style.display = "block";
    fileLabel.style.marginBottom = "8px";
    fileLabel.style.fontSize = "14px";
    fileLabel.style.color = "#666";

    var localFileInput = document.createElement("input");
    localFileInput.type = "file";
    localFileInput.accept = ".csv";
    localFileInput.style.width = "100%";
    localFileInput.style.fontSize = "14px";

    localFileInput.addEventListener("change", function () {
      if (this.files.length > 0) {
        readCSVFile(this.files[0]);
      }
    });

    fileContainer.appendChild(fileLabel);
    fileContainer.appendChild(localFileInput);

    sourceToggle.addEventListener("change", function () {
      urlContainer.style.display = this.checked ? "none" : "block";
      fileContainer.style.display = this.checked ? "block" : "none";

      if (this.checked) {
        remoteUrlInput.value = "";
      } else {
        localFileInput.value = "";
      }
    });

    // Global style for refresh button
    GM_addStyle(`
      .csv-translator-refresh-btn {
        padding: 8px 16px;
        background-color: #1a73e8;
        color: #ffffff !important;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        width: fit-content;
        transition: all 0.2s ease;
      }
      .csv-translator-refresh-btn:hover {
        background-color: #1557b0;
        color: #ffffff !important;
      }
    `);

    // Refresh Button
    var refreshButton = document.createElement("button");
    refreshButton.textContent = "Refresh Data";
    refreshButton.className = "csv-translator-refresh-btn";

    refreshButton.addEventListener("click", function () {
      refreshTranslationData();
    });

    csvSourceSection.appendChild(csvSourceTitle);
    csvSourceSection.appendChild(sourceToggleContainer);
    csvSourceSection.appendChild(urlContainer);
    csvSourceSection.appendChild(fileContainer);
    csvSourceSection.appendChild(refreshButton);

    content.appendChild(csvSourceSection);

    return content;
  }

  function createFooter() {
    var footer = document.createElement("div");
    footer.style.padding = "12px 16px";
    footer.style.borderTop = "1px solid #e0e0e0";
    footer.style.backgroundColor = "#f8f9fa";
    footer.style.fontSize = "12px";
    footer.style.color = "#666";
    footer.style.display = "flex";
    footer.style.justifyContent = "space-between";
    footer.style.alignItems = "center";

    var credits = document.createElement("div");
    var authorLink = document.createElement("a");
    authorLink.href = CONFIG.metadata.authorGithub;
    authorLink.textContent = "YuzuZensai";
    authorLink.style.color = "#1a73e8";
    authorLink.style.textDecoration = "none";
    authorLink.style.cursor = "pointer";
    authorLink.target = "_blank";

    credits.appendChild(document.createTextNode("Made with 💖 by "));
    credits.appendChild(authorLink);
    credits.appendChild(
      document.createTextNode(` • v${CONFIG.metadata.version}`)
    );

    updateLink = document.createElement("a");
    updateLink.href = "javascript:void(0)";
    updateLink.textContent = "Check for updates";
    updateLink.style.color = "#1a73e8";
    updateLink.style.textDecoration = "none";
    updateLink.style.cursor = "pointer";
    updateLink.addEventListener("click", function (e) {
      e.preventDefault();
      checkForUpdates();
    });

    footer.appendChild(credits);
    footer.appendChild(updateLink);

    return footer;
  }

  function switchTab(tabName) {
    var mainContent = document.getElementById("translator-main-content");
    var settingsContent = document.getElementById(
      "translator-settings-content"
    );
    var tabs = container.querySelectorAll("button");

    tabs.forEach((tab) => {
      if (tab.textContent.toLowerCase() === tabName) {
        tab.style.borderBottom = "2px solid #1a73e8";
        tab.style.color = "#1a73e8";
      } else {
        tab.style.borderBottom = "2px solid transparent";
        tab.style.color = "#666";
      }
    });

    if (tabName === "translator") {
      mainContent.style.display = "flex";
      settingsContent.style.display = "none";
    } else {
      mainContent.style.display = "none";
      settingsContent.style.display = "flex";
    }
  }

  function setupDraggable(element) {
    element.addEventListener("mousedown", function (e) {
      isDragging = true;
      var rect = container.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
      log("info", "Started dragging window");
    });

    document.addEventListener("mousemove", function (e) {
      if (isDragging) {
        var x = e.clientX - dragOffsetX;
        var y = e.clientY - dragOffsetY;
        container.style.left = x + "px";
        container.style.top = y + "px";
        container.style.right = "auto";
        container.style.bottom = "auto";
      }
    });

    document.addEventListener("mouseup", function () {
      if (isDragging) {
        isDragging = false;
        log("info", "Stopped dragging window");
      }
    });
  }

  function createToggleButton() {
    log("info", "Creating toggle button");
    toggleButton = document.createElement("div");
    toggleButton.id = "translator-toggle";
    toggleButton.textContent = "T";
    toggleButton.style.position = "fixed";
    toggleButton.style.bottom = "10px";
    toggleButton.style.right = "10px";
    toggleButton.style.width = "30px";
    toggleButton.style.height = "30px";
    toggleButton.style.backgroundColor = visible ? "#F44336" : "#4CAF50";
    toggleButton.style.color = "white";
    toggleButton.style.borderRadius = "50%";
    toggleButton.style.display = "flex";
    toggleButton.style.justifyContent = "center";
    toggleButton.style.alignItems = "center";
    toggleButton.style.cursor = "pointer";
    toggleButton.style.fontSize = "16px";
    toggleButton.style.fontWeight = "bold";
    toggleButton.style.zIndex = "10000";
    toggleButton.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";

    toggleButton.addEventListener("click", function () {
      log("info", "Toggle button clicked");
      toggleVisibility();
    });

    try {
      document.body.appendChild(toggleButton);
      log("success", "Toggle button added to document body");
    } catch (error) {
      log("error", "Error appending toggle button to body:", error);
    }
  }

  function toggleVisibility() {
    visible = !visible;
    container.style.display = visible ? "flex" : "none";
    toggleButton.style.backgroundColor = visible ? "#F44336" : "#4CAF50";
    toggleButton.textContent = visible ? "X" : "T";
    log("info", "Toggled visibility", {
      visible: visible ? "shown" : "hidden",
    });
  }

  function setupEventListeners() {
    log("info", "Setting up event listeners");
    // Debounce the search with 300ms delay
    const debouncedSearch = debounce(() => {
      searchTranslations();
    }, 300);

    searchInput.addEventListener("input", function () {
      log("info", "Search input detected - debounced");
      debouncedSearch();
    });
  }

  function setupExternalTextboxListener() {
    log("info", "Setting up external textbox listener");

    var observer = new MutationObserver(function (mutations) {
      var textbox = document.querySelector(CONFIG.textboxSelector);
      if (textbox && !textbox.dataset.translatorInitialized) {
        log("info", "Found target textbox", {
          selector: CONFIG.textboxSelector,
        });
        textbox.dataset.translatorInitialized = "true";
        textbox.addEventListener("input", function () {
          log("info", "External textbox input detected");
          findMatches(textbox.value);
        });

        textbox.addEventListener("mouseup", function () {
          var selectedText = window.getSelection()?.toString();
          if (selectedText) {
            log("info", "Text selection detected", {
              selectedText:
                selectedText.substring(0, 20) +
                (selectedText.length > 20 ? "..." : ""),
            });
            findMatches(selectedText);
          }
        });
      }
    });

    try {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
      log("success", "MutationObserver started");
    } catch (error) {
      log("error", "Error setting up MutationObserver:", error);
    }
  }

  function setupCrowdinEditorListener() {
    log("info", "Setting up Crowdin editor listener");

    if (autoSearchIntervalId) {
      clearInterval(autoSearchIntervalId);
    }

    setTimeout(() => {
      checkForEditorContent();
    }, 1000);

    autoSearchIntervalId = setInterval(function () {
      checkForEditorContent();
    }, CONFIG.autoSearchInterval);

    const editorObserver = new MutationObserver(function (mutations) {
      checkForEditorContent();
    });

    try {
      const editorContainer = document.querySelector(
        CONFIG.editorSourceContainer
      );
      if (editorContainer) {
        editorObserver.observe(editorContainer, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        log("success", "Editor observer started");
      }
    } catch (error) {
      log("error", "Error setting up editor observer:", error);
    }
  }

  function checkForEditorContent(forceRefresh = false) {
    if (!visible || translationData.length === 0) {
      log("debug", "Skipping editor content check", {
        visible: visible,
        hasTranslations: translationData.length > 0,
      });
      return;
    }

    try {
      var content = parseEditorContent();
      if (content && content.fullText) {
        if (content.fullText !== lastSearchedText || forceRefresh) {
          lastSearchedText = content.fullText;

          const currentStringLabel = document.getElementById(
            "current-string-label"
          );
          if (currentStringLabel) {
            const stringIdText = content.stringId
              ? ` [ID: ${content.stringId}]`
              : "";
            currentStringLabel.textContent =
              "Current string" +
              stringIdText +
              ": " +
              content.fullText.substring(0, 100) +
              (content.fullText.length > 100 ? "..." : "");
          }

          log("debug", "Editor content changed", {
            text:
              content.fullText.substring(0, 50) +
              (content.fullText.length > 50 ? "..." : ""),
            terms: content.terms,
            stringId: content.stringId,
            length: content.fullText.length,
          });
          findMatches(content.fullText);
        }
      } else {
        log("debug", "No valid editor content found");
      }
    } catch (error) {
      log("error", "Error in checkForEditorContent", error);
    }
  }

  function parseEditorContent() {
    const editorContainer = document.querySelector(
      CONFIG.editorSourceContainer
    );
    if (!editorContainer) {
      log("debug", "Editor container not found", {
        selector: CONFIG.editorSourceContainer,
      });
      return null;
    }

    const sourceContainer = document.querySelector(
      CONFIG.sourceStringContainer
    );
    if (!sourceContainer) {
      log("debug", "Source container not found", {
        selector: CONFIG.sourceStringContainer,
      });
      return null;
    }

    const result = {
      fullText: "",
      terms: [],
      stringId: "",
    };

    try {
      // Try to get text content directly first
      result.fullText = sourceContainer.textContent.trim();

      // If no text found, try alternative selectors
      if (!result.fullText) {
        const alternativeSelectors = [
          ".source-string",
          ".source-string__content",
          '[data-test="source-string"]',
          ".singular",
        ];

        for (const selector of alternativeSelectors) {
          const element = sourceContainer.querySelector(selector);
          if (element) {
            result.fullText = element.textContent.trim();
            if (result.fullText) {
              log("debug", "Found text using alternative selector", {
                selector,
              });
              break;
            }
          }
        }
      }

      // Get string ID from URL if possible
      const urlMatch = window.location.href.match(
        /\/translate\/([^\/]+)\/([^\/]+)\/([^-]+)-(\d+)/
      );
      if (urlMatch && urlMatch[4]) {
        result.stringId = urlMatch[4];
      }

      // Fallback to context link if URL parsing fails
      if (!result.stringId) {
        const contextLink = document.querySelector(
          'a[href*="view_in_context"]'
        );
        if (contextLink) {
          const href = contextLink.getAttribute("href");
          const match = href.match(/#(\d+)/);
          if (match && match[1]) {
            result.stringId = match[1];
          }
        }
      }

      // if (result.fullText) {
      //   log("debug", "Successfully parsed editor content", {
      //     length: result.fullText.length,
      //     stringId: result.stringId || "none",
      //   });
      // } else {
      //   log("debug", "No text content found in editor");
      // }

      return result;
    } catch (error) {
      log("error", "Error parsing editor content:", error);
      return null;
    }
  }

  function refreshTranslationData() {
    log("info", "Refreshing translation data");
    const sourceToggle = document.querySelector("#source-toggle");
    const remoteUrlInput = document.querySelector(
      '#translator-settings-content input[type="text"]'
    );
    const localFileInput = document.querySelector(
      '#translator-settings-content input[type="file"]'
    );

    if (sourceToggle.checked) {
      if (localFileInput && localFileInput.files.length > 0) {
        readCSVFile(localFileInput.files[0]);
      } else {
        updateResults("Please select a local CSV file first.");
        log("warn", "No local file selected");
      }
    } else {
      const url = remoteUrlInput
        ? remoteUrlInput.value.trim()
        : CONFIG.remoteCSVUrl;
      if (url) {
        fetchRemoteCSV(url);
      } else {
        updateResults("Please enter a valid remote CSV URL.");
        log("warn", "No remote URL provided");
      }
    }
  }

  function fetchRemoteCSV(url) {
    log("info", "Fetching remote CSV from", { url: url });
    GM_xmlhttpRequest({
      method: "GET",
      url: url,
      onload: function (response) {
        if (response.status === 200) {
          try {
            const newData = parseCSVToArray(response.responseText);
            translationData = newData;
            currentCSVSource = url;

            log("debug", "Translation data", {
              translationData: JSON.stringify(translationData),
              newData: JSON.stringify(newData),
            });

            log("success", "Successfully loaded remote CSV", {
              entries: translationData.length,
            });
          } catch (csvError) {
            log("error", "Error parsing CSV data", csvError);
            updateResults(
              "Error parsing CSV data. Please check the file format and try again."
            );
          }
        } else {
          log("error", "Failed to fetch remote CSV", {
            status: response.status,
          });
          updateResults(
            "Failed to fetch remote CSV. Please check the URL and try again."
          );
        }
      },
      onerror: function (error) {
        log("error", "Error fetching remote CSV", error);
        updateResults(
          "Error fetching remote CSV. Please check your connection and try again."
        );
      },
    });
  }

  function readCSVFile(file) {
    log("info", "Reading CSV file");
    var reader = new FileReader();
    reader.onload = function (e) {
      var csvContent = e.target?.result;
      log("info", "CSV file loaded, content length", {
        length: csvContent.length,
      });
      parseCSV(csvContent);
      currentCSVSource = file.name;
    };
    reader.onerror = function (error) {
      log("error", "Error reading file", error);
      updateResults("Error reading CSV file. Please try again.");
    };
    reader.readAsText(file);
  }

  function parseCSV(csvContent) {
    log("info", "Parsing CSV content", {
      lines: csvContent.split("\n").length,
    });
    var lines = csvContent.split("\n");

    translationData = [];
    categoryColors.clear();

    if (!lines || lines.length < 2) {
      log("error", "Invalid CSV structure: insufficient lines");
      updateResults("Error: Invalid CSV file structure");
      return;
    }

    // Skip header
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line) {
        try {
          // Handle quoted values that might contain commas
          var values = [];
          var inQuotes = false;
          var currentValue = "";

          for (var j = 0; j < line.length; j++) {
            var char = line[j];

            if (char === '"' && (j === 0 || line[j - 1] !== "\\")) {
              inQuotes = !inQuotes;
            } else if (char === "," && !inQuotes) {
              values.push(currentValue);
              currentValue = "";
            } else {
              currentValue += char;
            }
          }

          values.push(currentValue);

          // Remove quotes if present and validate
          values = values.map(function (v) {
            return validateCSVField(v.replace(/^"(.*)"$/, "$1"));
          });

          if (values.length >= 2) {
            const entry = validateCSVEntry({
              source: values[0],
              target: values[1],
              note: values[2] || "",
              category: values[3] || "",
            });

            if (entry) {
              translationData.push(entry);
            }
          }
        } catch (error) {
          log("error", "Error parsing CSV line", { line: i, error: error });
          continue;
        }
      }
    }

    log("success", "CSV parsing complete", {
      entries: translationData.length,
      source: currentCSVSource || "CSV",
    });
    updateResults(
      `Loaded ${translationData.length} translations from ${sanitizeHTML(
        currentCSVSource || "CSV"
      )}`
    );

    const editorContent = parseEditorContent();
    if (editorContent && editorContent.fullText) {
      log("debug", "Found editor content after loading CSV", {
        text:
          editorContent.fullText.substring(0, 50) +
          (editorContent.fullText.length > 50 ? "..." : ""),
        length: editorContent.fullText.length,
      });
      findMatches(editorContent.fullText);
    } else {
      log("debug", "No editor content found after loading CSV");
      // Try again after a short delay
      setTimeout(() => {
        const delayedContent = parseEditorContent();
        if (delayedContent && delayedContent.fullText) {
          log("debug", "Found editor content after delay", {
            text:
              delayedContent.fullText.substring(0, 50) +
              (delayedContent.fullText.length > 50 ? "..." : ""),
            length: delayedContent.fullText.length,
          });
          findMatches(delayedContent.fullText);
        } else {
          log("warn", "Still no editor content found after delay");
        }
      }, 1000);
    }
  }

  // Debounce function
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Cache for word combinations
  const combinationsCache = new Map();
  const similarityCache = new Map();

  function getCachedCombinations(text) {
    if (combinationsCache.has(text)) {
      return combinationsCache.get(text);
    }

    const words = text.split(/\s+/).filter((word) => word.length > 0);
    const combinations = [];

    // Add full phrase first
    const fullPhrase = words.join(" ");
    if (isSignificantPhrase(fullPhrase)) {
      combinations.push(fullPhrase);
    }

    // Add all possible 3-word combinations
    for (let i = 0; i < words.length - 2; i++) {
      const threeWordPhrase = words.slice(i, i + 3).join(" ");
      if (isSignificantPhrase(threeWordPhrase)) {
        combinations.push(threeWordPhrase);
      }
    }

    // Add word pairs
    for (let i = 0; i < words.length - 1; i++) {
      const twoWordPhrase = words.slice(i, i + 2).join(" ");
      if (isSignificantPhrase(twoWordPhrase)) {
        combinations.push(twoWordPhrase);
      }
    }

    // Add individual significant words
    words.forEach((word) => {
      if (isSignificantPhrase(word)) {
        combinations.push(word);
      }
    });

    combinationsCache.set(text, combinations);
    return combinations;
  }

  function getCachedSimilarity(str1, str2) {
    const key = `${str1}|${str2}`;
    if (similarityCache.has(key)) {
      return similarityCache.get(key);
    }
    const score = similarity(str1, str2);
    similarityCache.set(key, score);
    return score;
  }

  function findMatches(text) {
    if (!text || !translationData.length) return;

    log("debug", "Finding matches for text:", {
      text: text,
      wordCount: text.split(/\s+/).filter((w) => w.length > 0).length,
    });

    const matches = [];
    const seenCombinations = new Set();
    const combinations = getCachedCombinations(text);

    log("debug", "Generated combinations:", combinations);

    // Pre-calculate source combinations for each entry
    const entryCombinations = new Map();
    translationData.forEach((entry) => {
      entryCombinations.set(entry, getCachedCombinations(entry.source));
    });

    combinations.forEach(function (combination) {
      if (!combination) return;

      const combinationLower = combination.toLowerCase();

      // Early exit if we already have enough high-quality matches
      if (matches.length > 20 && matches[19].score > 0.9) {
        return;
      }

      translationData.forEach(function (entry) {
        const uniqueKey = `${entry.source.toLowerCase()}_${
          entry.category || "default"
        }`;
        if (seenCombinations.has(uniqueKey)) return;

        const entryLower = entry.source.toLowerCase();

        // For exact matches (case-insensitive)
        if (entryLower === combinationLower) {
          seenCombinations.add(uniqueKey);
          matches.push({
            entry: entry,
            score: 1,
            matchedWord: combination,
          });
          return;
        }

        // Only proceed if the source is significant
        if (!isSignificantPhrase(entry.source)) {
          return;
        }

        // Get cached source combinations
        const sourceCombinations = entryCombinations.get(entry);

        // Find best matching combination
        let bestScore = 0;
        let bestMatch = "";
        let bestSourceCombo = "";

        for (const sourceCombo of sourceCombinations) {
          const score = getCachedSimilarity(
            sourceCombo.toLowerCase(),
            combinationLower
          );

          // Early exit if score is too low
          if (score < 0.8) continue;

          const sourceWordCount = sourceCombo.split(/\s+/).length;
          const combinationWordCount = combination.split(/\s+/).length;

          let adjustedScore = score;

          // Heavy penalties for mismatches
          if (Math.abs(sourceWordCount - combinationWordCount) > 0) {
            adjustedScore *= 0.4;
          }

          if (combinationWordCount === 1 && sourceWordCount > 1) {
            adjustedScore *= 0.3;
          }

          // Exact word boundary match bonus
          const isExactMatch = new RegExp(`\\b${combinationLower}\\b`).test(
            sourceCombo.toLowerCase()
          );
          if (isExactMatch) {
            adjustedScore *= 1.3;
          }

          if (adjustedScore > bestScore) {
            bestScore = adjustedScore;
            bestMatch = combination;
            bestSourceCombo = sourceCombo;
          }
        }

        // Stricter thresholds
        let threshold = CONFIG.fuzzyThreshold * 1.2;

        if (combination.split(/\s+/).length === 1) {
          threshold *= 1.4;
        }

        if (bestScore >= threshold && !seenCombinations.has(uniqueKey)) {
          seenCombinations.add(uniqueKey);
          matches.push({
            entry: entry,
            score: bestScore,
            matchedWord: bestMatch,
          });
        }
      });
    });

    // Clear caches if they get too large
    if (similarityCache.size > 10000) {
      similarityCache.clear();
    }
    if (combinationsCache.size > 1000) {
      combinationsCache.clear();
    }

    // Sort matches by score first, then by category
    matches.sort(function (a, b) {
      const aWordCount = a.matchedWord.split(/\s+/).length;
      const bWordCount = b.matchedWord.split(/\s+/).length;

      if (Math.abs(b.score - a.score) < 0.05) {
        if (aWordCount !== bWordCount) {
          return bWordCount - aWordCount;
        }
        if (!!a.entry.category !== !!b.entry.category) {
          return a.entry.category ? -1 : 1;
        }
        return b.matchedWord.length - a.matchedWord.length;
      }
      return b.score - a.score;
    });

    log(
      "info",
      "Final matches:",
      matches.map((match) => ({
        source: match.entry.source,
        matchedWord: match.matchedWord,
        score: Math.round(match.score * 100) + "%",
        category: match.entry.category || "none",
      }))
    );

    displayFuzzyMatches(matches);
  }

  function searchTranslations() {
    var query = searchInput.value.toLowerCase().trim();
    if (!query || query.length <= 1) {
      updateResults("");
      lastSearchedText = "";
      checkForEditorContent(true);
      return;
    }

    log("info", "Searching translations for", { query: query });
    var matches = [];

    // Find matches
    translationData.forEach(function (entry) {
      let score = 0;

      // For short queries (2-3 chars), use stricter matching
      if (query.length <= 3) {
        // Only match if it's a complete word match or surrounded by word boundaries
        const regex = new RegExp(`\\b${query}\\b`, "i");
        if (
          regex.test(entry.source) ||
          regex.test(entry.target) ||
          (entry.note && regex.test(entry.note))
        ) {
          score = 1;
        }
      } else {
        // For longer queries, use fuzzy match with context
        const sourceScore = similarity(entry.source.toLowerCase(), query);
        const targetScore = similarity(entry.target.toLowerCase(), query);
        const noteScore = entry.note
          ? similarity(entry.note.toLowerCase(), query)
          : 0;

        // Use the highest score
        score = Math.max(sourceScore, targetScore, noteScore);
      }

      // Score is good enough
      if (
        (query.length <= 3 && score > 0) ||
        (query.length > 3 && score >= CONFIG.fuzzyThreshold)
      ) {
        matches.push({
          entry: entry,
          score: score,
        });
      }
    });

    // Sort matches by score (highest first) and text length (longer matches first)
    matches.sort(function (a, b) {
      if (b.score === a.score) {
        return b.entry.source.length - a.entry.source.length;
      }
      return b.score - a.score;
    });

    // Limit results for performance
    matches = matches.slice(0, 50);

    log("success", "Search found matches", { count: matches.length });
    displayFuzzyMatches(matches);
  }

  function displayFuzzyMatches(matches) {
    if (matches.length === 0) {
      updateResults(
        '<div style="color: #666; text-align: center; padding: 16px;">No matches found</div>'
      );
      return;
    }

    // Wrapper for table with flex layout
    var wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.height = "100%";
    wrapper.style.overflow = "hidden";
    wrapper.style.position = "relative";

    // Table container with scrolling
    var tableContainer = document.createElement("div");
    tableContainer.style.flexGrow = "1";
    tableContainer.style.overflow = "auto";
    tableContainer.style.position = "relative";
    tableContainer.style.minHeight = "0";

    var table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.tableLayout = "fixed";
    table.style.color = "#000";

    var thead = document.createElement("thead");
    thead.style.position = "sticky";
    thead.style.top = "0";
    thead.style.backgroundColor = "#f8f9fa";
    thead.style.zIndex = "1";

    var headerRow = document.createElement("tr");
    var columns = [
      { name: "Source", width: "30%" },
      { name: "Target", width: "30%" },
      { name: "Note", width: "30%" },
      { name: "Score", width: "10%" },
    ];

    columns.forEach((col) => {
      var th = document.createElement("th");
      th.textContent = col.name;
      th.style.textAlign = "left";
      th.style.padding = "8px";
      th.style.border = "1px solid #e0e0e0";
      th.style.width = col.width;
      th.style.backgroundColor = "#f8f9fa";
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body
    var tbody = document.createElement("tbody");

    // Sort matches by score (highest to lowest)
    matches.sort((a, b) => b.score - a.score);

    matches.forEach(function (match) {
      var row = document.createElement("tr");
      const scorePercentage = Math.round(match.score * 100);
      const bgColor = `rgba(26, 115, 232, ${match.score * 0.1})`;
      row.style.backgroundColor = bgColor;

      row.appendChild(createCopyableCell(match.entry.source, true, false));
      row.appendChild(createCopyableCell(match.entry.target, false, true));
      row.appendChild(
        createCopyableCell(match.entry.note, false, false, match.entry.category)
      );

      // Score cell
      var scoreCell = document.createElement("td");
      scoreCell.textContent = scorePercentage + "%";
      scoreCell.style.padding = "8px";
      scoreCell.style.border = "1px solid #e0e0e0";
      scoreCell.style.fontWeight = "bold";
      if (scorePercentage === 100) {
        scoreCell.style.color = "#4CAF50"; // Green for perfect matches
      } else if (scorePercentage >= 80) {
        scoreCell.style.color = "#1a73e8"; // Blue for high matches
      } else {
        scoreCell.style.color = "#666"; // Gray for lower matches
      }
      row.appendChild(scoreCell);

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    wrapper.appendChild(tableContainer);

    // Copy label at bottom
    var copyLabelContainer = document.createElement("div");
    copyLabelContainer.style.padding = "4px 8px";
    copyLabelContainer.style.backgroundColor = "#f8f9fa";
    copyLabelContainer.style.borderTop = "1px solid #e0e0e0";
    copyLabelContainer.style.display = "flex";
    copyLabelContainer.style.alignItems = "center";
    copyLabelContainer.style.gap = "4px";
    copyLabelContainer.style.fontSize = "11px";
    copyLabelContainer.style.color = "#666";

    var matchCount = document.createElement("span");
    matchCount.textContent = `${matches.length} matches`;
    copyLabelContainer.appendChild(matchCount);

    var separator = document.createElement("span");
    separator.textContent = "•";
    separator.style.color = "#ccc";
    copyLabelContainer.appendChild(separator);

    var copyButton = document.createElement("span");
    copyButton.textContent = "Copy as CSV";
    copyButton.style.color = "#1a73e8";
    copyButton.style.cursor = "pointer";
    copyButton.style.transition = "color 0.2s";

    copyButton.addEventListener("mouseover", function () {
      this.style.color = "#1557b0";
      this.style.textDecoration = "underline";
    });

    copyButton.addEventListener("mouseout", function () {
      this.style.color = "#1a73e8";
      this.style.textDecoration = "none";
    });

    copyButton.addEventListener("click", function () {
      let csvContent = "Score,Source,Target,Note,Category\n";
      matches.forEach(function (match) {
        const escapeField = (field) => {
          if (!field) return "";
          const escaped = field.replace(/"/g, '""');
          return `"${escaped}"`;
        };

        csvContent +=
          [
            Math.round(match.score * 100) + "%",
            escapeField(match.entry.source),
            escapeField(match.entry.target),
            escapeField(match.entry.note),
            escapeField(match.entry.category),
          ].join(",") + "\n";
      });

      navigator.clipboard
        .writeText(csvContent)
        .then(() => {
          const originalText = copyButton.textContent;
          copyButton.textContent = "Copied!";
          copyButton.style.color = "#4CAF50";
          setTimeout(() => {
            copyButton.textContent = originalText;
            copyButton.style.color = "#1a73e8";
          }, 2000);
        })
        .catch((err) => {
          log("error", "Failed to copy CSV", err);
          copyButton.textContent = "Failed to copy";
          copyButton.style.color = "#F44336";
          setTimeout(() => {
            copyButton.textContent = "Copy as CSV";
            copyButton.style.color = "#1a73e8";
          }, 2000);
        });
    });

    copyLabelContainer.appendChild(copyButton);
    wrapper.appendChild(copyLabelContainer);

    resultsDiv.innerHTML = "";
    resultsDiv.appendChild(wrapper);
    log("success", "Updated results panel with table layout");
  }

  function updateResults(content) {
    resultsDiv.innerHTML = content;
    log("success", "Updated results panel");
  }

  function checkForUpdates() {
    log("info", "Checking for updates");
    updateLink.textContent = "Checking for updates...";
    updateLink.style.color = "#666";

    // Check version first
    GM_xmlhttpRequest({
      method: "GET",
      url: CONFIG.updateCheckUrl,
      onload: function (response) {
        if (response.status === 200) {
          try {
            const versionInfo = JSON.parse(response.responseText);
            const latestVersion = versionInfo.latest;
            const needsVersionUpdate =
              latestVersion !== CONFIG.metadata.version;

            log("info", "Retrieved version info", {
              current: CONFIG.metadata.version,
              latest: latestVersion,
            });

            // Check CSV data
            const sourceToggle = document.querySelector("#source-toggle");
            const remoteUrlInput = document.querySelector(
              '#translator-settings-content input[type="text"]'
            );
            const csvUrl =
              !sourceToggle || !sourceToggle.checked
                ? remoteUrlInput && remoteUrlInput.value.trim()
                  ? remoteUrlInput.value.trim()
                  : CONFIG.remoteCSVUrl
                : null;

            if (csvUrl) {
              log("info", "Checking CSV updates from", { url: csvUrl });
              GM_xmlhttpRequest({
                method: "GET",
                url: csvUrl,
                onload: function (csvResponse) {
                  if (csvResponse.status === 200) {
                    try {
                      const newData = parseCSVToArray(csvResponse.responseText);

                      function isEqual(obj1, obj2) {
                        return JSON.stringify(obj1) === JSON.stringify(obj2);
                      }

                      const needsDataUpdate = !isEqual(
                        translationData,
                        newData
                      );

                      log("debug", "Translation data", {
                        translationData: JSON.stringify(translationData),
                        newData: JSON.stringify(newData),
                      });

                      log("info", "CSV check complete", {
                        needsUpdate: needsDataUpdate,
                        currentEntries: translationData.length,
                        newEntries: newData.length,
                      });
                      updateUIAfterChecks(
                        needsVersionUpdate,
                        needsDataUpdate,
                        latestVersion,
                        newData
                      );
                    } catch (csvError) {
                      log("error", "Error parsing CSV data", csvError);
                      updateUIAfterChecks(
                        needsVersionUpdate,
                        false,
                        latestVersion,
                        null
                      );
                    }
                  } else {
                    log("error", "Failed to fetch CSV", {
                      status: csvResponse.status,
                    });
                    updateUIAfterChecks(
                      needsVersionUpdate,
                      false,
                      latestVersion,
                      null
                    );
                  }
                },
                onerror: function (csvError) {
                  log("error", "Error fetching CSV", csvError);
                  updateUIAfterChecks(
                    needsVersionUpdate,
                    false,
                    latestVersion,
                    null
                  );
                },
              });
            } else {
              log("info", "Skipping CSV check - using local file");
              updateUIAfterChecks(
                needsVersionUpdate,
                false,
                latestVersion,
                null
              );
            }
          } catch (e) {
            log("error", "Error parsing version info", e);
            updateLink.textContent = "Error checking for updates";
            updateLink.style.color = "#F44336";
          }
        } else {
          log("error", "Failed to check for updates", {
            status: response.status,
          });
          updateLink.textContent = "Error checking for updates";
          updateLink.style.color = "#F44336";
        }
      },
      onerror: function (error) {
        log("error", "Error checking for updates", error);
        updateLink.textContent = "Error checking for updates";
        updateLink.style.color = "#F44336";
      },
    });
  }

  function parseCSVToArray(csvContent) {
    const lines = csvContent.split("\n");
    const result = [];

    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        let values = [];
        let inQuotes = false;
        let currentValue = "";

        for (let j = 0; j < line.length; j++) {
          const char = line[j];

          if (char === '"' && (j === 0 || line[j - 1] !== "\\")) {
            inQuotes = !inQuotes;
          } else if (char === "," && !inQuotes) {
            values.push(currentValue);
            currentValue = "";
          } else {
            currentValue += char;
          }
        }

        values.push(currentValue);
        values = values.map((v) => v.replace(/^"(.*)"$/, "$1"));

        if (values.length >= 2) {
          result.push({
            source: values[0],
            target: values[1],
            note: values[2] || "",
            category: values[3] || "",
          });
        }
      }
    }
    return result;
  }

  function updateUIAfterChecks(
    needsVersionUpdate,
    needsDataUpdate,
    newVersion,
    newData
  ) {
    if (needsVersionUpdate && needsDataUpdate) {
      updateLink.textContent = `Update available! v${newVersion} + new translations`;
      updateLink.style.color = "#F44336";
      showUpdateNotification(true, true);
    } else if (needsVersionUpdate) {
      updateLink.textContent = `Update available! v${newVersion}`;
      updateLink.style.color = "#F44336";
      showUpdateNotification(true, false);
    } else if (needsDataUpdate) {
      updateLink.textContent = "New translations applied!";
      updateLink.style.color = "#F44336";
      showUpdateNotification(false, true);

      if (newData) {
        translationData = newData;
        log("success", "Updated translation data", { entries: newData.length });
        updateResults(`Updated with ${newData.length} translations`);

        setTimeout(() => {
          updateLink.textContent = "Translations updated ✓";
          updateLink.style.color = "#4CAF50";
          // Trigger content check after updating data
          setTimeout(() => {
            checkForEditorContent(true);
          }, 500);
          setTimeout(() => {
            updateLink.textContent = "Check for updates";
            updateLink.style.color = "#1a73e8";
          }, 2000);
        }, 1000);
      }
    } else {
      log("info", "No updates available");
      updateLink.textContent = "No updates available ✓";
      setTimeout(() => {
        updateLink.textContent = "Check for updates";
        updateLink.style.color = "#1a73e8";
      }, 3000);
    }
  }

  function showUpdateNotification(hasVersionUpdate, hasDataUpdate) {
    log("info", "Showing update notification");
    const notification = document.createElement("div");
    notification.style.position = "fixed";
    notification.style.top = "10px";
    notification.style.right = "10px";
    notification.style.background = "#4CAF50";
    notification.style.color = "white";
    notification.style.padding = "16px";
    notification.style.borderRadius = "8px";
    notification.style.zIndex = "10001";
    notification.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    notification.style.maxWidth = "300px";

    let message = "";
    if (hasVersionUpdate && hasDataUpdate) {
      message = "New version and translations available!";
    } else if (hasVersionUpdate) {
      message = "New version available!";
    } else if (hasDataUpdate) {
      message = "New translations available!";
    }

    notification.innerHTML = `
      <div style="margin-bottom:12px">
        <b>${message}</b>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button id="csv-translator-dismiss" style="padding:8px 16px;border:none;background:#2E7D32;color:white;border-radius:4px;cursor:pointer">Dismiss</button>
        ${
          hasVersionUpdate
            ? `<button id="csv-translator-update" style="padding:8px 16px;border:none;background:#1a73e8;color:white;border-radius:4px;cursor:pointer">Open Repository</button>`
            : ""
        }
      </div>
    `;

    document.body.appendChild(notification);

    document
      .getElementById("csv-translator-dismiss")
      .addEventListener("click", function () {
        document.body.removeChild(notification);
      });

    if (hasVersionUpdate) {
      document
        .getElementById("csv-translator-update")
        .addEventListener("click", function () {
          window.open(CONFIG.metadata.repository, "_blank");
          document.body.removeChild(notification);
        });
    }

    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 10000);
  }

  function createCopyableCell(
    text,
    isSource = false,
    isTarget = false,
    category = ""
  ) {
    var cell = document.createElement("td");

    // Create container for content
    var container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "4px";
    container.style.color = "#000";

    // Add category chip first if in note column
    if (!isSource && !isTarget && category) {
      container.innerHTML += createCategoryChip(category);
    }

    // Add main text
    var mainText = document.createElement("div");
    mainText.textContent = text || "";
    mainText.style.flex = "1";
    container.appendChild(mainText);

    cell.appendChild(container);
    cell.style.padding = "8px";
    cell.style.border = "1px solid #e0e0e0";
    cell.style.wordBreak = "break-word";
    cell.style.whiteSpace = "normal";
    cell.style.verticalAlign = "top";
    cell.style.cursor = "pointer";
    cell.style.userSelect = "text";
    cell.style.position = "relative";

    cell.title = "Click to copy";

    // Hover effect
    cell.addEventListener("mouseover", function () {
      this.style.backgroundColor = "rgba(26, 115, 232, 0.1)";
    });

    cell.addEventListener("mouseout", function () {
      this.style.backgroundColor = "transparent";
    });

    cell.addEventListener("click", function (e) {
      if (window.getSelection().toString()) {
        return;
      }

      navigator.clipboard.writeText(text).then(() => {
        var tooltip = document.createElement("div");
        tooltip.textContent = "Copied!";
        tooltip.style.position = "absolute";
        tooltip.style.backgroundColor = "#333";
        tooltip.style.color = "white";
        tooltip.style.padding = "4px 8px";
        tooltip.style.borderRadius = "4px";
        tooltip.style.fontSize = "12px";
        tooltip.style.zIndex = "1000";
        tooltip.style.top = "0";
        tooltip.style.left = "50%";
        tooltip.style.transform = "translate(-50%, -100%)";

        cell.appendChild(tooltip);

        setTimeout(() => {
          tooltip.remove();
        }, 1000);
      });
    });

    return cell;
  }

  init();
}

document.addEventListener("DOMContentLoaded", function () {
  log("info", "DOMContentLoaded event fired");
  try {
    new TranslatorTool();
  } catch (error) {
    log("error", "Error initializing tool:", error);
  }
});

// Fallback initialization
if (
  document.readyState === "complete" ||
  document.readyState === "interactive"
) {
  log("info", "Document already loaded, initializing immediately");
  setTimeout(function () {
    try {
      new TranslatorTool();
    } catch (error) {
      log("error", "Error initializing tool (fallback):", error);
    }
  }, 1000);
}

log("info", "Script loaded. Current document.readyState:", document.readyState);
