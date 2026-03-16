// cmux Chat — JS renderer
// Receives events from Swift via window.cmux.pushEvent(json)
// Posts actions back via window.webkit.messageHandlers.cmux.postMessage({action, ...})

(function () {
  'use strict';

  // ── SVG Icons ──────────────────────────────────────────────
  const ICONS = {
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
    terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    write: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  };

  // Tool name → icon key mapping
  const TOOL_ICONS = {
    Read: 'file', Glob: 'search', Grep: 'search',
    Bash: 'terminal', Edit: 'edit', Write: 'write',
    WebFetch: 'globe', WebSearch: 'globe',
  };

  // ── Models ─────────────────────────────────────────────────
  var MODELS = [
    { value: 'haiku', label: 'Haiku' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'sonnet[1m]', label: 'Sonnet (1M)' },
    { value: 'opus', label: 'Opus' },
    { value: 'opus[1m]', label: 'Opus (1M)' },
  ];

  // ── State ──────────────────────────────────────────────────
  let messagesEl, inputField, sendBtn, statusDot, statusText, statusTokens, statusVault;
  let modelBtn, modelDropdown, thinkingBtn, newChatBtn;
  let currentAssistantMsg = null;   // DOM element for current streaming assistant message
  let currentTextBlock = null;      // Current text block being appended to
  let currentThinkingBlock = null;  // Current thinking block being streamed
  let waitingEl = null;             // Waiting indicator (before first token)
  let turnStartTime = null;         // For duration display
  let isBusy = false;
  let currentModel = 'sonnet';
  let thinkingEnabled = true;

  // ── Init ───────────────────────────────────────────────────
  function init() {
    messagesEl = document.getElementById('messages');
    inputField = document.getElementById('input-field');
    sendBtn = document.getElementById('send-btn');
    statusDot = document.getElementById('status-dot');
    statusText = document.getElementById('status-text');
    statusTokens = document.getElementById('status-tokens');
    statusVault = document.getElementById('status-vault');
    modelBtn = document.getElementById('model-btn');
    modelDropdown = document.getElementById('model-dropdown');
    thinkingBtn = document.getElementById('thinking-btn');
    newChatBtn = document.getElementById('new-chat-btn');

    inputField.addEventListener('input', autoResize);
    inputField.addEventListener('keydown', onKeyDown);
    sendBtn.addEventListener('click', sendMessage);

    // Model selector
    if (modelBtn) {
      modelBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        modelBtn.closest('.model-selector').classList.toggle('open');
      });
      document.addEventListener('click', function() {
        var sel = document.querySelector('.model-selector');
        if (sel) sel.classList.remove('open');
      });
      renderModelDropdown();
    }

    // Thinking toggle
    if (thinkingBtn) {
      thinkingBtn.addEventListener('click', function() {
        thinkingEnabled = !thinkingEnabled;
        thinkingBtn.classList.toggle('active', thinkingEnabled);
        thinkingBtn.title = thinkingEnabled ? 'Thinking: On' : 'Thinking: Off';
        postToSwift({ action: 'setOptions', thinking: thinkingEnabled });
      });
    }

    // New chat button
    if (newChatBtn) {
      newChatBtn.addEventListener('click', function() {
        postToSwift({ action: 'newChat' });
      });
    }

    // Expose API
    window.cmux = { pushEvent, setTheme, clear, setStatus, setTokens, setVault, setModel, setThinking, appendUserMessage };
  }

  function renderModelDropdown() {
    if (!modelDropdown) return;
    modelDropdown.innerHTML = '';
    MODELS.forEach(function(m) {
      var opt = document.createElement('div');
      opt.className = 'model-option' + (m.value === currentModel ? ' selected' : '');
      opt.textContent = m.label;
      opt.addEventListener('click', function(e) {
        e.stopPropagation();
        currentModel = m.value;
        if (modelBtn) modelBtn.textContent = m.label;
        modelBtn.closest('.model-selector').classList.remove('open');
        renderModelDropdown();
        postToSwift({ action: 'setOptions', model: m.value });
      });
      modelDropdown.appendChild(opt);
    });
  }

  function setModel(model) {
    currentModel = model;
    var info = MODELS.find(function(m) { return m.value === model; });
    if (modelBtn) modelBtn.textContent = info ? info.label : model;
    renderModelDropdown();
  }

  function setThinking(enabled) {
    thinkingEnabled = enabled;
    if (thinkingBtn) {
      thinkingBtn.classList.toggle('active', enabled);
      thinkingBtn.title = enabled ? 'Thinking: On' : 'Thinking: Off';
    }
  }

  // ── Input handling ─────────────────────────────────────────
  function autoResize() {
    inputField.style.height = 'auto';
    inputField.style.height = Math.min(inputField.scrollHeight, 200) + 'px';
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function sendMessage() {
    const text = inputField.value.trim();
    if (!text || isBusy) return;

    // Render user message
    appendUserMessage(text);

    // Show waiting dots
    showWaiting();

    // Post to Swift
    postToSwift({ action: 'send', message: text });

    // Clear input
    inputField.value = '';
    autoResize();
  }

  function postToSwift(msg) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.cmux) {
      window.webkit.messageHandlers.cmux.postMessage(msg);
    } else {
      console.log('[cmux→Swift]', msg);
    }
  }

  // ── Theme injection ────────────────────────────────────────
  function setTheme(theme) {
    const root = document.documentElement.style;
    if (theme.bg) root.setProperty('--g-bg', theme.bg);
    if (theme.fg) root.setProperty('--g-fg', theme.fg);
    if (theme.cursor) root.setProperty('--g-cursor', theme.cursor);
    if (theme.selectionBg) root.setProperty('--g-selection-bg', theme.selectionBg);
    if (theme.selectionFg) root.setProperty('--g-selection-fg', theme.selectionFg);
    if (theme.palette && Array.isArray(theme.palette)) {
      theme.palette.forEach((color, i) => {
        if (color) root.setProperty('--g-p' + i, color);
      });
    }
  }

  // ── Status ─────────────────────────────────────────────────
  function setStatus(status) {
    var dotClass = 'disconnected';
    if (status === 'connected' || status === 'ready' || status === 'idle') {
      dotClass = 'connected';
    } else if (status === 'busy' || status === 'starting' || status === 'cloning' || status === 'syncing') {
      dotClass = 'busy';
    }
    if (statusDot) statusDot.className = 'status-dot ' + dotClass;
    if (statusText) statusText.textContent = status;
    isBusy = status === 'busy';
    if (inputField) inputField.disabled = isBusy;
    if (sendBtn) sendBtn.disabled = isBusy;
  }

  function setTokens(count) {
    if (statusTokens) {
      statusTokens.textContent = count ? (Math.round(count / 1000) + 'k tokens') : '';
    }
  }

  function setVault(name) {
    if (statusVault) {
      statusVault.textContent = name ? ('vault: ' + name) : '';
    }
  }

  // ── Clear ──────────────────────────────────────────────────
  function clear() {
    if (messagesEl) messagesEl.innerHTML = '';
    currentAssistantMsg = null;
    currentTextBlock = null;
    currentThinkingBlock = null;
    waitingEl = null;
    turnStartTime = null;
  }

  // ── Event dispatcher ───────────────────────────────────────
  function pushEvent(event) {
    if (typeof event === 'string') {
      try { event = JSON.parse(event); } catch { return; }
    }
    console.log('[cmux] pushEvent:', JSON.stringify(event));

    switch (event.type) {
      case 'text':
        ensureAssistantMsg();
        hideWaiting();
        finishThinking();
        appendTextBlock(event.content || '');
        break;

      case 'text_delta':
        ensureAssistantMsg();
        hideWaiting();
        finishThinking();
        appendTextDelta(event.content || '');
        break;

      case 'thinking':
        ensureAssistantMsg();
        hideWaiting();
        appendThinkingBlock(event.content || '', false);
        break;

      case 'thinking_delta':
        ensureAssistantMsg();
        hideWaiting();
        appendThinkingDelta(event.content || '');
        break;

      case 'tool_use':
        ensureAssistantMsg();
        hideWaiting();
        finishThinking();
        finishTextBlock();
        appendToolUse(event);
        break;

      case 'tool_result':
        updateToolResult(event);
        break;

      case 'permission_request':
        ensureAssistantMsg();
        finishThinking();
        finishTextBlock();
        appendPermission(event);
        break;

      case 'status':
        setStatus(event.status || 'idle');
        if (event.status === 'busy') {
          if (!turnStartTime) turnStartTime = Date.now();
          showWaiting();
        }
        break;

      case 'error':
        hideWaiting();
        ensureAssistantMsg();
        var errEl = document.createElement('div');
        errEl.className = 'error-block';
        errEl.textContent = event.content || 'An error occurred';
        currentAssistantMsg.appendChild(errEl);
        currentAssistantMsg = null;
        currentTextBlock = null;
        currentThinkingBlock = null;
        setStatus('idle');
        break;

      case 'done':
        hideWaiting();
        finishThinking();
        finishTextBlock();
        finalizeAllSpinners();
        appendDuration();
        currentAssistantMsg = null;
        currentTextBlock = null;
        currentThinkingBlock = null;
        turnStartTime = null;
        setStatus('idle');
        break;

      default:
        console.log('[cmux] unknown event:', event);
    }

    scrollToBottom();
  }

  // ── Message containers ─────────────────────────────────────
  function appendUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg msg-user';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function showWaiting() {
    ensureAssistantMsg();
    if (waitingEl) return;
    waitingEl = document.createElement('div');
    waitingEl.className = 'waiting-indicator';
    var dots = document.createElement('div');
    dots.className = 'waiting-dots';
    dots.innerHTML = '<div class="waiting-dot"></div><div class="waiting-dot"></div><div class="waiting-dot"></div>';
    waitingEl.appendChild(dots);
    currentAssistantMsg.appendChild(waitingEl);
    scrollToBottom();
  }

  function hideWaiting() {
    if (waitingEl) {
      waitingEl.remove();
      waitingEl = null;
    }
  }

  function ensureAssistantMsg() {
    if (!currentAssistantMsg) {
      currentAssistantMsg = document.createElement('div');
      currentAssistantMsg.className = 'msg msg-assistant';
      messagesEl.appendChild(currentAssistantMsg);
    }
  }

  // ── Text rendering (with drip buffer for typewriter effect) ──

  var DRIP_INTERVAL_MS = 20;
  var DRIP_MIN_CHARS = 1;
  var DRIP_MAX_CHARS = 12;
  var DRIP_RAMP_THRESHOLD = 120;
  var textDripBuffer = '';
  var textDripTimer = null;

  function appendTextBlock(content) {
    finishTextBlock();
    var block = document.createElement('div');
    block.className = 'text-block';
    block.innerHTML = renderMarkdown(content, false);
    currentAssistantMsg.appendChild(block);
    currentTextBlock = null;
  }

  function appendTextDelta(delta) {
    if (!currentTextBlock) {
      currentTextBlock = document.createElement('div');
      currentTextBlock.className = 'text-block';
      currentTextBlock._raw = '';
      currentAssistantMsg.appendChild(currentTextBlock);
    }
    textDripBuffer += delta;
    if (textDripTimer === null) {
      scheduleDrip();
    }
  }

  function getDripChunkSize() {
    var bufLen = textDripBuffer.length;
    if (bufLen <= DRIP_MIN_CHARS) return bufLen;
    var t = Math.min(bufLen / DRIP_RAMP_THRESHOLD, 1);
    return Math.ceil(DRIP_MIN_CHARS + t * (DRIP_MAX_CHARS - DRIP_MIN_CHARS));
  }

  function scheduleDrip() {
    if (textDripTimer !== null) return;
    textDripTimer = setTimeout(function() {
      textDripTimer = null;
      dripNext();
    }, DRIP_INTERVAL_MS);
  }

  function dripNext() {
    if (!textDripBuffer || !currentTextBlock) return;

    var chunkSize = getDripChunkSize();
    var chunk = textDripBuffer.slice(0, chunkSize);
    textDripBuffer = textDripBuffer.slice(chunkSize);

    currentTextBlock._raw += chunk;
    currentTextBlock.innerHTML = renderMarkdown(currentTextBlock._raw, true) + '<span class="cursor"></span>';
    scrollToBottom();

    if (textDripBuffer.length > 0) {
      scheduleDrip();
    }
  }

  function finishTextBlock() {
    // Flush remaining drip buffer
    if (textDripTimer !== null) {
      clearTimeout(textDripTimer);
      textDripTimer = null;
    }
    if (currentTextBlock && textDripBuffer) {
      currentTextBlock._raw += textDripBuffer;
      textDripBuffer = '';
    }
    if (currentTextBlock && currentTextBlock._raw !== undefined) {
      currentTextBlock.innerHTML = renderMarkdown(currentTextBlock._raw, false);
      currentTextBlock = null;
    }
  }

  // ── Thinking ───────────────────────────────────────────────
  function appendThinkingBlock(content, streaming) {
    finishThinking();
    const block = document.createElement('div');
    block.className = 'thinking-block' + (streaming ? ' thinking-streaming' : '');
    block._raw = content;
    block._startTime = Date.now();

    const header = document.createElement('div');
    header.className = 'thinking-header';
    header.addEventListener('click', () => block.classList.toggle('open'));

    const label = document.createElement('div');
    label.className = 'thinking-label';
    label.textContent = streaming ? 'Thinking...' : formatThinkingDuration(content, block._startTime);
    header.appendChild(label);

    const contentEl = document.createElement('div');
    contentEl.className = 'thinking-content';
    contentEl.innerHTML = renderMarkdown(content);

    block.appendChild(header);
    block.appendChild(contentEl);
    currentAssistantMsg.appendChild(block);

    if (!streaming) {
      currentThinkingBlock = null;
    } else {
      currentThinkingBlock = block;
    }
  }

  function appendThinkingDelta(delta) {
    if (!currentThinkingBlock) {
      // Start a new streaming thinking block
      appendThinkingBlock('', true);
    }
    currentThinkingBlock._raw += delta;
    const contentEl = currentThinkingBlock.querySelector('.thinking-content');
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(currentThinkingBlock._raw);
    }
  }

  function finishThinking() {
    if (!currentThinkingBlock) return;
    currentThinkingBlock.classList.remove('thinking-streaming');
    const label = currentThinkingBlock.querySelector('.thinking-label');
    if (label) {
      const elapsed = Math.round((Date.now() - currentThinkingBlock._startTime) / 1000);
      label.textContent = 'Thought for ' + elapsed + 's';
    }
    currentThinkingBlock = null;
  }

  function formatThinkingDuration(content, startTime) {
    return 'Thinking';
  }

  // ── Tool calls ─────────────────────────────────────────────
  function appendToolUse(event) {
    const toolName = event.name || 'Tool';
    const toolId = event.id || '';
    const input = event.input || {};

    const block = document.createElement('div');
    block.className = 'tool-call';
    block.dataset.toolId = toolId;
    block.addEventListener('click', (e) => {
      if (e.target.closest('.permission-btns')) return;
      block.classList.toggle('open');
    });

    // Header
    const header = document.createElement('div');
    header.className = 'tool-header';

    const iconKey = TOOL_ICONS[toolName] || 'terminal';
    const iconEl = document.createElement('div');
    iconEl.className = 'tool-icon';
    iconEl.innerHTML = ICONS[iconKey] || ICONS.terminal;

    const nameEl = document.createElement('span');
    nameEl.className = 'tool-name';
    nameEl.textContent = toolName;

    const summaryEl = document.createElement('span');
    summaryEl.className = 'tool-summary';
    summaryEl.textContent = toolSummary(toolName, input);

    const statusEl = document.createElement('div');
    statusEl.className = 'tool-status running';
    statusEl.innerHTML = '<div class="spinner"></div>';

    header.append(iconEl, nameEl, summaryEl, statusEl);

    // Content
    const contentEl = document.createElement('div');
    contentEl.className = 'tool-content';

    if (toolName === 'Bash' && input.command) {
      const cmdEl = document.createElement('div');
      cmdEl.className = 'tool-command';
      cmdEl.textContent = input.command;
      contentEl.appendChild(cmdEl);
    } else if (toolName === 'Edit' && input.file_path) {
      contentEl.appendChild(renderEditDiff(input));
    } else if (toolName === 'Write' && input.file_path) {
      const cmdEl = document.createElement('div');
      cmdEl.className = 'tool-command';
      cmdEl.textContent = input.file_path;
      contentEl.appendChild(cmdEl);
    } else if (input) {
      const lines = document.createElement('div');
      lines.className = 'tool-lines';
      const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
      inputStr.split('\n').slice(0, 10).forEach(line => {
        const lineEl = document.createElement('div');
        lineEl.className = 'tool-line';
        lineEl.textContent = line;
        lines.appendChild(lineEl);
      });
      contentEl.appendChild(lines);
    }

    block.append(header, contentEl);
    currentAssistantMsg.appendChild(block);
  }

  function updateToolResult(event) {
    const toolId = event.id || '';
    const block = currentAssistantMsg?.querySelector(`.tool-call[data-tool-id="${CSS.escape(toolId)}"]`);
    if (!block) return;

    const statusEl = block.querySelector('.tool-status');
    if (statusEl) {
      statusEl.className = 'tool-status ' + (event.isError ? 'err' : 'ok');
      statusEl.innerHTML = event.isError ? ICONS.x : ICONS.check;
    }

    // Add result content if present
    const content = event.content;
    if (content) {
      const contentEl = block.querySelector('.tool-content');
      if (contentEl) {
        const lines = document.createElement('div');
        lines.className = 'tool-lines';
        const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        const allLines = text.split('\n');
        const maxLines = 15;
        allLines.slice(0, maxLines).forEach(line => {
          const lineEl = document.createElement('div');
          lineEl.className = 'tool-line';
          lineEl.textContent = line;
          lines.appendChild(lineEl);
        });
        if (allLines.length > maxLines) {
          const trunc = document.createElement('div');
          trunc.className = 'tool-truncated';
          trunc.textContent = '... ' + (allLines.length - maxLines) + ' more lines';
          lines.appendChild(trunc);
        }
        contentEl.appendChild(lines);
      }
    }
  }

  function finalizeAllSpinners() {
    if (!currentAssistantMsg) return;
    var spinners = currentAssistantMsg.querySelectorAll('.tool-status.running');
    spinners.forEach(function(el) {
      el.className = 'tool-status ok';
      el.innerHTML = ICONS.check;
    });
  }

  function toolSummary(name, input) {
    if (!input) return '';
    switch (name) {
      case 'Read': return input.file_path || '';
      case 'Write': return input.file_path || '';
      case 'Edit': return input.file_path || '';
      case 'Bash': return input.command ? truncate(input.command, 60) : '';
      case 'Grep': return input.pattern ? (input.pattern + (input.path ? ' in ' + input.path : '')) : '';
      case 'Glob': return input.pattern || '';
      case 'WebFetch': return input.url ? truncate(input.url, 60) : '';
      default: return '';
    }
  }

  function renderEditDiff(input) {
    const container = document.createElement('div');
    container.className = 'write-edit-diff';

    if (input.old_string != null && input.new_string != null) {
      const oldLines = (input.old_string || '').split('\n');
      const newLines = (input.new_string || '').split('\n');

      oldLines.forEach(line => {
        container.appendChild(diffLine('-', line, 'diff-delete'));
      });
      newLines.forEach(line => {
        container.appendChild(diffLine('+', line, 'diff-insert'));
      });
    }
    return container;
  }

  function diffLine(prefix, text, cls) {
    const el = document.createElement('div');
    el.className = 'diff-line ' + cls;
    el.innerHTML = '<span class="diff-prefix">' + escapeHtml(prefix) + '</span><span class="diff-text">' + escapeHtml(text) + '</span>';
    return el;
  }

  // ── Permission ─────────────────────────────────────────────
  function appendPermission(event) {
    const block = document.createElement('div');
    block.className = 'permission';
    block.dataset.toolUseId = event.toolUseId || '';

    const header = document.createElement('div');
    header.className = 'permission-header';

    const iconEl = document.createElement('div');
    iconEl.className = 'permission-icon';
    iconEl.innerHTML = ICONS.shield;

    const label = document.createElement('span');
    label.className = 'permission-label';
    label.textContent = 'Permission';

    header.append(iconEl, label);

    const detail = document.createElement('div');
    detail.className = 'permission-detail';

    const toolEl = document.createElement('div');
    toolEl.className = 'permission-tool';
    toolEl.textContent = event.toolName || '';

    detail.appendChild(toolEl);

    // Show input summary
    if (event.input) {
      const cmdEl = document.createElement('div');
      cmdEl.className = 'permission-cmd';
      const inputObj = typeof event.input === 'string' ? event.input : JSON.stringify(event.input, null, 2);
      cmdEl.textContent = truncate(inputObj, 200);
      detail.appendChild(cmdEl);
    }

    const btns = document.createElement('div');
    btns.className = 'permission-btns';

    const allowBtn = document.createElement('button');
    allowBtn.className = 'btn-allow';
    allowBtn.textContent = 'Allow';
    allowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      postToSwift({ action: 'permission', toolUseId: event.toolUseId, behavior: 'allow' });
      btns.remove();
    });

    const denyBtn = document.createElement('button');
    denyBtn.className = 'btn-deny';
    denyBtn.textContent = 'Deny';
    denyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      postToSwift({ action: 'permission', toolUseId: event.toolUseId, behavior: 'deny' });
      btns.remove();
    });

    btns.append(allowBtn, denyBtn);
    detail.appendChild(btns);

    block.append(header, detail);
    currentAssistantMsg.appendChild(block);
  }

  // ── Duration ───────────────────────────────────────────────
  function appendDuration() {
    if (!turnStartTime || !currentAssistantMsg) return;
    const elapsed = Math.round((Date.now() - turnStartTime) / 1000);
    if (elapsed < 1) return;
    const el = document.createElement('div');
    el.className = 'duration';
    el.textContent = elapsed + 's';
    currentAssistantMsg.appendChild(el);
  }

  // ── Helpers ────────────────────────────────────────────────

  /**
   * Close any unclosed markdown fences so marked.parse() renders
   * code blocks properly during streaming.
   */
  function closeUnfinishedMarkdown(text) {
    // Count triple-backtick fences (``` with optional language)
    var fencePattern = /^```/gm;
    var matches = text.match(fencePattern);
    if (matches && matches.length % 2 !== 0) {
      // Odd number of fences = unclosed block
      text += '\n```';
    }
    return text;
  }

  function renderMarkdown(text, streaming) {
    if (!text) return '';
    if (typeof marked !== 'undefined' && marked.parse) {
      var toRender = streaming ? closeUnfinishedMarkdown(text) : text;
      return marked.parse(toRender, { breaks: true, gfm: true });
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '...' : str;
  }

  function scrollToBottom() {
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // ── Boot ───────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
