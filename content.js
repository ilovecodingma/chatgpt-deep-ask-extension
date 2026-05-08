if (window.__chatgpt_deep_ask_inited__) {
  console.log("[chatgpt-deep-ask] already inited in this frame, skipping re-init.");
  throw new Error("[chatgpt-deep-ask] already inited");
}
window.__chatgpt_deep_ask_inited__ = true;

const IS_TOP_FRAME = window.top === window.self;
console.log("[chatgpt-deep-ask] content.js loaded. url:", location.href, "isTop:", IS_TOP_FRAME);
const PANEL_ID = "__chatgpt_deep_ask_panel__";
const STYLE_ID = "__chatgpt_deep_ask_styles__";
const HEIGHT_KEY = "__chatgpt_deep_ask_panel_height__";
const WIDTH_KEY = "__chatgpt_deep_ask_panel_width__";

let lastRightClick = null;

if (IS_TOP_FRAME) {
  document.addEventListener(
    "contextmenu",
    (e) => {
      lastRightClick = { x: e.clientX, y: e.clientY, t: Date.now() };
    },
    true
  );
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes __dap_spin { to { transform: rotate(360deg); } }
    .__dap_spinner {
      display: inline-block;
      width: 14px; height: 14px;
      border: 2px solid #ccc;
      border-top-color: #555;
      border-radius: 50%;
      animation: __dap_spin 0.9s linear infinite;
      vertical-align: -3px;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function getCurrentSelectionText() {
  const sel = window.getSelection();
  return sel ? sel.toString() : "";
}

function getSelectionRect() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return r;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function loadStoredSize() {
  let h = 500, w = 620;
  try {
    const sh = parseInt(localStorage.getItem(HEIGHT_KEY), 10);
    const sw = parseInt(localStorage.getItem(WIDTH_KEY), 10);
    if (Number.isFinite(sh)) h = sh;
    if (Number.isFinite(sw)) w = sw;
  } catch (_e) {}
  return {
    height: clamp(h, 220, window.innerHeight - 16),
    width: clamp(w, 360, window.innerWidth - 16)
  };
}

function saveSize(partial) {
  try {
    if (partial.height) localStorage.setItem(HEIGHT_KEY, String(Math.round(partial.height)));
    if (partial.width) localStorage.setItem(WIDTH_KEY, String(Math.round(partial.width)));
  } catch (_e) {}
}

function closePanel() {
  const el = document.getElementById(PANEL_ID);
  if (el) el.remove();
}

function createCoverLayer(cursor) {
  const cover = document.createElement("div");
  cover.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    cursor: ${cursor};
    background: transparent;
  `;
  document.documentElement.appendChild(cover);
  return cover;
}

function computeAnchorPos(width, height) {
  let cx, cy;
  if (lastRightClick && Date.now() - lastRightClick.t < 10000) {
    cx = lastRightClick.x;
    cy = lastRightClick.y + 8;
  } else {
    const rect = getSelectionRect();
    if (rect) {
      cx = rect.left;
      cy = rect.bottom + 8;
    } else {
      cx = Math.max(20, window.innerWidth / 2 - width / 2);
      cy = Math.max(20, window.innerHeight / 3);
    }
  }
  const left = clamp(cx, 8, Math.max(8, window.innerWidth - width - 8));
  const top = clamp(cy, 8, Math.max(8, window.innerHeight - height - 8));
  return { left, top };
}

function computeBottomRightPos(width, height) {
  return {
    left: window.innerWidth - width - 16,
    top: window.innerHeight - height - 16
  };
}

function showPanel(prompt, options = {}) {
  closePanel();
  injectStyles();

  const isMinimized = !!options.minimized;
  const stored = loadStoredSize();
  const initW = isMinimized ? 300 : stored.width;
  const initH = isMinimized ? 44 : stored.height;
  const pos = isMinimized
    ? computeBottomRightPos(initW, initH)
    : computeAnchorPos(initW, initH);

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.dataset.state = isMinimized ? "minimized" : "expanded";
  panel.style.cssText = `
    position: fixed;
    left: ${pos.left}px;
    top: ${pos.top}px;
    width: ${initW}px;
    height: ${initH}px;
    background: #fff;
    border: 1px solid #d0d0d0;
    border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.25);
    z-index: 2147483647;
    overflow: hidden;
    font: 13px/1.4 -apple-system, system-ui, sans-serif;
    color: #222;
  `;

  const fullHeader = document.createElement("div");
  fullHeader.style.cssText = `
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 32px;
    display: ${isMinimized ? "none" : "flex"};
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    background: #f4f4f5;
    border-bottom: 1px solid #e3e3e3;
    user-select: none;
    cursor: move;
    z-index: 5;
    box-sizing: border-box;
  `;

  const titleGroup = document.createElement("span");
  titleGroup.style.cssText = "display: inline-flex; align-items: center; gap: 8px;";
  const titleLabel = document.createElement("span");
  titleLabel.textContent = "ChatGPT 상세 질문";
  titleLabel.style.fontWeight = "500";
  const statusLabel = document.createElement("span");
  statusLabel.className = "__dap_status_label";
  statusLabel.textContent = "iframe 로딩 중...";
  statusLabel.style.cssText = "font-size: 11px; color: #888; padding: 1px 6px; background: #eee; border-radius: 8px;";
  titleGroup.appendChild(titleLabel);
  titleGroup.appendChild(statusLabel);
  fullHeader.appendChild(titleGroup);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "닫기");
  closeBtn.style.cssText = `
    border: none; background: transparent; font-size: 16px;
    cursor: pointer; color: #555; padding: 2px 8px; line-height: 1;
  `;
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closePanel();
  });
  closeBtn.addEventListener("mousedown", (e) => e.stopPropagation());
  fullHeader.appendChild(closeBtn);

  const miniBar = document.createElement("div");
  miniBar.style.cssText = `
    position: absolute;
    inset: 0;
    display: ${isMinimized ? "flex" : "none"};
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    background: #f4f4f5;
    cursor: pointer;
    z-index: 10;
    user-select: none;
    box-sizing: border-box;
  `;
  miniBar.title = "클릭하면 펼쳐집니다";

  const miniLabelWrap = document.createElement("span");
  miniLabelWrap.style.cssText = "display: inline-flex; align-items: center; gap: 8px;";
  const spinner = document.createElement("span");
  spinner.className = "__dap_spinner";
  miniLabelWrap.appendChild(spinner);
  const miniText = document.createElement("span");
  miniText.textContent = "오늘 활동 요약 요청 중...";
  miniLabelWrap.appendChild(miniText);
  miniBar.appendChild(miniLabelWrap);

  const miniClose = document.createElement("button");
  miniClose.textContent = "✕";
  miniClose.setAttribute("aria-label", "닫기");
  miniClose.style.cssText = `
    border: none; background: transparent; font-size: 14px;
    cursor: pointer; color: #555; padding: 2px 6px; line-height: 1;
  `;
  miniClose.addEventListener("click", (e) => {
    e.stopPropagation();
    closePanel();
  });
  miniBar.appendChild(miniClose);

  miniBar.addEventListener("click", () => {
    if (panel.dataset.state === "minimized") expandPanel();
  });

  const iframe = document.createElement("iframe");
  iframe.src = "https://chatgpt.com/#deepAsk=1";
  iframe.allow = "clipboard-read; clipboard-write";
  if (isMinimized) {
    iframe.style.cssText = `
      position: absolute;
      left: 0;
      top: 1000px;
      width: 900px;
      height: 700px;
      border: 0;
      background: #fff;
      z-index: 1;
    `;
  } else {
    iframe.style.cssText = `
      position: absolute;
      left: 0;
      top: 32px;
      width: 100%;
      height: calc(100% - 32px);
      border: 0;
      background: #fff;
      z-index: 1;
    `;
  }

  const corner = document.createElement("div");
  corner.title = "드래그해 크기 조절";
  corner.style.cssText = `
    position: absolute;
    right: 0; bottom: 0;
    width: 16px; height: 16px;
    cursor: nwse-resize;
    background:
      linear-gradient(135deg, transparent 50%, #999 50%, #999 60%, transparent 60%, transparent 75%, #999 75%, #999 85%, transparent 85%);
    z-index: 6;
    display: ${isMinimized ? "none" : "block"};
  `;

  const rightEdge = document.createElement("div");
  rightEdge.style.cssText = `
    position: absolute;
    right: 0; top: 32px; bottom: 16px;
    width: 5px;
    cursor: ew-resize;
    z-index: 5;
    display: ${isMinimized ? "none" : "block"};
  `;

  const bottomEdge = document.createElement("div");
  bottomEdge.style.cssText = `
    position: absolute;
    left: 0; right: 16px; bottom: 0;
    height: 5px;
    cursor: ns-resize;
    z-index: 5;
    display: ${isMinimized ? "none" : "block"};
  `;

  panel.appendChild(iframe);
  panel.appendChild(fullHeader);
  panel.appendChild(miniBar);
  panel.appendChild(rightEdge);
  panel.appendChild(bottomEdge);
  panel.appendChild(corner);

  document.documentElement.appendChild(panel);

  function expandPanel() {
    if (panel.dataset.state === "expanded") return;
    panel.dataset.state = "expanded";
    const { width: w, height: h } = loadStoredSize();
    panel.style.width = w + "px";
    panel.style.height = h + "px";
    const r = panel.getBoundingClientRect();
    if (r.left + w > window.innerWidth - 8) {
      panel.style.left = Math.max(8, window.innerWidth - w - 16) + "px";
    }
    if (r.top + h > window.innerHeight - 8) {
      panel.style.top = Math.max(8, window.innerHeight - h - 16) + "px";
    }
    iframe.style.left = "0";
    iframe.style.top = "32px";
    iframe.style.width = "100%";
    iframe.style.height = "calc(100% - 32px)";
    miniBar.style.display = "none";
    fullHeader.style.display = "flex";
    corner.style.display = "block";
    rightEdge.style.display = "block";
    bottomEdge.style.display = "block";
  }

  fullHeader.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.tagName === "BUTTON") return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const cover = createCoverLayer("move");
    function onMove(ev) {
      panel.style.left = clamp(ev.clientX - offsetX, 0, window.innerWidth - rect.width) + "px";
      panel.style.top = clamp(ev.clientY - offsetY, 0, window.innerHeight - rect.height) + "px";
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      cover.remove();
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  corner.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const r = panel.getBoundingClientRect();
    const cover = createCoverLayer("nwse-resize");
    function onMove(ev) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      panel.style.width = clamp(r.width + dx, 360, window.innerWidth - 16) + "px";
      panel.style.height = clamp(r.height + dy, 220, window.innerHeight - 16) + "px";
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      cover.remove();
      const fr = panel.getBoundingClientRect();
      saveSize({ width: fr.width, height: fr.height });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  rightEdge.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panel.getBoundingClientRect().width;
    const cover = createCoverLayer("ew-resize");
    function onMove(ev) {
      panel.style.width = clamp(startW + (ev.clientX - startX), 360, window.innerWidth - 16) + "px";
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      cover.remove();
      saveSize({ width: panel.getBoundingClientRect().width });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  bottomEdge.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panel.getBoundingClientRect().height;
    const cover = createCoverLayer("ns-resize");
    function onMove(ev) {
      panel.style.height = clamp(startH + (ev.clientY - startY), 220, window.innerHeight - 16) + "px";
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      cover.remove();
      saveSize({ height: panel.getBoundingClientRect().height });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  function setStatus(text, isError) {
    miniText.textContent = text;
    statusLabel.textContent = text;
    if (isError) {
      statusLabel.style.background = "#fde8e8";
      statusLabel.style.color = "#a32626";
    } else {
      statusLabel.style.background = "#e6f6ec";
      statusLabel.style.color = "#0a7a32";
    }
  }

  const readyTimeoutId = setTimeout(() => {
    if (statusLabel.textContent === "iframe 로딩 중...") {
      console.warn("[chatgpt-deep-ask] iframe never sent READY in 20s — possibly blocked or login required");
      setStatus("iframe 응답 없음 (20s 초과)", true);
    }
  }, 20000);

  function onIframeMessage(e) {
    if (!iframe.contentWindow || e.source !== iframe.contentWindow) return;
    if (e.origin !== "https://chatgpt.com" && e.origin !== "https://chat.openai.com") return;
    const t = e.data?.type;
    console.log("[chatgpt-deep-ask] parent received from iframe:", t);
    if (t === "DEEP_ASK_READY") {
      clearTimeout(readyTimeoutId);
      iframe.contentWindow.postMessage({ type: "DEEP_ASK_PROMPT", prompt }, e.origin);
      setStatus("프롬프트 전송 중...");
    } else if (t === "DEEP_ASK_SUBMITTED") {
      setStatus("응답 받는 중...");
    } else if (t === "DEEP_ASK_DONE") {
      setStatus("응답 완료");
      if (panel.dataset.state === "minimized") {
        spinner.style.display = "none";
        setTimeout(expandPanel, 250);
      }
    } else if (t === "DEEP_ASK_ERROR") {
      setStatus("오류: " + (e.data.detail || "알 수 없음"), true);
      spinner.style.display = "none";
    }
  }
  window.addEventListener("message", onIframeMessage);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_SELECTION") {
    sendResponse({ text: getCurrentSelectionText() });
    return true;
  }
  if (msg?.type === "SHOW_OVERLAY" && IS_TOP_FRAME) {
    showPanel(msg.prompt, msg.options || {});
  }
  if (msg?.type === "DIRECT_SUBMIT" && IS_TOP_FRAME) {
    console.log("[chatgpt-deep-ask] DIRECT_SUBMIT received. prompt length:", msg.prompt?.length);
    sendResponse({ ok: true, started: true });
    fillAndSubmit(msg.prompt)
      .then((ok) => console.log("[chatgpt-deep-ask] fillAndSubmit returned", ok))
      .catch((e) => console.warn("[chatgpt-deep-ask] fillAndSubmit threw:", e));
    return false;
  }
  if (msg?.type === "ATTACH_IMAGE" && IS_TOP_FRAME) {
    console.log("[chatgpt-deep-ask] ATTACH_IMAGE received. dataUrl size:", msg.dataUrl?.length);
    sendResponse({ ok: true, started: true });
    attachImageAndSubmit(msg.dataUrl, msg.prompt)
      .then((ok) => console.log("[chatgpt-deep-ask] attachImageAndSubmit returned", ok))
      .catch((e) => console.warn("[chatgpt-deep-ask] attachImageAndSubmit threw:", e));
    return false;
  }
});

async function attachImageAndSubmit(dataUrl, prompt) {
  if (!dataUrl) return false;
  const editor = await waitFor(findEditor, 15000);
  if (!editor) {
    console.warn("[chatgpt-deep-ask] attachImageAndSubmit: editor not found");
    return false;
  }
  console.log("[chatgpt-deep-ask] editor found:", editor.tagName);

  let blob;
  try {
    blob = await fetch(dataUrl).then((r) => r.blob());
  } catch (e) {
    console.warn("[chatgpt-deep-ask] dataUrl→blob failed:", e);
    return false;
  }
  const file = new File([blob], "capture.png", { type: "image/png" });

  // Method 1: paste event with clipboardData on the editor
  editor.focus();
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    const pasteEvt = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvt, "clipboardData", { value: dt });
    editor.dispatchEvent(pasteEvt);
    console.log("[chatgpt-deep-ask] paste event dispatched");
  } catch (e) {
    console.warn("[chatgpt-deep-ask] paste failed:", e);
  }

  await sleep(800);

  // Method 2 fallback: <input type="file"> change
  const fileInputs = document.querySelectorAll('input[type="file"]');
  console.log("[chatgpt-deep-ask] file inputs found:", fileInputs.length);
  for (const fi of fileInputs) {
    const accept = (fi.getAttribute("accept") || "").toLowerCase();
    if (accept && !accept.includes("image") && !accept.includes("*")) continue;
    try {
      const dt2 = new DataTransfer();
      dt2.items.add(file);
      fi.files = dt2.files;
      fi.dispatchEvent(new Event("change", { bubbles: true }));
      console.log("[chatgpt-deep-ask] file input change dispatched, accept=", accept);
    } catch (e) {
      console.warn("[chatgpt-deep-ask] file input change failed:", e);
    }
  }

  // Method 3 fallback: drop event on the editor
  try {
    const dt3 = new DataTransfer();
    dt3.items.add(file);
    const dropEvt = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvt, "dataTransfer", { value: dt3 });
    editor.dispatchEvent(dropEvt);
    console.log("[chatgpt-deep-ask] drop event dispatched");
  } catch (e) {
    console.warn("[chatgpt-deep-ask] drop failed:", e);
  }

  // Wait for upload to complete (preview thumbnail appears)
  console.log("[chatgpt-deep-ask] waiting for image upload...");
  await sleep(4000);

  if (prompt && !editorText(editor)) {
    injectText(editor, prompt);
    await sleep(500);
  }

  const btn = await waitFor(findEnabledSendButton, 15000);
  if (btn) {
    console.log("[chatgpt-deep-ask] clicking send (with image)");
    btn.click();
  } else {
    console.warn("[chatgpt-deep-ask] send button not enabled within 15s, trying Enter");
    dispatchEnter(editor);
  }
  return true;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitFor(fn, timeoutMs = 8000, intervalMs = 100) {
  return new Promise((resolve) => {
    const start = Date.now();
    const t = setInterval(() => {
      try {
        const r = fn();
        if (r) {
          clearInterval(t);
          resolve(r);
          return;
        }
      } catch (_e) {}
      if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        resolve(null);
      }
    }, intervalMs);
  });
}

function postParent(data) {
  try {
    window.parent.postMessage(data, "*");
  } catch (_e) {}
}

const EDITOR_SELECTORS_ORDERED = [
  '#prompt-textarea[contenteditable="true"]',
  'div#prompt-textarea',
  'div.ProseMirror[contenteditable="true"]',
  '[contenteditable="true"][data-virtualkeyboard]',
  '#prompt-textarea',
  'textarea[data-id="root"]',
  'textarea[placeholder*="message" i]',
  'textarea[placeholder*="ChatGPT" i]',
  'form textarea',
  'textarea'
];
const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[data-testid="fruitjuice-send-button"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="send"]',
  'button[aria-label*="보내기"]',
  'form button[type="submit"]'
];
const STOP_BUTTON_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[data-testid="composer-stop-button"]',
  'button[aria-label*="Stop"]',
  'button[aria-label*="stop"]',
  'button[aria-label*="중지"]'
];

function isVisibleEditor(el) {
  if (!el) return false;
  if (el.disabled || el.readOnly) return false;
  let style;
  try {
    style = getComputedStyle(el);
  } catch (_e) {
    return false;
  }
  if (style.display === "none" || style.visibility === "hidden") return false;
  // walk up to ensure no display:none ancestor
  let cur = el.parentElement;
  while (cur) {
    const s = getComputedStyle(cur);
    if (s.display === "none" || s.visibility === "hidden") return false;
    cur = cur.parentElement;
  }
  const r = el.getBoundingClientRect();
  return r.width >= 50 && r.height >= 10;
}

function findEditor() {
  for (const sel of EDITOR_SELECTORS_ORDERED) {
    const candidates = document.querySelectorAll(sel);
    for (const el of candidates) {
      if (isVisibleEditor(el)) return el;
    }
  }
  return null;
}
function editorText(el) {
  if (!el) return "";
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    return (el.value || "").trim();
  }
  return (el.innerText || el.textContent || "").trim();
}
function findEnabledSendButton() {
  for (const sel of SEND_BUTTON_SELECTORS) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled && btn.offsetParent !== null) return btn;
  }
  return null;
}
function isStreaming() {
  for (const sel of STOP_BUTTON_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return true;
  }
  return false;
}
function dispatchEnter(el) {
  if (!el) return false;
  el.focus();
  const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keypress", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
  return true;
}
function injectText(el, text) {
  el.focus();
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    try {
      document.execCommand("insertText", false, text);
    } catch (_e) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  }
}

function dumpEditorDiagnostics() {
  console.group("[chatgpt-deep-ask] === EDITOR DIAGNOSTICS ===");
  console.log("URL:", location.href);
  console.log("isTop:", window.top === window.self, "viewport:", window.innerWidth, "x", window.innerHeight);
  for (const sel of EDITOR_SELECTORS_ORDERED) {
    const els = document.querySelectorAll(sel);
    if (els.length === 0) continue;
    console.log(`selector "${sel}" matched ${els.length} element(s):`);
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      let s;
      try { s = getComputedStyle(el); } catch {}
      console.log(`  [${i}]`, {
        tag: el.tagName,
        id: el.id || null,
        class: typeof el.className === "string" ? el.className.slice(0, 60) : null,
        disabled: !!el.disabled,
        readOnly: !!el.readOnly,
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
        display: s?.display,
        visibility: s?.visibility,
        offsetParent: el.offsetParent ? el.offsetParent.tagName : null
      }, el);
    });
  }
  console.log("All visible textareas/contenteditables on page:");
  const wide = document.querySelectorAll('textarea, [contenteditable="true"]');
  wide.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    let s;
    try { s = getComputedStyle(el); } catch {}
    console.log(`  [${i}]`, { tag: el.tagName, id: el.id, size: `${Math.round(r.width)}x${Math.round(r.height)}`, display: s?.display }, el);
  });
  console.groupEnd();
}

async function fillAndSubmit(prompt) {
  console.log("[chatgpt-deep-ask] fillAndSubmit start. prompt length:", prompt?.length, "url:", location.href);
  if (!prompt) return false;
  const editor = await waitFor(findEditor, 15000);
  if (!editor) {
    console.warn("[chatgpt-deep-ask] fillAndSubmit: editor not found after 15s");
    dumpEditorDiagnostics();
    return false;
  }
  console.log("[chatgpt-deep-ask] editor found:", editor.tagName, editor.id || "(no id)");
  await sleep(300);
  if (!editorText(editor)) {
    console.log("[chatgpt-deep-ask] injecting text...");
    injectText(editor, prompt);
    await sleep(400);
  }
  console.log("[chatgpt-deep-ask] editor text length after inject:", editorText(editor).length);
  const btn = await waitFor(findEnabledSendButton, 5000);
  if (btn) {
    console.log("[chatgpt-deep-ask] clicking send button");
    btn.click();
  } else {
    console.log("[chatgpt-deep-ask] send button not found, dispatching Enter");
    dispatchEnter(editor);
  }
  await sleep(800);
  if (editorText(editor)) {
    console.log("[chatgpt-deep-ask] text still present, dispatching Enter again");
    dispatchEnter(editor);
  }
  return true;
}

async function autoSubmitInIframe() {
  if (!location.hash.includes("deepAsk=1") && !location.hash.includes("autoSubmit=1")) {
    console.log("[chatgpt-deep-ask] autoSubmitInIframe: hash does not match, skipping. hash:", location.hash);
    return;
  }
  console.log("[chatgpt-deep-ask] autoSubmitInIframe start. url:", location.href);

  const initialEditor = await waitFor(findEditor, 15000);
  if (!initialEditor) {
    console.warn("[chatgpt-deep-ask] editor not found in iframe (initial wait)");
    postParent({ type: "DEEP_ASK_ERROR", detail: "editor not found" });
    return;
  }
  console.log("[chatgpt-deep-ask] iframe editor ready:", initialEditor.tagName);

  let resolvePrompt;
  const promptP = new Promise((r) => (resolvePrompt = r));
  window.addEventListener("message", (e) => {
    if (e.data?.type === "DEEP_ASK_PROMPT" && typeof e.data.prompt === "string") {
      resolvePrompt(e.data.prompt);
    }
  });

  postParent({ type: "DEEP_ASK_READY" });
  console.log("[chatgpt-deep-ask] sent DEEP_ASK_READY to parent");

  const fallbackQuery = new URL(location.href).searchParams.get("q") || "";
  const timeoutP = new Promise((r) => setTimeout(() => r(""), 30000));
  const prompt = (await Promise.race([promptP, timeoutP])) || fallbackQuery;
  if (!prompt) {
    console.warn("[chatgpt-deep-ask] no prompt received in iframe");
    postParent({ type: "DEEP_ASK_ERROR", detail: "no prompt" });
    return;
  }
  console.log("[chatgpt-deep-ask] prompt received in iframe, length:", prompt.length);

  const ok = await fillAndSubmit(prompt);
  if (!ok) {
    postParent({ type: "DEEP_ASK_ERROR", detail: "fill failed" });
    return;
  }

  postParent({ type: "DEEP_ASK_SUBMITTED" });

  const startedStreaming = await waitFor(isStreaming, 8000);
  if (!startedStreaming) {
    console.warn("[chatgpt-deep-ask] stop button never appeared; assuming response is short");
    await sleep(4000);
  } else {
    await waitFor(() => !isStreaming(), 600000, 250);
    await sleep(500);
  }

  postParent({ type: "DEEP_ASK_DONE" });
  history.replaceState(null, "", location.pathname + location.search);
}

autoSubmitInIframe();
