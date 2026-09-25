# SharedWorker 데모 노트

## 무엇을 고쳤는가

- SharedWorker의 `onmessage` 핸들러에서 `e.ports[0]`를 읽던 코드를 제거했습니다. (`MessagePort`의 `message` 이벤트에는 `ports`가 없습니다)
- `onconnect` 시점에 포트를 `Set`에 저장해 브로드캐스트 대상이 유지되도록 했습니다.
- 각 페이지에서 `port.start()`를 호출해 메시지 수신을 확실히 활성화했습니다.

## 추가된 진단 로그

- 각 페이지에서 `worker.onerror`와 `port.onmessageerror`를 로그로 출력하도록 추가했습니다.
- 워커가 연결될 때 모든 포트로 `connected` 이벤트를 브로드캐스트해 연결 상태를 확인할 수 있게 했습니다.

## 동작 확인 방법

- 반드시 HTTP로 열어야 합니다. (`file://`에서는 SharedWorker가 막힐 수 있음)
  - `http://localhost:3000/red.html`
  - `http://localhost:3000/blue.html`
- 각 페이지는 워커로 초기 `hello` 메시지를 전송합니다.
- 페이지 콘솔에 아래 로그가 보여야 합니다.
  - `[Red] Message from worker: ...`
  - `[Blue] Message from worker: ...`
- 워커 로그는 SharedWorker 전용 콘솔에서 확인합니다.
  - Chrome: DevTools → Application → Shared workers → Inspect

## 수정된 파일

- public/shared-worker.js
- public/red.js
- public/blue.js

## 멀티스레드 자바스크립트 관점에서의 동작 원리 (프로세스/스레드)

이 프로젝트의 `red.js`/`blue.js`는 탭의 **메인 스레드**에서 실행되고, `shared-worker.js`는 **워커 스레드**에서 실행됩니다. 브라우저는 탭(렌더러 프로세스)을 띄우고 그 안에서 메인 스레드와 워커 스레드를 분리해 동작시키며, 서로 간에는 **메모리 공유가 아닌 메시지 전달**로만 통신합니다.

### 프로세스와 스레드의 관점

- **프로세스(Process)**: 메모리 주소 공간이 분리된 실행 단위. 브라우저는 탭 격리 등을 위해 여러 프로세스를 사용합니다.
- **스레드(Thread)**: 하나의 프로세스 내부에서 병렬 실행되는 실행 흐름.

현재 코드 기준 실행 위치:

- `public/red.js`, `public/blue.js` → **렌더러 프로세스의 메인 스레드**
- `public/shared-worker.js` → **워커 스레드** (브라우저 구현에 따라 별도 프로세스일 수 있으나, 메인 스레드와 분리된 실행 흐름이라는 점이 핵심)

### SharedWorker가 탭 간 공유를 만드는 방식

- 동일한 **origin(프로토콜+호스트+포트)** 과 동일한 스크립트 URL(`./shared-worker.js`)을 사용하는 모든 탭은 **하나의 SharedWorker 인스턴스를 공유**합니다.
- `red.html`과 `blue.html`이 같은 워커를 참조하므로 **하나의 워커에 여러 포트가 연결**됩니다.

### 이벤트 루프와 메시지 전달

- 메인 스레드와 워커 스레드는 **각자 이벤트 루프**를 가집니다.
- `postMessage`는 **동기 호출이 아니라 메시지 큐에 이벤트를 등록**합니다.
- 데이터는 **구조적 복사(structured clone)** 로 전달되며, 직접 메모리를 공유하지 않습니다.

통신 흐름 요약:

1. 메인 스레드에서 `worker.port.postMessage(...)` 호출
2. 브라우저가 메시지를 복사하여 워커의 메시지 큐에 등록
3. 워커 스레드의 `port.onmessage` 실행
4. 워커가 다시 `postMessage`로 브로드캐스트
5. 각 탭의 `port.onmessage`에서 수신 처리

### DOM 접근 제한

- 워커는 **DOM 접근이 불가**합니다. (`document` 없음)
- DOM은 메인 스레드에서만 접근 가능하므로 워커는 **계산/IO 등 백그라운드 작업**에 적합합니다.

### 이번 수정에서 핵심적으로 고친 점

- `MessagePort`의 `message` 이벤트에는 `ports`가 없으므로 `e.ports[0]` 접근을 제거했습니다.
- `onconnect` 시점에 포트를 `Set`에 저장해 브로드캐스트 대상이 유지되도록 했습니다.
- 각 탭에서 `port.start()`를 호출해 메시지 수신을 확실히 활성화했습니다.

### 학습 포인트 요약

- JS는 단일 스레드 언어지만, 브라우저는 워커를 통해 **멀티스레드 실행**을 제공합니다.
- 공유 메모리가 아니라 **메시지 전달 기반**이므로 안전성이 높지만 데이터 복사 비용이 있습니다.
- `SharedWorker`는 **탭 간 공유 상태**를 만들 수 있는 구조입니다.
