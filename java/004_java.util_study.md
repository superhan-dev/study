# 작성일

- 2025-10-22

# java.util package study

# Collections.shuffle()

- 리스트 안에 값을 섞을 때 사용할 수 있는 메소드

## random 번호 6개 뽑기

```java
List<Integer> list = new ArrayList<>();

for(int i=0;i<10;i++) list.add((int) Math.abs(Math.random()*10));

Collections.shuffle(list);

for(int i=0;i<6;i++) {
    System.out.println(list.get(i));
}
```

---

# Collections.rotate()

값을 두번째 인자만큼 밀어내는 메소드이다. 한칸씩 밀어내고 끝에 숫자를 맨 처음으로 옮기는데 매우 용이한 메소드가 될 것이다.

```java
List<Integer> list = Arrays.asList(1,2,3,4,5);

Collections.rotate(list,3); // 3,4,5,1,2

System.out.println(list);

```

---

# Collections.reverse()

리스트를 뒤짚는 메소드

```java
List<Integer> list = Arrays.asList(1,2,3,4,5);

Collections.reverse(list); // 5,4,3,2,1

System.out.println(list);
```

# PriorityQueue

- peek()
  - 값의 제거 없이 최대값 출력
- poll()
  - 값을 꺼내면서 값들을 출력한다.

```java
// 최대 힙
PriorityQueue<Integer> pq = new PriorityQueue<>(Collections.reverseOrder());

pq.add(1);
pq.add(3);
pq.add(2);
pq.add(5);
pq.add(6);
pq.add(10);

// 힙의 경우 순차적인 배멸이 아니고 트리 형태로 값을 가지고 있기 때문에 다음과 같이 출력된다.
System.out.println(pq); // [10, 5, 6, 1, 3, 2]

// 최대값 순서대로 값을 찍으려면 poll을 호출해서 최대 값 순열을 찍어야한다.
while(!pq.isEmpty()) {
    System.out.print(pq.poll() + ", "); // 10, 6, 5, 3, 2, 1
}

```

# Collections.fill(List<? super T> list, T obj)

list.size() 만큼 내부적으로 iterator를 돌면서 obj를 채워 넣는 메소드다.

```java

List<Integer> list = Arrays.asList(1,2,3,4,5);

Collections.fill(list, 10); // 10,10,10,10,10

```
