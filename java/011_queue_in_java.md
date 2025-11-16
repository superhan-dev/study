# 자바에서 큐를 사용하는 방법

# 작성일

- 2025-11-06

# Queue

queue는 First in first out으로 줄서기와 같은 메커니즘으로 동작하는 자료구조입니다.
Java의 queue에서 대표적인 큐의 동작 방식은 insert, remove, examine으로 나뉩니다.

## 큐 메소드

- insert
  - add(e)
  - offer(e)
- remove
  - remove()
  - poll()
- examine
  - element()
  - peek()

# Queue 구현 방법

Queue를 사용하는 방법은 Queue는 인터페이스 이기 때문에 컬렉션 프레임워크를 사용해서 구현합니다. 대표적으로 LinkedList 또는 ArrayDeque를 사용해서 구현합니다.

## LinkedList vs ArrayDeque

그렇다면 둘 중 무엇을 사용해야 할까요?

메모리 친화적으로 보다 더 좋은 성능을 내는 것은 ArrayDeque입니다. 그 이유는 저장되는 메모라가 시리얼하게 저장되기 때문에 보다 빠른 인덱싱을 지원하고 삽입시 맨 끝 또는 맨 앞에 값을 추가하기 때문에 새로운 값을 추가할때 새로운 노드를 생성해야하는 LinkedList보다 빠른 적은 메모리 오버헤드를 가집니다.

하지만 synchronized와 같은 동시성 처리에는 적절하지 않기 때문에 동시성 처리 전용 ConcurrentLinkedDeque와 같은 방법으로 동시성 처리를 해주어야한다.

검색은 둘다 가장 head의 값만 바라본다는 전재로 O(1)의 상수 시간을 발생시킵니다.
