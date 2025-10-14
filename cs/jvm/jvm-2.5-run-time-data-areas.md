# 2.5. Run-Time Data Areas

JVM Thread는 여러개가 돌아간다. Run-Time data area는 thread 들이 동작시 사용하는 값 또는 명령어들이 저장되는 공간이며 Thread 간 공유하는 자원과 공유하지 않고 Thread Safe 하게 독립적으로 생성되는 자원이 존재한다.

때문에 각 Thread 마다 PC register가 존재하고 stack안에 메소드의 실행 순서를 쌓으며 Heap 안에 런타임시 생성되는 인스턴스를 참조하여 사용하면서 테스크를 실행한다.

## The PC Register

Program counter란 프로그램을 실행하는 명령어들을 참조하는 포인터이다. JVM 스레드가 실행 중인 바이트코드의 위치 또는 다음 실행할 명령을 가르키는 Thread 별 카운터이다. 자바 메서드를 인터프리터가 실행할 때만 유의미하고 네이티브 메서드를 실행중일때는 undefined가 된다.

## JVM Stacks

Thread 가 실행될 때 생성되는 공간이며 프레임들을 push, pop하여 연산한다. stack 사이즈는 JVM에 의해 고정적으로 생성되며 실제 OS의 stack 보다 작은 사이즈여야 한다. 만약 허용된 사이즈보다 커지게 되면 StackOverFlowError가 발생하게 된다.

스택 공간 자체를 확보/확장하지 못했을 때(또는 새 스레드용 스택을 못 만들 때) 발생. HotSpot에선 특히 스레드를 너무 많이 만들면 OutOfMemoryError 가 발생한다.

[OutOfMemoryError 예시]

전체 메모리가 부족하거나 스택 설정을 과도하게 늘리게 되면 동작시 다음과 같은 에러가 발생할 수 있다.

```
java.lang.OutOfMemoryError: unable to create new native thread

```

## Heap

Thread 들이 공유하는 영역으로 런타임시 생성된 클래스 인스턴스들이나 Array 가 할당되어있는 공간이다.

## Method Area

Method Area는 Permanent Generation 이라는 이름으로 사용되기도 했으며 Java 8 이후부터 Metaspace로 대체되었다. GC의 대상이 되기 때문에 논리적으로 Heap의 일부이나 물리적으로 분리되어있으며(non-heap: Metaspace) 클래스 메타데이터와 상수 풀등을 관리한다.

## Classloader Reference

classloader가 바이트코드를 읽어 로드한 데이터들이 존재하느 공간

## Run-time Constant Pool

- 작성 예정

## Native Method Stacks

- 작성 예정

# 참조링크

- [JVM 블로그 글](https://blog.jamesdbloom.com/JVMInternals.html)
