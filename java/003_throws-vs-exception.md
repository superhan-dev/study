# throws vs Exception에 대해 정리

# 핵심 차이

- throw: 예외 객체를 지금 여기서 던지는 행위를 만드는 키워드.
- Exception: 던져지는 것 자체인 예외 타입(클래스). 즉, Throwable 계층의 한 분류.

### 함께 많이 헷갈리는 throws

- throws: 이 메서드는 이런 예외를 밖으로 던질 수 있어요 라고 메서드 시그니처에 선언하는 키워드.
  → “여기서 처리 안 하고 호출한 쪽에서 처리해 주세요”라는 계약.

비교 표

| 항목   | `throw`                                           | `throws`                                      | `Exception`                                  |
| ------ | ------------------------------------------------- | --------------------------------------------- | -------------------------------------------- |
| 정체   | 키워드(문)                                        | 키워드(선언)                                  | 클래스(타입)                                 |
| 역할   | 예외 **객체를 즉시 던짐**                         | 메서드가 **던질 수 있음을 선언**              | **던질 예외의 종류**를 표현                  |
| 위치   | **메서드/블록 본문 내부**                         | **메서드 선언부**                             | 변수, 파라미터, 상속, `catch` 타입 등에 사용 |
| 타이밍 | 런타임 실행 시 **바로 제어가 호출자/캐치로 이동** | 컴파일 타임에 **체크드 예외** 선언 요구(검사) | 런타임에 **예외 인스턴스**가 실제로 던져짐   |
| 예시   | `throw new IllegalArgumentException();`           | `void f() throws IOException { ... }`         | `class MyException extends Exception {}`     |

## 예제

1. throw로 직접 던지기

```java
void save(User u) {
    if (u == null) {
    throw new IllegalArgumentException("user is null");
    }
    // ...
}
```

2. throws로 바깥에 위임하기(체크드 예외)

```java
void loadFromFile(String path) throws IOException {
   Files.readString(Path.of(path)); // IOException 발생 가능
}
```

3. Exception은 “무슨 타입을 던지나”

```java
class MyBizException extends RuntimeException { // 언체크드 예외
   public MyBizException(String msg) { super(msg); }
}

void doWork() {
    throw new MyBizException("biz rule violated");
}
```

# 체크드 vs 언체크드(참고)

- 체크드 예외(Exception 하위, RuntimeException 제외):
  메서드에서 발생 가능하면 throws로 선언하거나 try-catch로 처리해야 컴파일 통과.
- 언체크드 예외(RuntimeException 하위):
  선언/처리 강제 아님. 주로 프로그래밍 오류, 사전 검증 실패에 사용.

# 베스트 프랙티스(요약)

- 도메인/검증 실패: 의미 있는 커스텀 RuntimeException 사용 + 메시지/컨텍스트 풍부하게.
- I/O, 네트워크, 파일 등 외부 자원: 체크드 예외를 상위 계층으로 위임(throws) 하고, 경계(컨트롤러/핸들러)에서 일괄 변환/로깅.
- 불필요한 일반 Exception 사용 지양: 구체 타입으로 명확히.
- 재던지기 시 원인 보존: throw new XyzException("...", e);

# 한 줄 요약

- throw = “지금 이 예외 던져!”
- throws = “이 메서드는 이런 예외 던질 수 있음”
- Exception = “던져지는 것의 타입”
