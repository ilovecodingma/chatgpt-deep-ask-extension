# ChatGPT 상세 질문 패널 (Chrome Extension v0.5)

ChatGPT를 옆에서 도구처럼 쓸 수 있게 해주는 크롬 확장입니다. 두 가지 진입 경로가 있습니다.

## 1. 선택 텍스트 → 상세 질문

- 어떤 페이지에서나 텍스트 드래그 → 우클릭 → **"ChatGPT로 상세 질문하기"**
- 또는 선택 후 `Ctrl+Shift+Q` (Mac: `Cmd+Shift+Q`)
- **chatgpt.com 위에서 호출**: 우클릭 좌표 바로 아래에 floating 패널(iframe 내장)이 뜨고 자동 전송. 헤더 드래그로 이동, 우/하단/우하단 코너 드래그로 크기 조절 (크기는 localStorage에 저장).
- **다른 사이트에서 호출**: cross-origin iframe엔 ChatGPT 인증 쿠키가 흐르지 않아(SameSite=Lax) 로그아웃으로 보이는 문제가 있어서, 별도 popup window(780×880, 탭/주소창 없음)로 띄워 거기서 자동 전송. 같은 브라우저 세션이라 로그인 그대로 유지.

## 2. 오늘 활동 요약 (백그라운드)

- 어떤 페이지에서든 빈 영역 우클릭 → **"오늘 활동 요약하기 (백그라운드)"**
- background script가 `chrome.history.search`로 오늘 0시 이후 방문한 URL/제목을 모아 (URL 중복 제거 후 최대 150개, 시간순) 한국어 요약 프롬프트를 만듭니다.
- 페이지 우하단에 **300×44 작은 진행바**가 뜨고 (스피너 + "오늘 활동 요약 요청 중...") iframe은 화면 밖에 숨겨진 상태로 ChatGPT에 자동 전송, 응답을 받습니다.
- iframe content script가 stop 버튼이 사라지는 시점(스트리밍 종료)을 감지해 부모로 `DEEP_ASK_DONE` postMessage를 보내고, 부모는 패널을 자동으로 펼쳐 응답을 보여줍니다.
- 진행바를 직접 클릭해서 미리 펼칠 수도 있습니다.

## 동작 메커니즘 요약

- 패널 iframe URL: `https://chatgpt.com/#deepAsk=1` — 프롬프트는 URL이 아닌 **postMessage**로 전달 (URL 길이 제한 회피, 긴 history도 안전).
- 부모 ↔ iframe 메시지 시퀀스:
  1. iframe content script가 편집창을 찾으면 부모에 `DEEP_ASK_READY` 전송
  2. 부모가 `DEEP_ASK_PROMPT { prompt }` 응답
  3. iframe이 편집창에 강제 주입(`document.execCommand("insertText")` 또는 native value setter), send 버튼 클릭, fallback으로 Enter dispatch
  4. 제출 후 부모에 `DEEP_ASK_SUBMITTED`
  5. stop 버튼 나타남 → 사라짐 폴링으로 응답 완료 감지, 부모에 `DEEP_ASK_DONE`
- chatgpt.com이 아닌 다른 도메인 페이지에서 패널을 띄울 때 `X-Frame-Options`와 `CSP frame-ancestors`가 임베드를 막는 경우를 위해 `declarativeNetRequest`로 `chatgpt.com` sub_frame 응답에서 그 헤더들을 제거합니다 (`rules.json`).

## 설치 (개발자 모드 로드)

1. Chrome → `chrome://extensions` 진입
2. 우상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** 클릭
4. 이 폴더(`chatgpt-deep-ask-extension`) 선택
5. 사용할 탭은 한 번 새로고침 (이미 열려 있던 탭에는 content_scripts 자동 주입이 안 됩니다 — background가 `chrome.scripting`으로 보강 주입을 시도하긴 합니다.)

## 한계 / 트러블슈팅

### 다른 도메인에서 패널을 띄울 때 "Refused to connect"
chatgpt.com이 아닌 페이지에서 호출하면 iframe이 cross-origin입니다. `rules.json`이 헤더를 풀어주지만, 그래도 막히는 경우 chatgpt.com에 SameSite=Lax/Strict 쿠키가 있어 iframe에 인증이 안 따라올 수 있습니다. 그 경우 chatgpt.com 탭에서 호출하거나 `chrome://settings/cookies`에서 제3자 쿠키 정책을 조정하세요.

### 자동 전송이 안 됨
ChatGPT의 send 버튼 셀렉터가 바뀐 경우입니다. `content.js`의 `SEND_BUTTON_SELECTORS`에 새 셀렉터를 추가하세요. 5초 안에 못 찾으면 Enter dispatch fallback으로 시도하고, 그것도 안 먹히면 사용자가 패널 내에서 수동 Enter 가능합니다.

### 응답 완료가 감지 안 돼서 패널이 안 펼쳐짐
stop 버튼 셀렉터가 바뀐 경우입니다. `STOP_BUTTON_SELECTORS`에 추가하세요. 또는 진행바를 클릭해서 수동으로 펼칠 수 있습니다.

### history가 비어 있다고 나옴
`chrome.history.search`는 시크릿 모드 탭, 일부 시스템 페이지(chrome://, file://)는 반환하지 않습니다. 일반 탭에서 방문한 http/https만 집계됩니다.
