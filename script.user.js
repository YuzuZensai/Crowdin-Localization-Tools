// ==UserScript==
// @name         Crowdin Localization Tools
// @namespace    https://yuzu.kirameki.cafe/
// @version      1.0.3
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
  defaultPosition: { right: '20px', bottom: '20px' },
  windowDimensions: {
    width: '600px',
    height: '600px'
  },

  debug: true,

  // Update check
  updateCheckUrl: 'https://raw.githubusercontent.com/YuzuZensai/Crowdin-Localization-Tools/main/data/version.json',
  currentVersion: '1.0.3',

  // Remote CSV
  remoteCSVUrl: 'https://raw.githubusercontent.com/YuzuZensai/Crowdin-Localization-Tools/main/data/data.csv',
  allowLocalOverride: true,
  allowUrlOverride: true,

  // Crowdin editor
  textboxSelector: '.editor-panel__editor-container textarea',
  editorSourceContainer: '.editor-current-translation-source',
  sourceStringContainer: '#source_phrase_container',

  autoSearchInterval: 1500,
  fuzzyThreshold: 0.7,

  metadata: {
    version: '1.0.3',
    repository: 'https://github.com/YuzuZensai/Crowdin-Localization-Tools',
    authorGithub: 'https://github.com/YuzuZensai'
  }
};

function log(type, message, data = null) {
  if (!CONFIG.debug) return;

  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[Crowdin Localization Tools][${timestamp}]`;

  switch (type.toLowerCase()) {
    case 'info':
      console.log(`${prefix} ℹ️ ${message}`, data || '');
      break;
    case 'warn':
      console.warn(`${prefix} ⚠️ ${message}`, data || '');
      break;
    case 'error':
      console.error(`${prefix} ❌ ${message}`, data || '');
      break;
    case 'success':
      console.log(`${prefix} ✅ ${message}`, data || '');
      break;
    case 'debug':
      console.debug(`${prefix} 🔍 ${message}`, data || '');
      break;
  }
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
          matrix[i][j - 1] + 1,   // insertion
          matrix[i - 1][j] + 1    // deletion
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
  var lastSearchedText = '';
  var autoSearchIntervalId = null;
  var updateLink;
  var currentCSVSource = null;

  function init() {
    log('info', 'Initializing translator tool');
    createUI();
    createToggleButton();
    setupEventListeners();
    setupExternalTextboxListener();
    setupCrowdinEditorListener();

    const sourceToggle = document.querySelector('#source-toggle');
    if (!sourceToggle || !sourceToggle.checked) {
      fetchRemoteCSV(CONFIG.remoteCSVUrl);
    }

    log('success', 'Crowdin Localization Tools version ' + CONFIG.metadata.version + ' by ' + CONFIG.metadata.authorGithub + ' initialized successfully');
  }

  function createUI() {
    log('info', 'Creating UI elements');

    // Container
    container = document.createElement('div');
    container.id = 'translator-tool';
    container.style.position = 'fixed';
    container.style.bottom = CONFIG.defaultPosition.bottom;
    container.style.right = CONFIG.defaultPosition.right;
    container.style.width = CONFIG.windowDimensions.width;
    container.style.height = CONFIG.windowDimensions.height;
    container.style.backgroundColor = '#fff';
    container.style.border = '1px solid #e0e0e0';
    container.style.borderRadius = '8px';
    container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    container.style.zIndex = '9999';
    container.style.display = CONFIG.defaultVisible ? 'flex' : 'none';
    container.style.flexDirection = 'column';
    container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

    // Header
    var header = document.createElement('div');
    header.style.padding = '12px 16px';
    header.style.backgroundColor = '#f8f9fa';
    header.style.borderBottom = '1px solid #e0e0e0';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.cursor = 'move';

    var title = document.createElement('h3');
    title.textContent = 'Crowdin Localization Tools';
    title.style.margin = '0';
    title.style.fontSize = '16px';
    title.style.fontWeight = '600';
    title.style.color = '#1a73e8';

    var closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.border = 'none';
    closeButton.style.background = 'none';
    closeButton.style.cursor = 'pointer';
    closeButton.style.fontSize = '24px';
    closeButton.style.color = '#666';
    closeButton.style.padding = '0 4px';
    closeButton.style.lineHeight = '1';
    closeButton.addEventListener('click', function () {
      log('info', 'Close button clicked');
      toggleVisibility();
    });

    header.appendChild(title);
    header.appendChild(closeButton);
    container.appendChild(header);

    // Tab menu
    var tabMenu = document.createElement('div');
    tabMenu.style.padding = '0 16px';
    tabMenu.style.backgroundColor = '#f8f9fa';
    tabMenu.style.borderBottom = '1px solid #e0e0e0';
    tabMenu.style.display = 'flex';
    tabMenu.style.gap = '16px';

    var mainTab = createTab('Translator', true);
    var settingsTab = createTab('Settings', false);

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
      log('success', 'Main container added to document body');
    } catch (error) {
      log('error', 'Error appending container to body:', error);
    }

    setupDraggable(header);

    log('success', 'UI elements created successfully');
  }

  function createTab(text, isActive) {
    var tab = document.createElement('button');
    tab.textContent = text;
    tab.style.padding = '12px 16px';
    tab.style.border = 'none';
    tab.style.background = 'none';
    tab.style.borderBottom = isActive ? '2px solid #1a73e8' : '2px solid transparent';
    tab.style.color = isActive ? '#1a73e8' : '#666';
    tab.style.cursor = 'pointer';
    tab.style.fontSize = '14px';
    tab.style.fontWeight = '500';
    tab.style.transition = 'all 0.2s ease';

    tab.addEventListener('click', function () {
      switchTab(text.toLowerCase());
    });

    return tab;
  }

  function createMainContent() {
    var content = document.createElement('div');
    content.id = 'translator-main-content';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.flexGrow = '1';
    content.style.padding = '16px';
    content.style.height = '100%';
    content.style.boxSizing = 'border-box';
    content.style.minHeight = '0';

    // Search container
    var searchContainer = document.createElement('div');
    searchContainer.style.position = 'relative';
    searchContainer.style.marginBottom = '16px';
    searchContainer.style.flexShrink = '0';

    // Search input
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search translations...';
    searchInput.style.width = '100%';
    searchInput.style.padding = '10px 12px';
    searchInput.style.border = '2px solid #e0e0e0';
    searchInput.style.borderRadius = '6px';
    searchInput.style.fontSize = '14px';
    searchInput.style.boxSizing = 'border-box';
    searchInput.style.transition = 'all 0.2s ease';
    searchInput.style.backgroundColor = '#f8f9fa';
    searchInput.style.outline = 'none';

    searchInput.addEventListener('mouseover', function () {
      if (document.activeElement !== this) {
        this.style.borderColor = '#ccc';
      }
    });
    searchInput.addEventListener('mouseout', function () {
      if (document.activeElement !== this) {
        this.style.borderColor = '#e0e0e0';
      }
    });
    searchInput.addEventListener('focus', function () {
      this.style.borderColor = '#1a73e8';
      this.style.backgroundColor = '#fff';
    });
    searchInput.addEventListener('blur', function () {
      this.style.borderColor = '#e0e0e0';
      this.style.backgroundColor = '#f8f9fa';
    });

    searchContainer.appendChild(searchInput);
    content.appendChild(searchContainer);

    resultsDiv = document.createElement('div');
    resultsDiv.style.display = 'flex';
    resultsDiv.style.flexDirection = 'column';
    resultsDiv.style.flexGrow = '1';
    resultsDiv.style.minHeight = '0';
    resultsDiv.style.padding = '8px';
    resultsDiv.style.backgroundColor = '#fff';
    resultsDiv.style.borderRadius = '4px';
    resultsDiv.style.overflow = 'hidden';

    content.appendChild(resultsDiv);

    return content;
  }

  function createSettingsContent() {
    var content = document.createElement('div');
    content.id = 'translator-settings-content';
    content.style.display = 'none';
    content.style.flexDirection = 'column';
    content.style.flexGrow = '1';
    content.style.padding = '16px';
    content.style.gap = '16px';

    // CSV Source Settings
    var csvSourceSection = document.createElement('div');
    csvSourceSection.style.marginBottom = '20px';

    var csvSourceTitle = document.createElement('h4');
    csvSourceTitle.textContent = 'CSV Source Settings';
    csvSourceTitle.style.margin = '0 0 12px 0';
    csvSourceTitle.style.color = '#333';

    // Source Type Toggle
    var sourceToggleContainer = document.createElement('div');
    sourceToggleContainer.style.display = 'flex';
    sourceToggleContainer.style.alignItems = 'center';
    sourceToggleContainer.style.marginBottom = '16px';
    sourceToggleContainer.style.gap = '8px';

    var sourceToggle = document.createElement('input');
    sourceToggle.type = 'checkbox';
    sourceToggle.id = 'source-toggle';
    sourceToggle.style.margin = '0';
    sourceToggle.checked = false;

    var sourceToggleLabel = document.createElement('label');
    sourceToggleLabel.htmlFor = 'source-toggle';
    sourceToggleLabel.textContent = 'Use Local File';
    sourceToggleLabel.style.fontSize = '14px';
    sourceToggleLabel.style.color = '#666';
    sourceToggleLabel.style.userSelect = 'none';
    sourceToggleLabel.style.cursor = 'pointer';

    sourceToggleContainer.appendChild(sourceToggle);
    sourceToggleContainer.appendChild(sourceToggleLabel);

    // Remote URL Input Container
    var urlContainer = document.createElement('div');
    urlContainer.style.marginBottom = '16px';

    var urlLabel = document.createElement('label');
    urlLabel.textContent = 'Remote CSV URL';
    urlLabel.style.display = 'block';
    urlLabel.style.marginBottom = '8px';
    urlLabel.style.fontSize = '14px';
    urlLabel.style.color = '#666';

    var remoteUrlInput = document.createElement('input');
    remoteUrlInput.type = 'text';
    remoteUrlInput.value = CONFIG.remoteCSVUrl;
    remoteUrlInput.placeholder = 'Enter remote CSV URL';
    remoteUrlInput.style.width = '100%';
    remoteUrlInput.style.padding = '8px 12px';
    remoteUrlInput.style.border = '1px solid #e0e0e0';
    remoteUrlInput.style.borderRadius = '4px';
    remoteUrlInput.style.boxSizing = 'border-box';
    remoteUrlInput.style.fontSize = '14px';

    urlContainer.appendChild(urlLabel);
    urlContainer.appendChild(remoteUrlInput);

    // Local File Input Container
    var fileContainer = document.createElement('div');
    fileContainer.style.marginBottom = '16px';
    fileContainer.style.display = 'none'; // Hidden by default

    var fileLabel = document.createElement('label');
    fileLabel.textContent = 'Local CSV File';
    fileLabel.style.display = 'block';
    fileLabel.style.marginBottom = '8px';
    fileLabel.style.fontSize = '14px';
    fileLabel.style.color = '#666';

    var localFileInput = document.createElement('input');
    localFileInput.type = 'file';
    localFileInput.accept = '.csv';
    localFileInput.style.width = '100%';
    localFileInput.style.fontSize = '14px';

    localFileInput.addEventListener('change', function () {
      if (this.files.length > 0) {
        readCSVFile(this.files[0]);
      }
    });

    fileContainer.appendChild(fileLabel);
    fileContainer.appendChild(localFileInput);

    sourceToggle.addEventListener('change', function () {
      urlContainer.style.display = this.checked ? 'none' : 'block';
      fileContainer.style.display = this.checked ? 'block' : 'none';

      if (this.checked) {
        remoteUrlInput.value = '';
      } else {
        localFileInput.value = '';
      }
    });

    // Add global style for refresh button
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
    var refreshButton = document.createElement('button');
    refreshButton.textContent = 'Refresh Data';
    refreshButton.className = 'csv-translator-refresh-btn';

    refreshButton.addEventListener('click', function () {
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
    var footer = document.createElement('div');
    footer.style.padding = '12px 16px';
    footer.style.borderTop = '1px solid #e0e0e0';
    footer.style.backgroundColor = '#f8f9fa';
    footer.style.fontSize = '12px';
    footer.style.color = '#666';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'space-between';
    footer.style.alignItems = 'center';

    var credits = document.createElement('div');
    var authorLink = document.createElement('a');
    authorLink.href = CONFIG.metadata.authorGithub;
    authorLink.textContent = 'YuzuZensai';
    authorLink.style.color = '#1a73e8';
    authorLink.style.textDecoration = 'none';
    authorLink.style.cursor = 'pointer';
    authorLink.target = '_blank';

    credits.appendChild(document.createTextNode('Made with 💖 by '));
    credits.appendChild(authorLink);
    credits.appendChild(document.createTextNode(` • v${CONFIG.metadata.version}`));

    updateLink = document.createElement('a');
    updateLink.href = 'javascript:void(0)';
    updateLink.textContent = 'Check for updates';
    updateLink.style.color = '#1a73e8';
    updateLink.style.textDecoration = 'none';
    updateLink.style.cursor = 'pointer';
    updateLink.addEventListener('click', function (e) {
      e.preventDefault();
      checkForUpdates();
    });

    footer.appendChild(credits);
    footer.appendChild(updateLink);

    return footer;
  }

  function switchTab(tabName) {
    var mainContent = document.getElementById('translator-main-content');
    var settingsContent = document.getElementById('translator-settings-content');
    var tabs = container.querySelectorAll('button');

    tabs.forEach(tab => {
      if (tab.textContent.toLowerCase() === tabName) {
        tab.style.borderBottom = '2px solid #1a73e8';
        tab.style.color = '#1a73e8';
      } else {
        tab.style.borderBottom = '2px solid transparent';
        tab.style.color = '#666';
      }
    });

    if (tabName === 'translator') {
      mainContent.style.display = 'flex';
      settingsContent.style.display = 'none';
    } else {
      mainContent.style.display = 'none';
      settingsContent.style.display = 'flex';
    }
  }

  function setupDraggable(element) {
    element.addEventListener('mousedown', function (e) {
      isDragging = true;
      var rect = container.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
      log('info', 'Started dragging window');
    });

    document.addEventListener('mousemove', function (e) {
      if (isDragging) {
        var x = e.clientX - dragOffsetX;
        var y = e.clientY - dragOffsetY;
        container.style.left = x + 'px';
        container.style.top = y + 'px';
        container.style.right = 'auto';
        container.style.bottom = 'auto';
      }
    });

    document.addEventListener('mouseup', function () {
      if (isDragging) {
        isDragging = false;
        log('info', 'Stopped dragging window');
      }
    });
  }

  function createToggleButton() {
    log('info', 'Creating toggle button');
    toggleButton = document.createElement('div');
    toggleButton.id = 'translator-toggle';
    toggleButton.textContent = 'T';
    toggleButton.style.position = 'fixed';
    toggleButton.style.bottom = '10px';
    toggleButton.style.right = '10px';
    toggleButton.style.width = '30px';
    toggleButton.style.height = '30px';
    toggleButton.style.backgroundColor = visible ? '#F44336' : '#4CAF50';
    toggleButton.style.color = 'white';
    toggleButton.style.borderRadius = '50%';
    toggleButton.style.display = 'flex';
    toggleButton.style.justifyContent = 'center';
    toggleButton.style.alignItems = 'center';
    toggleButton.style.cursor = 'pointer';
    toggleButton.style.fontSize = '16px';
    toggleButton.style.fontWeight = 'bold';
    toggleButton.style.zIndex = '10000';
    toggleButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';

    toggleButton.addEventListener('click', function () {
      log('info', 'Toggle button clicked');
      toggleVisibility();
    });

    try {
      document.body.appendChild(toggleButton);
      log('success', 'Toggle button added to document body');
    } catch (error) {
      log('error', 'Error appending toggle button to body:', error);
    }
  }

  function toggleVisibility() {
    visible = !visible;
    container.style.display = visible ? 'flex' : 'none';
    toggleButton.style.backgroundColor = visible ? '#F44336' : '#4CAF50';
    toggleButton.textContent = visible ? 'X' : 'T';
    log('info', 'Toggled visibility', { visible: visible ? 'shown' : 'hidden' });
  }

  function setupEventListeners() {
    log('info', 'Setting up event listeners');
    searchInput.addEventListener('input', function () {
      log('info', 'Search input detected');
      searchTranslations();
    });
  }

  function setupExternalTextboxListener() {
    log('info', 'Setting up external textbox listener');

    var observer = new MutationObserver(function (mutations) {
      var textbox = document.querySelector(CONFIG.textboxSelector);
      if (textbox && !textbox.dataset.translatorInitialized) {
        log('info', 'Found target textbox', { selector: CONFIG.textboxSelector });
        textbox.dataset.translatorInitialized = 'true';
        textbox.addEventListener('input', function () {
          log('info', 'External textbox input detected');
          findMatches(textbox.value);
        });

        textbox.addEventListener('mouseup', function () {
          var selectedText = window.getSelection()?.toString();
          if (selectedText) {
            log('info', 'Text selection detected', { selectedText: selectedText.substring(0, 20) + (selectedText.length > 20 ? '...' : '') });
            findMatches(selectedText);
          }
        });
      }
    });

    try {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      log('success', 'MutationObserver started');
    } catch (error) {
      log('error', 'Error setting up MutationObserver:', error);
    }
  }

  function setupCrowdinEditorListener() {
    log('info', 'Setting up Crowdin editor listener');

    if (autoSearchIntervalId) {
      clearInterval(autoSearchIntervalId);
    }

    autoSearchIntervalId = setInterval(function () {
      checkForEditorContent();
    }, CONFIG.autoSearchInterval);
  }

  function checkForEditorContent() {
    if (!visible || translationData.length === 0) return;

    try {
      var content = parseEditorContent();
      if (content && content.fullText) {
        if (content.fullText !== lastSearchedText) {
          lastSearchedText = content.fullText;
          log('debug', 'Editor content changed', {
            text: content.fullText,
            terms: content.terms,
            length: content.fullText.length
          });
          findMatches(lastSearchedText);
        }
      }
    } catch (error) {
      log('error', 'Error in auto-search', error);
    }
  }

  function parseEditorContent() {
    const editorContainer = document.querySelector(CONFIG.editorSourceContainer);
    if (!editorContainer) return null;

    const sourceContainer = document.querySelector(CONFIG.sourceStringContainer);
    if (!sourceContainer) return null;

    const result = {
      fullText: '',
      terms: []
    };

    try {
      const singularContainer = sourceContainer.querySelector('.singular');
      if (singularContainer) {
        let nodes = singularContainer.childNodes;
        for (let i = 0; i < nodes.length; i++) {
          let node = nodes[i];

          if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('term_item')) {
            const termId = node.getAttribute('data-source-term-id');
            const termText = node.textContent;
            const termTitle = node.getAttribute('title');

            result.terms.push({
              id: termId,
              text: termText,
              title: termTitle || ''
            });

            result.fullText += termText;
          } else if (node.nodeType === Node.TEXT_NODE) {
            result.fullText += node.textContent;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            result.fullText += node.textContent;
          } else {
            log('warn', 'Unknown node type', { nodeType: node.nodeType });
          }
        }
      } else {
        // Fallback, if something went wrong, just get the text content
        result.fullText = sourceContainer.textContent;
      }

      result.fullText = result.fullText.trim();

      return result;
    } catch (error) {
      log('error', 'Error parsing editor content:', error);
      return null;
    }
  }

  function refreshTranslationData() {
    log('info', 'Refreshing translation data');
    const sourceToggle = document.querySelector('#source-toggle');
    const remoteUrlInput = document.querySelector('#translator-settings-content input[type="text"]');
    const localFileInput = document.querySelector('#translator-settings-content input[type="file"]');

    if (sourceToggle.checked) {
      if (localFileInput && localFileInput.files.length > 0) {
        readCSVFile(localFileInput.files[0]);
      } else {
        updateResults('Please select a local CSV file first.');
        log('warn', 'No local file selected');
      }
    } else {
      const url = remoteUrlInput ? remoteUrlInput.value.trim() : CONFIG.remoteCSVUrl;
      if (url) {
        fetchRemoteCSV(url);
      } else {
        updateResults('Please enter a valid remote CSV URL.');
        log('warn', 'No remote URL provided');
      }
    }
  }

  function fetchRemoteCSV(url) {
    log('info', 'Fetching remote CSV from', { url: url });
    GM_xmlhttpRequest({
      method: 'GET',
      url: url,
      onload: function (response) {
        if (response.status === 200) {
          parseCSV(response.responseText);
          currentCSVSource = url;
          log('success', 'Successfully loaded remote CSV');
        } else {
          log('error', 'Failed to fetch remote CSV', { status: response.status });
          updateResults('Failed to fetch remote CSV. Please check the URL and try again.');
        }
      },
      onerror: function (error) {
        log('error', 'Error fetching remote CSV', error);
        updateResults('Error fetching remote CSV. Please check your connection and try again.');
      }
    });
  }

  function readCSVFile(file) {
    log('info', 'Reading CSV file');
    var reader = new FileReader();
    reader.onload = function (e) {
      var content = e.target?.result;
      log('info', 'CSV file loaded, content length', { length: content.length });
      parseCSV(content);
      currentCSVSource = file.name;
    };
    reader.onerror = function (error) {
      log('error', 'Error reading file', error);
      updateResults('Error reading CSV file. Please try again.');
    };
    reader.readAsText(file);
  }

  function parseCSV(content) {
    log('info', 'Parsing CSV content', { lines: content.split('\n').length });
    var lines = content.split('\n');

    translationData = [];

    // Skip header
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line) {
        // Handle quoted values that might contain commas
        var values = [];
        var inQuotes = false;
        var currentValue = '';

        for (var j = 0; j < line.length; j++) {
          var char = line[j];

          if (char === '"' && (j === 0 || line[j - 1] !== '\\')) {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(currentValue);
            currentValue = '';
          } else {
            currentValue += char;
          }
        }

        // Add the last value
        values.push(currentValue);

        // Remove quotes if present
        values = values.map(function (v) {
          return v.replace(/^"(.*)"$/, '$1');
        });

        if (values.length >= 2) {
          translationData.push({
            source: values[0],
            target: values[1],
            note: values[2] || ''
          });
        }
      }
    }

    log('success', 'CSV parsing complete', {
      entries: translationData.length,
      source: currentCSVSource || 'CSV'
    });
    updateResults(`Loaded ${translationData.length} translations from ${currentCSVSource || 'CSV'}`);

    checkForEditorContent();
  }

  function findMatches(text) {
    if (!text || !translationData.length) return;

    log('debug', 'Finding matches', {
      text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      length: text.length
    });

    var words = text.split(/\s+/);
    var matches = [];
    var seenWords = new Set();

    words.forEach(function (word) {
      // Clean the word from punctuation
      var cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
      if (!cleanWord || cleanWord.length <= 1) return; // Skip single characters

      if (seenWords.has(cleanWord.toLowerCase())) return;
      seenWords.add(cleanWord.toLowerCase());

      // Find matches
      translationData.forEach(function (entry) {
        // For short words (2-3 chars), use stricter matching
        if (cleanWord.length <= 3) {
          // Only match if it's a complete word match or surrounded by word boundaries
          const regex = new RegExp(`\\b${cleanWord}\\b`, 'i');
          if (regex.test(entry.source) &&
            !matches.some(function (m) { return m.entry.source === entry.source; })) {
            matches.push({
              entry: entry,
              score: 1,
              matchedWord: cleanWord
            });
          }
        } else {
          // For longer words, use fuzzy match with higher threshold
          const score = similarity(entry.source.toLowerCase(), cleanWord.toLowerCase());
          if (score >= CONFIG.fuzzyThreshold &&
            !matches.some(function (m) { return m.entry.source === entry.source; })) {
            matches.push({
              entry: entry,
              score: score,
              matchedWord: cleanWord
            });
          }
        }
      });
    });

    matches.sort(function (a, b) {
      if (b.score === a.score) {
        return b.matchedWord.length - a.matchedWord.length;
      }
      return b.score - a.score;
    });

    log('success', 'Found matches', { count: matches.length });
    displayFuzzyMatches(matches);
  }

  function searchTranslations() {
    var query = searchInput.value.toLowerCase().trim();
    if (!query || query.length <= 1) {
      updateResults('');
      lastSearchedText = '';
      checkForEditorContent();
      return;
    }

    log('info', 'Searching translations for', { query: query });
    var matches = [];

    // Find matches
    translationData.forEach(function (entry) {
      let score = 0;

      // For short queries (2-3 chars), use stricter matching
      if (query.length <= 3) {
        // Only match if it's a complete word match or surrounded by word boundaries
        const regex = new RegExp(`\\b${query}\\b`, 'i');
        if (regex.test(entry.source) || regex.test(entry.target) || (entry.note && regex.test(entry.note))) {
          score = 1;
        }
      } else {
        // For longer queries, use fuzzy match with context
        const sourceScore = similarity(entry.source.toLowerCase(), query);
        const targetScore = similarity(entry.target.toLowerCase(), query);
        const noteScore = entry.note ? similarity(entry.note.toLowerCase(), query) : 0;

        // Use the highest score
        score = Math.max(sourceScore, targetScore, noteScore);
      }

      // Score is good enough
      if ((query.length <= 3 && score > 0) || (query.length > 3 && score >= CONFIG.fuzzyThreshold)) {
        matches.push({
          entry: entry,
          score: score
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

    log('success', 'Search found matches', { count: matches.length });
    displayFuzzyMatches(matches);
  }

  function displayFuzzyMatches(matches) {
    if (matches.length === 0) {
      updateResults('<div style="color: #666; text-align: center; padding: 16px;">No matches found</div>');
      return;
    }

    // Wrapper for table with flex layout
    var wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.height = '100%';
    wrapper.style.overflow = 'hidden';
    wrapper.style.position = 'relative';

    // Table container with scrolling
    var tableContainer = document.createElement('div');
    tableContainer.style.flexGrow = '1';
    tableContainer.style.overflow = 'auto';
    tableContainer.style.position = 'relative';
    tableContainer.style.minHeight = '0';

    var table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.tableLayout = 'fixed';

    // Header
    var thead = document.createElement('thead');
    thead.style.position = 'sticky';
    thead.style.top = '0';
    thead.style.backgroundColor = '#f8f9fa';
    thead.style.zIndex = '1';

    var headerRow = document.createElement('tr');
    var columns = [
      { name: 'Source', width: '30%' },
      { name: 'Target', width: '30%' },
      { name: 'Note', width: '20%' }
    ];

    if (matches[0].matchedWord) {
      columns.push({ name: 'Match', width: '20%' });
    }

    columns.forEach(col => {
      var th = document.createElement('th');
      th.textContent = col.name;
      th.style.textAlign = 'left';
      th.style.padding = '8px';
      th.style.border = '1px solid #e0e0e0';
      th.style.width = col.width;
      th.style.backgroundColor = '#f8f9fa';
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body
    var tbody = document.createElement('tbody');
    matches.forEach(function (match) {
      var row = document.createElement('tr');
      const scorePercentage = Math.round(match.score * 100);
      const bgColor = `rgba(26, 115, 232, ${match.score * 0.1})`;
      row.style.backgroundColor = bgColor;

      // Add cells
      var sourceCell = document.createElement('td');
      sourceCell.textContent = match.entry.source;
      sourceCell.style.padding = '8px';
      sourceCell.style.border = '1px solid #e0e0e0';
      sourceCell.style.overflow = 'hidden';
      sourceCell.style.textOverflow = 'ellipsis';
      sourceCell.style.whiteSpace = 'nowrap';
      row.appendChild(sourceCell);

      var targetCell = document.createElement('td');
      targetCell.textContent = match.entry.target;
      targetCell.style.padding = '8px';
      targetCell.style.border = '1px solid #e0e0e0';
      targetCell.style.overflow = 'hidden';
      targetCell.style.textOverflow = 'ellipsis';
      targetCell.style.whiteSpace = 'nowrap';
      row.appendChild(targetCell);

      var noteCell = document.createElement('td');
      noteCell.textContent = match.entry.note;
      noteCell.style.padding = '8px';
      noteCell.style.border = '1px solid #e0e0e0';
      noteCell.style.overflow = 'hidden';
      noteCell.style.textOverflow = 'ellipsis';
      noteCell.style.whiteSpace = 'nowrap';
      row.appendChild(noteCell);

      if (match.matchedWord) {
        var matchCell = document.createElement('td');
        matchCell.textContent = `${match.matchedWord} (${scorePercentage}%)`;
        matchCell.style.padding = '8px';
        matchCell.style.border = '1px solid #e0e0e0';
        matchCell.style.overflow = 'hidden';
        matchCell.style.textOverflow = 'ellipsis';
        matchCell.style.whiteSpace = 'nowrap';
        row.appendChild(matchCell);
      }

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    wrapper.appendChild(tableContainer);

    resultsDiv.innerHTML = '';
    resultsDiv.appendChild(wrapper);
    log('success', 'Updated results panel with table layout');
  }

  function updateResults(content) {
    resultsDiv.innerHTML = content;
    log('success', 'Updated results panel');
  }

  function checkForUpdates() {
    log('info', 'Checking for updates');
    updateLink.textContent = 'Checking for updates...';
    updateLink.style.color = '#666';

    // Check version first
    GM_xmlhttpRequest({
      method: 'GET',
      url: CONFIG.updateCheckUrl,
      onload: function (response) {
        if (response.status === 200) {
          try {
            const versionInfo = JSON.parse(response.responseText);
            const latestVersion = versionInfo.latest;
            const needsVersionUpdate = latestVersion !== CONFIG.currentVersion;

            log('info', 'Retrieved version info', {
              current: CONFIG.currentVersion,
              latest: latestVersion
            });

            // Check CSV data
            const sourceToggle = document.querySelector('#source-toggle');
            const remoteUrlInput = document.querySelector('#translator-settings-content input[type="text"]');
            const csvUrl = (!sourceToggle || !sourceToggle.checked) ?
              (remoteUrlInput && remoteUrlInput.value.trim() ? remoteUrlInput.value.trim() : CONFIG.remoteCSVUrl) :
              null;

            if (csvUrl) {
              log('info', 'Checking CSV updates from', { url: csvUrl });
              GM_xmlhttpRequest({
                method: 'GET',
                url: csvUrl,
                onload: function (csvResponse) {
                  if (csvResponse.status === 200) {
                    try {
                      const newData = parseCSVToArray(csvResponse.responseText);
                      const needsDataUpdate = JSON.stringify(translationData) !== JSON.stringify(newData);
                      log('info', 'CSV check complete', {
                        needsUpdate: needsDataUpdate,
                        currentEntries: translationData.length,
                        newEntries: newData.length
                      });
                      updateUIAfterChecks(needsVersionUpdate, needsDataUpdate, latestVersion, newData);
                    } catch (csvError) {
                      log('error', 'Error parsing CSV data', csvError);
                      updateUIAfterChecks(needsVersionUpdate, false, latestVersion, null);
                    }
                  } else {
                    log('error', 'Failed to fetch CSV', { status: csvResponse.status });
                    updateUIAfterChecks(needsVersionUpdate, false, latestVersion, null);
                  }
                },
                onerror: function (csvError) {
                  log('error', 'Error fetching CSV', csvError);
                  updateUIAfterChecks(needsVersionUpdate, false, latestVersion, null);
                }
              });
            } else {
              log('info', 'Skipping CSV check - using local file');
              updateUIAfterChecks(needsVersionUpdate, false, latestVersion, null);
            }
          } catch (e) {
            log('error', 'Error parsing version info', e);
            updateLink.textContent = 'Error checking for updates';
            updateLink.style.color = '#F44336';
          }
        } else {
          log('error', 'Failed to check for updates', { status: response.status });
          updateLink.textContent = 'Failed to check updates';
          updateLink.style.color = '#F44336';
        }
      },
      onerror: function (error) {
        log('error', 'Error checking for updates', error);
        updateLink.textContent = 'Error checking for updates';
        updateLink.style.color = '#F44336';
      }
    });
  }

  function parseCSVToArray(csvContent) {
    const lines = csvContent.split('\n');
    const result = [];

    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        let values = [];
        let inQuotes = false;
        let currentValue = '';

        for (let j = 0; j < line.length; j++) {
          const char = line[j];

          if (char === '"' && (j === 0 || line[j - 1] !== '\\')) {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(currentValue);
            currentValue = '';
          } else {
            currentValue += char;
          }
        }

        values.push(currentValue);
        values = values.map(v => v.replace(/^"(.*)"$/, '$1'));

        if (values.length >= 2) {
          result.push({
            source: values[0],
            target: values[1],
            note: values[2] || ''
          });
        }
      }
    }
    return result;
  }

  function updateUIAfterChecks(needsVersionUpdate, needsDataUpdate, newVersion, newData) {
    if (needsVersionUpdate && needsDataUpdate) {
      updateLink.textContent = `Update available! v${newVersion} + new translations`;
      updateLink.style.color = '#F44336';
      showUpdateNotification(true, true);
    } else if (needsVersionUpdate) {
      updateLink.textContent = `Update available! v${newVersion}`;
      updateLink.style.color = '#F44336';
      showUpdateNotification(true, false);
    } else if (needsDataUpdate) {
      updateLink.textContent = 'New translations available!';
      updateLink.style.color = '#F44336';
      showUpdateNotification(false, true);

      if (newData) {
        translationData = newData;
        log('success', 'Updated translation data', { entries: newData.length });
        updateResults(`Updated with ${newData.length} translations`);

        setTimeout(() => {
          updateLink.textContent = 'Translations updated ✓';
          updateLink.style.color = '#4CAF50';
          setTimeout(() => {
            updateLink.textContent = 'Check for updates';
            updateLink.style.color = '#1a73e8';
          }, 2000);
        }, 1000);
      }
    } else {
      log('info', 'No updates available');
      updateLink.textContent = 'No updates available ✓';
      setTimeout(() => {
        updateLink.textContent = 'Check for updates';
        updateLink.style.color = '#1a73e8';
      }, 3000);
    }
  }

  function showUpdateNotification(hasVersionUpdate, hasDataUpdate) {
    log('info', 'Showing update notification');
    const notification = document.createElement('div');
    notification.style.position = 'fixed';
    notification.style.top = '10px';
    notification.style.right = '10px';
    notification.style.background = '#4CAF50';
    notification.style.color = 'white';
    notification.style.padding = '16px';
    notification.style.borderRadius = '8px';
    notification.style.zIndex = '10001';
    notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    notification.style.maxWidth = '300px';

    let message = '';
    if (hasVersionUpdate && hasDataUpdate) {
      message = 'New version and translations available!';
    } else if (hasVersionUpdate) {
      message = 'New version available!';
    } else if (hasDataUpdate) {
      message = 'New translations available!';
    }

    notification.innerHTML = `
      <div style="margin-bottom:12px">
        <b>${message}</b>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button id="csv-translator-dismiss" style="padding:8px 16px;border:none;background:#2E7D32;color:white;border-radius:4px;cursor:pointer">Dismiss</button>
        ${hasVersionUpdate ? `<button id="csv-translator-update" style="padding:8px 16px;border:none;background:#1a73e8;color:white;border-radius:4px;cursor:pointer">Open Repository</button>` : ''}
      </div>
    `;

    document.body.appendChild(notification);

    document.getElementById('csv-translator-dismiss').addEventListener('click', function () {
      document.body.removeChild(notification);
    });

    if (hasVersionUpdate) {
      document.getElementById('csv-translator-update').addEventListener('click', function () {
        window.open(CONFIG.metadata.repository, '_blank');
        document.body.removeChild(notification);
      });
    }

    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 10000);
  }

  init();
}

document.addEventListener('DOMContentLoaded', function () {
  log('info', 'DOMContentLoaded event fired');
  try {
    new TranslatorTool();
  } catch (error) {
    log('error', 'Error initializing tool:', error);
  }
});

// Fallback initialization
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  log('info', 'Document already loaded, initializing immediately');
  setTimeout(function () {
    try {
      new TranslatorTool();
    } catch (error) {
      log('error', 'Error initializing tool (fallback):', error);
    }
  }, 1000);
}

log('info', 'Script loaded. Current document.readyState:', document.readyState);
