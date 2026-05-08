console.log("[chatgpt-deep-ask] background.js loaded at", new Date().toISOString());

const ASK_MENU_ID = "ask-detail-popup";
const ASK_WITH_CONTEXT_MENU_ID = "ask-with-context";
const SUMMARIZE_MENU_ID = "summarize-today";
const SUMMARIZE_SITE_MENU_ID = "summarize-site";
const TEMPLATES_PARENT_MENU_ID = "templates-parent";
const TEMPLATE_MENU_PREFIX = "template-";
const TEMPLATES_KEY = "promptTemplates";

const DEFAULT_TEMPLATES = [
  { id: "easy", title: "쉽게 설명", template: '아래 부분을 초보자가 이해할 수 있게 쉬운 말로 풀어 설명해줘.\n\n"""{TEXT}"""' },
  { id: "tldr", title: "TL;DR (한두 문장 요약)", template: '아래 내용을 한국어로 1~2문장 핵심만 요약해줘.\n\n"""{TEXT}"""' },
  { id: "translate-en", title: "영어로 번역", template: '다음을 자연스러운 영어로 번역해줘.\n\n"""{TEXT}"""' },
  { id: "translate-ko", title: "한국어로 번역", template: '다음을 자연스러운 한국어로 번역해줘.\n\n"""{TEXT}"""' },
  { id: "code-review", title: "코드 리뷰", template: '아래 코드를 리뷰해줘 — 버그, 성능, 가독성 관점에서. 개선 제안도 같이.\n\n```\n{TEXT}\n```' },
  { id: "explain-jargon", title: "용어 풀이", template: '다음에 등장하는 전문 용어를 하나씩 한국어로 풀어 설명해줘.\n\n"""{TEXT}"""' }
];

async function getTemplates() {
  const data = await chrome.storage.local.get([TEMPLATES_KEY]);
  if (Array.isArray(data[TEMPLATES_KEY]) && data[TEMPLATES_KEY].length > 0) {
    return data[TEMPLATES_KEY];
  }
  await chrome.storage.local.set({ [TEMPLATES_KEY]: DEFAULT_TEMPLATES });
  return DEFAULT_TEMPLATES.slice();
}

function applyTemplate(tpl, vars) {
  let out = tpl.template || "";
  out = out.replace(/\{TEXT\}/g, vars.text || "");
  out = out.replace(/\{URL\}/g, vars.url || "");
  out = out.replace(/\{TITLE\}/g, vars.title || "");
  return out;
}

async function buildTemplateMenus() {
  const templates = await getTemplates();
  // Remove existing template menu items (parent + children)
  await new Promise((r) => chrome.contextMenus.remove(TEMPLATES_PARENT_MENU_ID, () => {
    void chrome.runtime.lastError;
    r();
  }));
  if (!templates.length) return;
  chrome.contextMenus.create({
    id: TEMPLATES_PARENT_MENU_ID,
    title: "ChatGPT 템플릿",
    contexts: ["selection"]
  });
  for (const t of templates) {
    if (!t.id || !t.title) continue;
    chrome.contextMenus.create({
      id: TEMPLATE_MENU_PREFIX + t.id,
      parentId: TEMPLATES_PARENT_MENU_ID,
      title: t.title,
      contexts: ["selection"]
    });
  }
}

function buildContextPrompt(ctx) {
  return `다음 웹페이지 컨텍스트를 참고해 [선택한 부분]에 대해 자세히 설명해줘. 페이지 흐름과 주제를 고려해 답해줘.

[페이지 정보]
URL: ${ctx.url}
제목: ${ctx.title}

[페이지 본문 일부]
${ctx.body}

[선택한 부분]
"""${ctx.selection}"""`;
}

const HISTORY_KEY = "callHistory";
const HISTORY_MAX = 50;

async function recordHistory(type, prompt, hostOrUrl) {
  let host = "";
  try { host = new URL(hostOrUrl || "").hostname || ""; } catch (_e) {}
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type,
    summary: (prompt || "").trim().replace(/\s+/g, " ").slice(0, 200),
    prompt: prompt || "",
    host,
    ts: Date.now()
  };
  try {
    const data = await chrome.storage.local.get([HISTORY_KEY]);
    const list = data[HISTORY_KEY] || [];
    list.push(entry);
    if (list.length > HISTORY_MAX) list.splice(0, list.length - HISTORY_MAX);
    await chrome.storage.local.set({ [HISTORY_KEY]: list });
  } catch (e) {
    console.warn("[chatgpt-deep-ask] history save failed:", e);
  }
}

function buildSelectionPrompt(selectedText) {
  return `아래 부분을 더 깊이 이해하고 싶어. 무슨 의미인지, 왜 그런지, 관련 배경까지 풀어서 설명해줘.\n\n"""${selectedText}"""`;
}

async function buildTodayHistoryPrompt() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  let startTime = startOfDay.getTime();

  let items = [];
  try {
    items = await chrome.history.search({
      text: "",
      startTime,
      maxResults: 1500
    });
  } catch (e) {
    console.warn("[chatgpt-deep-ask] history.search failed:", e);
    return null;
  }
  console.log("[chatgpt-deep-ask] history items today (since", new Date(startTime).toISOString(), "):", items.length);

  if (items.length === 0) {
    // Fallback to last 24h
    startTime = Date.now() - 24 * 60 * 60 * 1000;
    try {
      items = await chrome.history.search({ text: "", startTime, maxResults: 1500 });
    } catch (_e) {}
    console.log("[chatgpt-deep-ask] fallback last 24h items:", items.length);
  }

  const byUrl = new Map();
  for (const it of items) {
    if (!it.url || !/^https?:/i.test(it.url)) continue;
    if (it.url.includes("chrome-extension://")) continue;
    if (/^https?:\/\/(www\.)?(google|bing|duckduckgo|naver)\.[a-z.]+\/(search|s\?)/i.test(it.url)) {
      // skip raw search engine query pages (the next click is what matters)
    }
    const ex = byUrl.get(it.url);
    if (!ex || (it.lastVisitTime || 0) > (ex.lastVisitTime || 0)) byUrl.set(it.url, it);
  }

  const all = Array.from(byUrl.values());
  all.sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));
  const top = all.slice(0, 150);
  top.sort((a, b) => (a.lastVisitTime || 0) - (b.lastVisitTime || 0));

  const lines = top.map((it) => {
    const t = new Date(it.lastVisitTime || 0);
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    const title = (it.title || "").slice(0, 120).replace(/\s+/g, " ").replace(/\|/g, "/").trim();
    return `- ${hh}:${mm} | ${title} | ${it.url}`;
  });

  if (lines.length === 0) return null;

  const todayStr = new Date().toISOString().slice(0, 10);
  return (
    `다음은 내가 오늘(${todayStr}) 방문한 웹페이지 목록입니다 (총 ${lines.length}개, 시간순 정렬). ` +
    `어떤 주제·작업에 시간을 썼는지 카테고리별로 묶어 한국어로 정리하고, 핵심 흐름을 요약해줘. ` +
    `세부 URL은 도메인 단위로만 인용하고, 개인정보가 포함될 수 있는 URL은 도메인만 언급해줘.\n\n` +
    lines.join("\n")
  );
}

async function buildSiteHistoryPrompt(host) {
  if (!host) return null;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  let startTime = startOfDay.getTime();

  function matchesHost(it) {
    if (!it.url || !/^https?:/i.test(it.url)) return false;
    try {
      const u = new URL(it.url);
      return u.hostname === host || u.hostname.endsWith("." + host);
    } catch (_e) {
      return false;
    }
  }

  let items = [];
  try {
    items = await chrome.history.search({ text: host, startTime, maxResults: 2000 });
  } catch (e) {
    console.warn("[chatgpt-deep-ask] history.search failed:", e);
    return null;
  }
  let filtered = items.filter(matchesHost);
  console.log("[chatgpt-deep-ask] site history items today for", host, ":", filtered.length);

  if (filtered.length === 0) {
    startTime = Date.now() - 24 * 60 * 60 * 1000;
    try {
      items = await chrome.history.search({ text: host, startTime, maxResults: 2000 });
    } catch (_e) {}
    filtered = items.filter(matchesHost);
    console.log("[chatgpt-deep-ask] site history fallback (last 24h) for", host, ":", filtered.length);
  }

  const byUrl = new Map();
  for (const it of filtered) {
    const ex = byUrl.get(it.url);
    if (!ex || (it.lastVisitTime || 0) > (ex.lastVisitTime || 0)) byUrl.set(it.url, it);
  }

  const all = Array.from(byUrl.values());
  all.sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));
  const top = all.slice(0, 200);
  top.sort((a, b) => (a.lastVisitTime || 0) - (b.lastVisitTime || 0));

  const lines = top.map((it) => {
    const t = new Date(it.lastVisitTime || 0);
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    const title = (it.title || "").slice(0, 140).replace(/\s+/g, " ").replace(/\|/g, "/").trim();
    let pathOnly = it.url;
    try {
      const u = new URL(it.url);
      pathOnly = u.pathname + (u.search || "");
    } catch (_e) {}
    return `- ${hh}:${mm} | ${title} | ${pathOnly}`;
  });

  if (lines.length === 0) return null;

  const todayStr = new Date().toISOString().slice(0, 10);
  return (
    `다음은 내가 오늘(${todayStr}) 사이트 "${host}" 에서 방문한 페이지 목록입니다 (총 ${lines.length}개, 시간순 정렬). ` +
    `이 사이트에서 어떤 작업·주제에 시간을 썼는지, 어떤 흐름으로 탐색했는지 한국어로 정리하고 카테고리별로 묶어 핵심 활동을 요약해줘. ` +
    `URL은 경로(path) 단위로 묶고, 개인정보가 포함될 수 있는 경로는 일반화해서 언급해줘.\n\n` +
    lines.join("\n")
  );
}

const UNSUPPORTED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "view-source:",
  "devtools://",
  "https://chrome.google.com/webstore",
  "https://chromewebstore.google.com"
];

function isInjectableUrl(url) {
  if (!url) return false;
  return !UNSUPPORTED_URL_PREFIXES.some((p) => url.startsWith(p));
}

const POPUP_SIZE_KEY = "popupWindowSize";
const DEFAULT_POPUP_SIZE = { width: 780, height: 880 };

async function getStoredPopupSize() {
  try {
    const data = await chrome.storage.local.get([POPUP_SIZE_KEY]);
    const s = data[POPUP_SIZE_KEY];
    if (s && Number.isFinite(s.width) && Number.isFinite(s.height) && s.width >= 320 && s.height >= 320) {
      return { width: Math.round(s.width), height: Math.round(s.height) };
    }
  } catch (_e) {}
  return { ...DEFAULT_POPUP_SIZE };
}

async function createTrackedPopup(url) {
  const size = await getStoredPopupSize();
  const win = await chrome.windows.create({
    url,
    type: "popup",
    width: size.width,
    height: size.height,
    focused: true
  });
  if (win?.id) {
    try {
      const cur = await chrome.storage.session.get(["trackedPopupIds"]);
      const ids = new Set(cur.trackedPopupIds || []);
      ids.add(win.id);
      await chrome.storage.session.set({ trackedPopupIds: [...ids] });
    } catch (_e) {}
  }
  return win;
}

if (chrome.windows.onBoundsChanged) {
  chrome.windows.onBoundsChanged.addListener(async (window) => {
    if (!window?.id || !window.width || !window.height) return;
    try {
      const cur = await chrome.storage.session.get(["trackedPopupIds"]);
      const ids = cur.trackedPopupIds || [];
      if (!ids.includes(window.id)) return;
      await chrome.storage.local.set({
        [POPUP_SIZE_KEY]: { width: window.width, height: window.height }
      });
      console.log("[chatgpt-deep-ask] popup size saved:", window.width, "x", window.height);
    } catch (_e) {}
  });
}

chrome.windows.onRemoved.addListener(async (windowId) => {
  try {
    const cur = await chrome.storage.session.get(["trackedPopupIds"]);
    const ids = (cur.trackedPopupIds || []).filter((id) => id !== windowId);
    await chrome.storage.session.set({ trackedPopupIds: ids });
  } catch (_e) {}
});

async function ensureContentScript(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return Array.isArray(result) && result.length > 0;
  } catch (e) {
    console.warn("[chatgpt-deep-ask] executeScript failed:", e?.message || e);
    return false;
  }
}

async function sendMessageWithRetry(tabId, message) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_e) {}

  if (tab && !isInjectableUrl(tab.url)) {
    console.warn(
      "[chatgpt-deep-ask] cannot inject into this URL:",
      tab.url,
      "— content script은 chrome://, 웹스토어, devtools 등에는 주입할 수 없습니다. 일반 웹페이지에서 다시 시도하세요."
    );
    return undefined;
  }

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_e1) {
    const injected = await ensureContentScript(tabId);
    if (!injected) {
      console.warn(
        "[chatgpt-deep-ask] content script 주입 실패 — 탭을 한 번 새로고침하면 manifest의 content_scripts가 자동 주입됩니다. URL:",
        tab?.url
      );
      return undefined;
    }
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e2) {
      console.warn("[chatgpt-deep-ask] sendMessage failed after inject:", e2?.message || e2);
      return undefined;
    }
  }
}

async function showOverlayInTab(tabId, prompt, options = {}) {
  if (!prompt) return;
  await sendMessageWithRetry(tabId, {
    type: "SHOW_OVERLAY",
    prompt,
    options
  });
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(ok);
    };
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish(true);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => finish(false), timeoutMs);
  });
}

async function openInPopupWindow(prompt) {
  if (!prompt) {
    console.warn("[chatgpt-deep-ask] openInPopupWindow: empty prompt");
    return;
  }
  console.log("[chatgpt-deep-ask] opening popup window. prompt length:", prompt.length);
  const win = await createTrackedPopup("https://chatgpt.com/");
  const tab = win?.tabs?.[0];
  if (!tab?.id) {
    console.warn("[chatgpt-deep-ask] popup window has no tab");
    return;
  }
  const ok = await waitForTabComplete(tab.id);
  if (!ok) {
    console.warn("[chatgpt-deep-ask] popup window did not finish loading in time");
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 1 ? 2000 : 2000));
    console.log("[chatgpt-deep-ask] DIRECT_SUBMIT attempt", attempt);
    const ack = await sendMessageWithRetry(tab.id, { type: "DIRECT_SUBMIT", prompt });
    if (ack?.ok) {
      console.log("[chatgpt-deep-ask] DIRECT_SUBMIT acked at attempt", attempt, ack);
      return;
    }
    console.log("[chatgpt-deep-ask] no ok ack, ack=", ack);
  }
  console.warn("[chatgpt-deep-ask] DIRECT_SUBMIT failed after all retries");
}

const NOTIFICATION_ICON_PATH = "notification-icon.png";

async function showResponseDoneNotification(detail) {
  console.log("[chatgpt-deep-ask] showResponseDoneNotification called. detail:", detail);
  const permission = await new Promise((r) => {
    try {
      chrome.notifications.getPermissionLevel((level) => r(level));
    } catch (_e) {
      r("unknown");
    }
  });
  console.log("[chatgpt-deep-ask] notification permission level:", permission);

  const iconUrl = chrome.runtime.getURL(NOTIFICATION_ICON_PATH);
  const opts = {
    type: "basic",
    iconUrl,
    title: "ChatGPT 응답 완료",
    message: detail || "답변이 도착했습니다. 패널을 확인하세요.",
    priority: 2,
    requireInteraction: false
  };
  console.log("[chatgpt-deep-ask] notifications.create with iconUrl:", iconUrl);
  try {
    chrome.notifications.create(opts, (notificationId) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.warn("[chatgpt-deep-ask] notifications.create error:", err.message);
      } else {
        console.log("[chatgpt-deep-ask] notification created. id:", notificationId);
      }
    });
  } catch (e) {
    console.warn("[chatgpt-deep-ask] notification create threw:", e);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SHOW_NOTIFICATION") {
    console.log("[chatgpt-deep-ask] SHOW_NOTIFICATION received from", sender?.tab?.url || "(unknown)");
    showResponseDoneNotification(msg.detail);
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "TEMPLATES_UPDATED") {
    buildTemplateMenus().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "RERUN_HISTORY") {
    (async () => {
      try {
        const data = await chrome.storage.local.get([HISTORY_KEY]);
        const list = data[HISTORY_KEY] || [];
        const entry = list.find((e) => e.id === msg.id);
        if (!entry || !entry.prompt) {
          sendResponse({ ok: false, error: "not found" });
          return;
        }
        await openInPopupWindow(entry.prompt);
        await recordHistory("rerun", entry.prompt, entry.host || "");
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: ASK_MENU_ID,
      title: "ChatGPT로 상세 질문하기",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: ASK_WITH_CONTEXT_MENU_ID,
      title: "선택 + 페이지 컨텍스트로 ChatGPT 질문",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: SUMMARIZE_MENU_ID,
      title: "오늘 활동 요약하기 (백그라운드)",
      contexts: ["page", "selection", "link", "frame"]
    });
    chrome.contextMenus.create({
      id: SUMMARIZE_SITE_MENU_ID,
      title: "이 사이트 활동 요약하기",
      contexts: ["page", "selection", "link", "frame"]
    });
    buildTemplateMenus();
  });
});

chrome.runtime.onStartup?.addListener(() => {
  buildTemplateMenus().catch((e) => console.warn("buildTemplateMenus startup:", e));
});

function isChatgptOrigin(url) {
  return !!url && /^https?:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === ASK_MENU_ID) {
    const text = (info.selectionText || "").trim();
    if (!text) return;
    const prompt = buildSelectionPrompt(text);
    recordHistory("ask-detail", prompt, tab.url);
    if (isChatgptOrigin(tab.url) && isInjectableUrl(tab.url)) {
      await showOverlayInTab(tab.id, prompt);
    } else {
      console.log(
        "[chatgpt-deep-ask] non-ChatGPT origin (",
        tab.url,
        "), opening popup window for reliable auth"
      );
      await openInPopupWindow(prompt);
    }
  } else if (info.menuItemId === ASK_WITH_CONTEXT_MENU_ID) {
    if (!isInjectableUrl(tab.url)) {
      console.warn("[chatgpt-deep-ask] cannot extract context from", tab.url);
      return;
    }
    const ctx = await sendMessageWithRetry(tab.id, { type: "GET_PAGE_CONTEXT" });
    if (!ctx?.selection) {
      console.warn("[chatgpt-deep-ask] no selection in GET_PAGE_CONTEXT response");
      return;
    }
    const prompt = buildContextPrompt(ctx);
    recordHistory("ask-with-context", prompt, tab.url);
    if (isChatgptOrigin(tab.url) && isInjectableUrl(tab.url)) {
      await showOverlayInTab(tab.id, prompt);
    } else {
      await openInPopupWindow(prompt);
    }
  } else if (info.menuItemId === SUMMARIZE_MENU_ID) {
    const prompt = await buildTodayHistoryPrompt();
    if (!prompt) {
      console.warn("[chatgpt-deep-ask] no history items today");
      return;
    }
    recordHistory("summarize-today", prompt, tab.url);
    await openInPopupWindow(prompt);
  } else if (typeof info.menuItemId === "string" && info.menuItemId.startsWith(TEMPLATE_MENU_PREFIX)) {
    const tplId = info.menuItemId.slice(TEMPLATE_MENU_PREFIX.length);
    const text = (info.selectionText || "").trim();
    if (!text) return;
    const templates = await getTemplates();
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) {
      console.warn("[chatgpt-deep-ask] template not found:", tplId);
      return;
    }
    const prompt = applyTemplate(tpl, { text, url: tab.url || "", title: tab.title || "" });
    recordHistory("template", prompt, tab.url);
    if (isChatgptOrigin(tab.url) && isInjectableUrl(tab.url)) {
      await showOverlayInTab(tab.id, prompt);
    } else {
      await openInPopupWindow(prompt);
    }
  } else if (info.menuItemId === SUMMARIZE_SITE_MENU_ID) {
    let host = "";
    try {
      host = new URL(tab.url).hostname;
    } catch (_e) {}
    if (!host) {
      console.warn("[chatgpt-deep-ask] cannot determine host from tab.url:", tab.url);
      return;
    }
    const prompt = await buildSiteHistoryPrompt(host);
    if (!prompt) {
      console.warn("[chatgpt-deep-ask] no history items for site", host);
      return;
    }
    recordHistory("summarize-site", prompt, tab.url);
    await openInPopupWindow(prompt);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "ask-detail-from-selection") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const resp = await sendMessageWithRetry(tab.id, { type: "GET_SELECTION" });
    const text = (resp?.text || "").trim();
    if (!text) return;
    const prompt = buildSelectionPrompt(text);
    recordHistory("shortcut-ask", prompt, tab.url);
    if (isChatgptOrigin(tab.url) && isInjectableUrl(tab.url)) {
      await showOverlayInTab(tab.id, prompt);
    } else {
      await openInPopupWindow(prompt);
    }
    return;
  }
  if (command === "test-capture") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    recordHistory("capture", "[화면 캡처] 이 이미지에 대해 설명해줘.", tab?.url || "");
    await testCapture();
    return;
  }
});

async function testCapture() {
  console.log("[chatgpt-deep-ask] capture triggered");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch (e) {
    console.warn("[chatgpt-deep-ask] captureVisibleTab threw:", e?.message || e);
    return;
  }
  if (!dataUrl) {
    console.warn("[chatgpt-deep-ask] captureVisibleTab empty:", chrome.runtime.lastError?.message);
    return;
  }
  console.log("[chatgpt-deep-ask] capture ok, size:", Math.round(dataUrl.length / 1024), "KB → opening ChatGPT popup");
  await openCaptureInPopup(dataUrl);
}

async function openCaptureInPopup(imageDataUrl) {
  if (!imageDataUrl) return;
  const win = await createTrackedPopup("https://chatgpt.com/");
  const tab = win?.tabs?.[0];
  if (!tab?.id) {
    console.warn("[chatgpt-deep-ask] popup window has no tab");
    return;
  }
  const ok = await waitForTabComplete(tab.id);
  if (!ok) console.warn("[chatgpt-deep-ask] popup did not finish loading in time");
  await new Promise((r) => setTimeout(r, 2000));

  for (let attempt = 1; attempt <= 5; attempt++) {
    console.log("[chatgpt-deep-ask] ATTACH_IMAGE attempt", attempt);
    const ack = await sendMessageWithRetry(tab.id, {
      type: "ATTACH_IMAGE",
      dataUrl: imageDataUrl,
      prompt: "이 이미지에 대해 설명해줘."
    });
    if (ack?.ok) {
      console.log("[chatgpt-deep-ask] ATTACH_IMAGE acked at attempt", attempt);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn("[chatgpt-deep-ask] ATTACH_IMAGE failed after retries");
}
