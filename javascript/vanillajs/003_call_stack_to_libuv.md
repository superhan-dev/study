# 작성일

- 2025-11-25

# call stack에서 libuv로 넘어가는 두가지 경로

Javascript의 callstack 에서 비동기 API를 호출하게되면 c++ 바인딩을 통해 libuv로 넘어가게 된다.

이때 다음 두가지 종류의 연산이 있다.

- OS 비동기 I/O + event demultiplexer를 사용하는 연산
- thread pool을 사용해서 멀티 스레딩을 하는 연산

## OS 비동기 I/O + event demultiplexer

주로 네트워크 I/O의 경우 파일 디스크립터를 epoll/kqueue/IOCP 같은 event demultiplexer 에 등록되는 경우 커널이 I/O를 처리한뒤 event demultiplexcer에게 알려주는 방식으로 처리하고 이벤트가 발생하면 libuv의 이벤트 루프가 그 이벤트를 읽어와 콜백큐에 넣고 JS callback이 실행되게 된다.

> net, http, https, ws 등 TCP/UDP 소켓 기반 모듈

1. 파일 디스크립터(FD)를 epoll/kqueue/IOCP 같은 event demultiplexer에 등록
2. 커널이 알아서 I/O를 처리한 뒤 “읽을 게 있다/쓸 수 있다” 이벤트를 demultiplexer로 알려줌
3. libuv 이벤트 루프가 그 이벤트를 읽어 와서 콜백 큐에 집어넣고
4. JS 콜백이 실행됨

## Thread pool을 사용하는 연산

JS 콜스텍에서 비동기 함수 호출를 호출하면 C++ 바인딩 이후 libuv thread pool(워커 스레드)에 작업이 큐잉된다.

워커 스레드가 블로킹 System call로 직접 실행하고 끝나면 libuv 내부 완료 큐에 결과를 넣어준다.(이벤트 큐)

이벤트큐를 루핑하던 이벤트 루프에 의해 결과 콜백에 JS의 call stack으로 들어가 실행된다.

> fs.readFile, fs.writeFile, fs.stat …
> dns.lookup(옵션에 따라), crypto.pbkdf2, crypto.randomBytes, zlib.\* 등

1. JS 콜스택에서 비동기 함수 호출
2. C++ 바인딩 → libuv의 thread pool(워커 스레드)에 작업 큐잉
3. 워커 스레드가 블로킹 system call 직접 실행
4. 끝나면 libuv 내부의 완료 큐에 “끝났다”라고 결과를 넣음
5. 이벤트 루프가 그 큐를 보고 JS 콜백을 실행

OS event demultiplexer(epoll 등)를 거치지 않는다. 워커스레드가 직접 작업하고 끝나면 이벤트 큐에 넣어주는 방식으로 동작한다.
