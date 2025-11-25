# 작성일

- 2025-11-25

# call stack

call stack은 V8 엔진 안에 속해있는 자원이다. 이랑 싱글스레드 환경에서 함수가 호출되면 생성되는 실행 컨텍트들이 들어있는 영역이다.

## non I/O operation

커널과 외부 자원에 접근하지 않고 순수 JS 내부에서 CPU만 쓰는 작업이다.

- 숫자 계산, 문자열 조작, 객체/백열 생성, 정렬, 필터링 등.
- JSON 파싱, 구조적 프로그래밍에 사용되는 모든 분기 처리 연산(if, else, then, map, reduce 등)
- 이미 메모리에 있는 데이터를 가공하는 처리

## I/O operation

기본적인 읽기 쓰기 작업을 의미하다. CPU 집약적인 파일처리 같은 경우 task queue를 거쳐 thread pool로 이동해 멀티스레딩 처리를 하게 된다.

- 파일 읽기/쓰기 (fs.readFile, fs.writeFile, socket I/O),
- 네트워크 통신 (HTTP 요청/응답, TCP/UDP 소켓)
- 타이머 (setTimeout, setInterval)
- DNS 조회, 암호화, 압축 등

## 모든 I/O가 thread pool로 가는 것은 아니다.

여기 말하는 thread pool이란 libuv가 관리하는 스레드 풀이다. 따라서 기본적인 OS 커널의 I/O를 처리하는 경우 스레드풀을 사용하지는 않는다.

### 커널 I/O를 사용하는 네트워크 소켓

- OS 커널의 비동기 I/O + event demultiplexcer(epoll, kqueue, IOCP) 사용
- libuv의 스레드 풀을 사용하지는 않는다.

#### 소켓이 I/O 되는 과정

소켓에 사용되는 스레드는 OS 단에서 관리되는 스레드를 사용한다.

1. 소켓이 열릴 때, 파일 디스크립터를 event demultiplexer(epoll) 에 등록
2. 커널이 네트워크 패킷 수신/송신 처리
3. FD에 읽을 데이터가 있다. 쓸 수 있다 는 이벤트를 epoll이 알려준다.
4. libuv 이벤트 루프가 이벤트를 읽어와서 JS 콜백을 호출한다.

### 스레드 풀을 사용하는 파일 I/O, 일부 DNS, crypto, 압축

- libuv thread pool에서 블로킹 system call로 처리된다.

# 정리

call stack에서 사용되는 I/O operation에 대해 알아보았다.
I/O 처리는 CPU 집약적이냐 아니냐에 따라 libuv의 스레드 풀을 사용하기도 하고 OS 단의 스레드를 사용하기도 한다.
