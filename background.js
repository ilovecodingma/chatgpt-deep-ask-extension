const ASK_MENU_ID = "ask-detail-popup";
const SUMMARIZE_MENU_ID = "summarize-today";

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
  const win = await chrome.windows.create({
    url: "https://chatgpt.com/",
    type: "popup",
    width: 780,
    height: 880,
    focused: true
  });
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: ASK_MENU_ID,
      title: "ChatGPT로 상세 질문하기",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: SUMMARIZE_MENU_ID,
      title: "오늘 활동 요약하기 (백그라운드)",
      contexts: ["page", "selection", "link", "frame"]
    });
  });
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
  } else if (info.menuItemId === SUMMARIZE_MENU_ID) {
    const prompt = await buildTodayHistoryPrompt();
    if (!prompt) {
      console.warn("[chatgpt-deep-ask] no history items today");
      return;
    }
    if (isInjectableUrl(tab.url)) {
      await showOverlayInTab(tab.id, prompt, { minimized: true });
    } else {
      console.log("[chatgpt-deep-ask] 현재 탭이 주입 불가 페이지여서 popup window로 처리합니다.");
      await openInPopupWindow(prompt);
    }
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "ask-detail-from-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const resp = await sendMessageWithRetry(tab.id, { type: "GET_SELECTION" });
  const text = (resp?.text || "").trim();
  if (!text) return;
  const prompt = buildSelectionPrompt(text);
  if (isChatgptOrigin(tab.url) && isInjectableUrl(tab.url)) {
    await showOverlayInTab(tab.id, prompt);
  } else {
    await openInPopupWindow(prompt);
  }
});
