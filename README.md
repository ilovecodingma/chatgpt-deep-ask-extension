# ChatGPT 상세 질문 패널 (Chrome Extension)

ChatGPT를 옆에서 도구처럼 쓰게 해주는 크롬 확장. 네 가지 진입 경로가 있습니다.

## 1. 선택 텍스트 → 상세 질문

- 어떤 페이지에서나 텍스트 드래그 → 우클릭 → **"ChatGPT로 상세 질문하기"**
- 또는 선택 후 `Ctrl+Shift+Q` (Mac: `Cmd+Shift+Q`)
- **chatgpt.com에서 호출**: 우클릭 좌표 바로 아래에 floating 패널(iframe 내장)이 뜨고 자동 전송. 헤더 드래그로 이동, 우/하단/우하단 코너 드래그로 크기 조절 (크기는 `localStorage`에 저장).
- **다른 사이트에서 호출**: cross-origin iframe엔 ChatGPT의 `SameSite=Lax` 인증 쿠키가 흐르지 않아 로그아웃으로 보이는 문제가 있어, 별도 popup window(기본 780×880, 탭/주소창 없음)로 띄워 거기서 자동 전송. 같은 브라우저 세션이라 로그인 그대로 유지.

## 2. 오늘 활동 요약하기

- 어떤 페이지에서든 우클릭 → **"오늘 활동 요약하기 (백그라운드)"**
- `chrome.history.search`로 오늘 0시 이후 방문한 URL/제목을 수집 (없으면 last 24h fallback). URL 중복 제거 후 최대 150개, 시간순 정렬한 프롬프트를 만들어 ChatGPT에 전송.
- 항상 별도 popup window로 처리 (cross-origin 이슈 회피).

## 3. 이 사이트 활동 요약하기

- 어떤 페이지에서든 우클릭 → **"이 사이트 활동 요약하기"**
- 현재 탭 URL의 호스트(예: `naver.com`)를 추출해, 그 도메인 + 서브도메인의 오늘(없으면 24h) 방문 기록만 필터링.
- URL 중복 제거 후 최대 200개, 시간 + 제목 + path만 표시한 프롬프트로 ChatGPT가 그 사이트에서의 활동만 카테고리별로 요약.

## 4. 화면 캡처 → ChatGPT 분석 (Ctrl+Shift+S)

- 일반 웹페이지에서 `Ctrl+Shift+S` (Mac: `Cmd+Shift+S`)
- `chrome.tabs.captureVisibleTab`으로 현재 보이는 탭 영역을 PNG로 캡처.
- popup window의 ChatGPT에 자동 첨부 + "이 이미지에 대해 설명해줘." 프롬프트로 자동 전송.
- 이미지 첨부는 paste event / `<input type="file">` change / drop event 3중 fallback으로 시도.

## Popup window 크기 기억

popup으로 뜨는 케이스(다른 사이트에서의 상세 질문, 활동 요약, 캡처)는 OS 차원에서 가장자리 드래그로 크기 조절 가능. 마지막으로 조절한 크기는 `chrome.storage.local`에 저장되어 다음 호출 시 그대로 복원됨.

## 동작 메커니즘 요약

- 패널 iframe URL: `https://chatgpt.com/#deepAsk=1` — 프롬프트는 URL이 아닌 **postMessage**로 전달 (URL 길이 제한 회피).
- 부모 ↔ iframe 메시지 시퀀스: `DEEP_ASK_READY → DEEP_ASK_PROMPT → DEEP_ASK_SUBMITTED → DEEP_ASK_DONE` (또는 `DEEP_ASK_ERROR`).
- iframe content script는 ChatGPT 편집창(`#prompt-textarea` ProseMirror)을 찾고:
  1. 비어있으면 `document.execCommand("insertText")` 또는 native value setter로 강제 주입
  2. send 버튼 enable되면 클릭, 안 되면 Enter dispatch fallback
  3. `[data-testid="stop-button"]` 폴링으로 응답 완료 감지 (최대 10분)
- popup window 흐름은 top-level 컨텍스트라 동일 로직을 `DIRECT_SUBMIT` / `ATTACH_IMAGE` 메시지로 직접 호출.
- chatgpt.com이 아닌 페이지에서 패널을 띄울 때 `X-Frame-Options`/`CSP frame-ancestors` 차단을 풀기 위해 `declarativeNetRequest`로 sub_frame 응답에서 그 헤더들을 제거 (`rules.json`).

## 설치 (개발자 모드 로드)

1. Chrome → `chrome://extensions` 진입
2. 우상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** 클릭
4. 이 폴더(`chatgpt-deep-ask-extension`) 선택
5. 사용할 탭은 한 번 새로고침 (이미 열려 있던 탭에는 content_scripts 자동 주입이 안 됩니다 — background가 `chrome.scripting`으로 보강 주입을 시도)

## Manifest 권한

- `contextMenus` — 우클릭 메뉴 항목 등록
- `scripting` — content script 보강 주입 (`chrome.scripting.executeScript`)
- `tabs` — 탭 정보 조회 / 메시지 송수신
- `history` — `chrome.history.search`로 오늘/사이트별 방문 기록 조회
- `declarativeNetRequest` — chatgpt.com sub_frame 응답에서 X-Frame-Options/CSP 제거
- `storage` — popup window 크기 영구 저장
- `host_permissions: ["<all_urls>"]` — 모든 사이트에서 content script + 탭 캡처 동작

## 한계 / 트러블슈팅

### "Could not establish connection. Receiving end does not exist."
확장 reload 이전부터 열려있던 탭은 manifest의 content_scripts가 자동 주입되지 않습니다. background가 `chrome.scripting.executeScript`로 보강 주입을 시도하지만, 그래도 안 되면 그 탭을 한 번 새로고침하세요.

### `chrome://`, 웹스토어, devtools 페이지에서 동작 안 함
content script 주입 자체가 Chrome 보안 정책으로 막혀 있습니다. 일반 http/https 페이지에서만 동작.

### 자동 전송이 안 됨
ChatGPT의 send 버튼/편집창 셀렉터가 바뀐 경우입니다. `content.js`의 `SEND_BUTTON_SELECTORS` / `EDITOR_SELECTORS_ORDERED`에 새 셀렉터를 추가하세요.

### 응답 완료 감지 안 됨
`STOP_BUTTON_SELECTORS`에 새 셀렉터를 추가하거나, panel을 직접 클릭해서 수동으로 펼치세요.

### history가 비어있다고 나옴
`chrome.history.search`는 시크릿 모드 탭, chrome:// / file:// 같은 시스템 페이지는 반환하지 않습니다. 일반 탭에서 방문한 http(s)만 집계됩니다.
