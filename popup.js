const HISTORY_KEY = "callHistory";

function relTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "방금 전";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}

function typeLabel(type) {
  switch (type) {
    case "ask-detail": return "상세 질문";
    case "ask-with-context": return "선택+컨텍스트";
    case "summarize-today": return "오늘 요약";
    case "summarize-site": return "사이트 요약";
    case "capture": return "캡처";
    case "shortcut-ask": return "단축키 질문";
    case "template": return "템플릿";
    default: return type || "기타";
  }
}

async function load() {
  const data = await chrome.storage.local.get([HISTORY_KEY]);
  return data[HISTORY_KEY] || [];
}

async function clearAll() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  render([]);
}

function render(items) {
  const list = document.getElementById("list");
  const countLabel = document.getElementById("count-label");
  list.innerHTML = "";
  countLabel.textContent = items.length ? `${items.length}건` : "";

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "아직 호출 기록이 없습니다.\n페이지에서 우클릭 → ChatGPT 메뉴를 사용해 보세요.";
    empty.style.whiteSpace = "pre-line";
    list.appendChild(empty);
    return;
  }

  // Newest first
  const sorted = items.slice().sort((a, b) => b.ts - a.ts);
  for (const item of sorted.slice(0, 30)) {
    const row = document.createElement("div");
    row.className = "item";
    row.title = "클릭해서 같은 프롬프트로 다시 실행";

    const r1 = document.createElement("div");
    r1.className = "item-row1";
    const t = document.createElement("span");
    t.className = "item-type";
    t.textContent = typeLabel(item.type);
    r1.appendChild(t);
    if (item.host) {
      const h = document.createElement("span");
      h.style.fontSize = "11px";
      h.style.color = "var(--muted)";
      h.textContent = item.host;
      r1.appendChild(h);
    }
    const tm = document.createElement("span");
    tm.className = "item-time";
    tm.textContent = relTime(item.ts);
    r1.appendChild(tm);
    row.appendChild(r1);

    const s = document.createElement("div");
    s.className = "item-summary";
    s.textContent = item.summary || "(요약 없음)";
    row.appendChild(s);

    row.addEventListener("click", async () => {
      try {
        await chrome.runtime.sendMessage({ type: "RERUN_HISTORY", id: item.id });
        window.close();
      } catch (e) {
        console.warn("rerun failed:", e);
      }
    });

    list.appendChild(row);
  }
}

document.getElementById("clear-btn").addEventListener("click", clearAll);
document.getElementById("options-link").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

load().then(render);
