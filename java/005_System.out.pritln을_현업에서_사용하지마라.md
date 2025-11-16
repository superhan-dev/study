# 작성일

    - 2025-10-18

# System.out.println을 현업에서 사용하지 마라.

간단한 출력을 할때 사용하는 System.out.println을 현업에서 사용하지 마라는 권고사항들이 있다. 하지만 왜 사용하지 말라고 하는지 모르고 말만하는 사람들과 그럼에도 사용하는 개발자들도 존재한다.

그 이유를 알면 쓰라고 해도 쓰지 않을 것이지만 이유를 모르면 굳이 불편하게 다른 라이브러리를 쓰지? 라는 생각을 하게 될 것이다.

# 왜 사용하지 말라고 하는가?

사용하지 말라고 이야기 하는 이유는 단순하다. 성능 이슈가 발생하기 때문이다.

1.  블로킹 I/O

    - System.out.println은 기본적으로 블로킹 I/O를 발생시킨다. 따라서 값을 쓸때 전역 Lock을 획득하여 값을 쓰게 된다. 이 의미는 반대로 이야기 하면 다른 쓰레드가 값을 쓰고있으면 Lock을 획득할 때까지 아무것도 못하고 기다려야한다는 의미가 된다. 이는 당연하게 성능 이슈로 이어질 수 밖에 없다.

1.  로그 레벨 관리가 어려움

    - 로그 레벨의 관리가 어렵다는 것은 무작위로 어디서 찍히는지 모르는 로그가 찍힌다는 것이다. 물론 표시를 잘 하면 되겠지만 컨벤션이 정해져 있지 않다면 협업시 굉장히 어지러워 지게 될 것이다.
      이는 자연스럽게 유지보수성 저하로 이어진다.

1.  백프레셔 제어 부재

    - 로그가 폭주했을 시 상황에 따라 로그를 포기하는 제어 로직을 통해 서비스의 안정성을 유지해야할 필요가 생겼을 때 설정을 할 수 없으므로 운영환경에 영향을 주게 된다.

1.  실제 코드
    코드를 확인해보면 `synchronized`를 사용해서 값을 print 하고있는 것을 확인할 수 있다. println에서부터 블로킹 I/O를 사용하고 있지만 사실상 print 함수에서 사용하는 write에서도 `synchronized`를 사용하고 있다.

```java
    /**
    * Prints an integer and then terminate the line.  This method behaves as
    * though it invokes {@link #print(int)} and then
    * {@link #println()}.
    *
    * @param x  The {@code int} to be printed.
    */
    public void println(int x) {
        if (getClass() == PrintStream.class) {
            writeln(String.valueOf(x));
        } else {
            synchronized (this) {
                print(x);
                newLine();
            }
        }
    }
```

- print에서 사용하는 write함수 안에서도 synchronized를 사용한다.

```java
 private void write(String s) {
     try {
         synchronized (this) {
             ensureOpen();
             textOut.write(s);
             textOut.flushBuffer();
             charOut.flushBuffer();
             if (autoFlush && (s.indexOf('\n') >= 0))
                 out.flush();
         }
     }
     catch (InterruptedIOException x) {
         Thread.currentThread().interrupt();
     }
     catch (IOException x) {
         trouble = true;
     }
 }
```

# 그럼 뭘 써야하나?

대체되는 라이브러리는 `log4j`, `Logback` 등을 사용하며 이를 `slf4j` 인터페이스를 사용하여 유연하게 사용할 수 있다.

## SLF4J (Simple Logging Facade for Java)

Facade 패턴을 활용하여 java.util.logging, logback 및 log4j2와 같은 다양한 프레임워크에 대한 인터페이스를 제공하는 기능이다.

따라서 SLF4J 자체는 로깅 시스템이 아니고 라이브러리들을 퍼사드 해주는 도구일 뿐이다.

## logback과 log4j는 비동기다.

System.out.println과 달리
Log4j2 Async Logger(Disruptor) 또는 Logback AsyncAppender은 non-blocking I/O이기 때문에 버틀랙 없이 로그 시스템을 활용할 수 있다.
동시성 관리가 매우 중요한 운영환경에서 문제없이 사용할 수 있는 이유는 이 때문이다.

## JSON 레이아웃 + MDC(traceId/requestId) 표준화

### MDC (Mapped Diagnostic Context) 란?

로그의 컨텍스트 정보와 현재 쓰레드 단위를 `Map<String,String>` 형태로 저장해주는 기능이다. 내부적으로 `ThreadLocal<Map<String,String>>` 구조로 동작하며, 로그 출력시 해당 쓰레드의 컨테스 값을 자동으로 가져와 로그에 함께 출력해준다.

# 참고 자료

- [SpringBoot에서 MDC를 활용한 요청별 로깅](https://velog.io/@shwj203/Spring-Boot%EC%97%90%EC%84%9C-MDC%EB%A5%BC-%ED%99%9C%EC%9A%A9%ED%95%9C-%EC%9A%94%EC%B2%AD%EB%B3%84-%EB%A1%9C%EA%B7%B8-%EC%B6%94%EC%A0%81-%EB%B0%8F-%EB%B0%94%EB%94%94-%EB%A1%9C%EA%B9%85)
