const TEMPLATES_KEY = "promptTemplates";

const DEFAULT_TEMPLATES = [
  {
    id: "easy",
    title: "쉽게 설명",
    template: '아래 부분을 초보자가 이해할 수 있게 쉬운 말로 풀어 설명해줘.\n\n"""{TEXT}"""'
  },
  {
    id: "tldr",
    title: "TL;DR (한두 문장 요약)",
    template: '아래 내용을 한국어로 1~2문장 핵심만 요약해줘.\n\n"""{TEXT}"""'
  },
  {
    id: "translate-en",
    title: "영어로 번역",
    template: '다음을 자연스러운 영어로 번역해줘.\n\n"""{TEXT}"""'
  },
  {
    id: "translate-ko",
    title: "한국어로 번역",
    template: '다음을 자연스러운 한국어로 번역해줘.\n\n"""{TEXT}"""'
  },
  {
    id: "code-review",
    title: "코드 리뷰",
    template: '아래 코드를 리뷰해줘 — 버그, 성능, 가독성 관점에서. 개선 제안도 같이.\n\n```\n{TEXT}\n```'
  },
  {
    id: "explain-jargon",
    title: "용어 풀이",
    template: '다음에 등장하는 전문 용어를 하나씩 한국어로 풀어 설명해줘.\n\n"""{TEXT}"""'
  }
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function load() {
  const data = await chrome.storage.local.get([TEMPLATES_KEY]);
  let list = data[TEMPLATES_KEY];
  if (!Array.isArray(list) || list.length === 0) {
    list = DEFAULT_TEMPLATES.map((t) => ({ ...t }));
  }
  return list;
}

async function save(list) {
  await chrome.storage.local.set({ [TEMPLATES_KEY]: list });
  // Notify background to refresh menus
  try { chrome.runtime.sendMessage({ type: "TEMPLATES_UPDATED" }); } catch (_e) {}
}

function render(list) {
  const container = document.getElementById("templates");
  container.innerHTML = "";
  list.forEach((t, idx) => {
    const card = document.createElement("div");
    card.className = "template";
    card.dataset.id = t.id;

    const titleRow = document.createElement("div");
    titleRow.className = "template-row";
    titleRow.innerHTML = '<label>제목 (메뉴에 표시)</label>';
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = t.title || "";
    titleInput.dataset.field = "title";
    titleRow.appendChild(titleInput);
    card.appendChild(titleRow);

    const tplRow = document.createElement("div");
    tplRow.className = "template-row";
    tplRow.innerHTML = '<label>템플릿 ({TEXT}에 선택 텍스트가 들어감)</label>';
    const tplInput = document.createElement("textarea");
    tplInput.value = t.template || "";
    tplInput.dataset.field = "template";
    tplRow.appendChild(tplInput);
    card.appendChild(tplRow);

    const actions = document.createElement("div");
    actions.className = "template-actions";
    const delBtn = document.createElement("button");
    delBtn.textContent = "삭제";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      list.splice(idx, 1);
      render(list);
    });
    actions.appendChild(delBtn);
    card.appendChild(actions);

    container.appendChild(card);
  });
}

function readFromUI(list) {
  const cards = document.querySelectorAll(".template");
  return Array.from(cards).map((card) => {
    const id = card.dataset.id;
    const title = card.querySelector('[data-field="title"]').value.trim();
    const template = card.querySelector('[data-field="template"]').value;
    return { id, title, template };
  }).filter((t) => t.title && t.template);
}

let currentList = [];

function setStatus(text) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 1800);
}

document.getElementById("add-btn").addEventListener("click", () => {
  currentList.push({
    id: uid(),
    title: "새 템플릿",
    template: '아래 내용에 대해 설명해줘.\n\n"""{TEXT}"""'
  });
  render(currentList);
});

document.getElementById("reset-btn").addEventListener("click", () => {
  if (!confirm("기본 템플릿으로 되돌릴까요? 현재 편집 중인 내용은 사라집니다.")) return;
  currentList = DEFAULT_TEMPLATES.map((t) => ({ ...t }));
  render(currentList);
});

document.getElementById("save-btn").addEventListener("click", async () => {
  currentList = readFromUI(currentList);
  await save(currentList);
  setStatus("✓ 저장됨");
  render(currentList);
});

load().then((list) => {
  currentList = list;
  render(currentList);
});
