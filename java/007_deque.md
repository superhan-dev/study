# 작성일

- 2025-10-20

# Deque를 사용한 Stsck 과 Queue

# 개요
Collection Framework를 구현해보던 중 Deque라는 객체를 이용해서 Stack을 구현해 보았다. 
그러던 중 예상치 못한 문제를 만나게 되었고 Stack 과 Queue를 정리하면서 함께 정리해보려 한다. 


## Deque

deque는 앞에서 부터 값을 붙이기 때문에 [0, 1, a, c, b, a] 이와 같은식으로 값이 들어가며 removeFirst() 메소드를 호출하면 stack을 만들고 removeLast()를 호출하면 queue를 만드는 특징이 있다.

## 에러 발생 

코드와 같이 Deque를 선언하고 값을 push한 뒤 `removeFirst()`를 호출하여 stack과 `removeLast()`로 queue를 구현하면서 테스트를 해보려고 했으나 다음과 같은 에러를 만나게 되었다.

```java
Deque<String> deque = new ArrayDeque<>();

deque.push("a");
deque.push("b");
deque.push("c");
deque.push("a");

deque.addFirst("1");
deque.push("0");

for (String str : deque){
    // IO.println(deque.removeFirst()); // LIFO - stack
    IO.println(deque.removeLast()); // FIFO - queue
}
```

### next가 없다?
단순히 반복적인 코드를 호출 하기 싫어서 for문을 사용했는데 이와 같은 에러를 만나게 되었다.
원인은 "반복중에 컬렉션을 직접 수정했기 때문" 이다. for-each문을 사용해서 deque를 순회하면서 동시에 removeLast를 호출하여 deque를 더럽혔기 때문에 위와 같은 에러가 발생한 것.

deque를 사용해서 for-each를 순회하게되면 내부적으로는 iterator를 사용한다고 한다. 이는 fail-fast 매커니즘을 가지고 있어서 반복 도중 구조가 변경되면 즉시 예외를 던진다.

다시 말해 iterator를 하게되면 객체를 직접 참조하게 되는데 참조되고있는 객체가 변형되면 즉시 에러를 던지는 매커니즘이다.

```
Exception in thread "main" java.util.ConcurrentModificationException
	at java.base/java.util.ArrayDeque.nonNullElementAt(ArrayDeque.java:268)
	at java.base/java.util.ArrayDeque$DeqIterator.next(ArrayDeque.java:698)
	at Main.main(Main.java:39)
```

### fail-fast란?
말 그대로 "빠르게 실패한다." 는 정책이다. 코드의 오류가 보이는 즉시 에러를 뱉는다는 의미.

## for-each 대신 while을 사용하라.
while은 직접 deque를 참조하는 것이 아니기 때문에 에러가 발생하지 않는다.

다음과 같이 iterator를 사용하지 않도록 참조하는 부분과 연산하는 부분을 분리할 수 있다.
```java
while(!deque.isEmpty()) IO.println(deque.removeLast());
```

## 그렇다면 for문을 쓰면 되지 않을까?

다음 코드는 과연 어떻게 동작할까?

```java
for(int i=0;i<deque.size();i++) IO.println(deque.removeLast());
```

에러를 뱉지 않지만 아무것도 출력이 안된다. 그 이유는 deque.size()를 호출하는데 deque이 변경되니 조건이 false가 되어버리기 때문이다.

```java
int size = deque.size();
for(int i=0;i<size;i++) IO.println(deque.removeLast());
```

위와 같이 미리 size를 저장하고 순회를 하게되면 안전하게 순회할 수 있게 된다. 


# 💡 정리

| 방식 | 설명 |
| --- | --- |
| for-each | 내부적으로 Iterator를 사용하므로, 구조가 변경되면 ConcurrentModificationException 발생 |
| for (i < stack.size()) | size()가 매 루프마다 갱신되므로, remove로 인해 루프 조기 종료
| while (!isEmpty()) | 안전하고 명확하게 비우면서 출력 가능 ✅
