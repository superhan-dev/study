# Tag

- Algorithm
- Dijkstra
- Graph

---

# 🏆 최소 시간 배달 문제

## 문제 설명

당신은 한 도시의 도로망을 관리하는 시스템을 만들고 있습니다.
이 도시는 **N개의 교차로(노드)**와 **M개의 도로(간선)**로 이루어져 있습니다.
도로는 양방향이며, 각 도로를 통과하는 데 걸리는 시간이 주어집니다.

당신의 목표는 시작 교차로 S에서 모든 다른 교차로까지의 최소 시간을 구하는 것입니다.
만약 어떤 교차로에 도달할 수 없다면, 해당 교차로의 최소 시간은 INF로 표시합니다.

---

## 입력 형식

- 첫째 줄: N M S
  - N: 교차로 개수 (1 ≤ N ≤ 100,000)
  - M: 도로 개수 (1 ≤ M ≤ 200,000)
  - S: 시작 교차로 번호 (1 ≤ S ≤ N)
- 다음 M줄: u v w
  - u번 교차로와 v번 교차로 사이의 도로가 있고, 통과 시간은 w (1 ≤ w ≤ 1,000)

---

## 출력 형식

- 총 N줄 출력
- i번째 줄에 시작점 S에서 i번 교차로까지의 최소 시간을 출력
- 도달할 수 없는 경우 "INF"를 출력

### 예제 입력

```text
5 6 1
1 2 2
1 3 5
2 3 1
2 4 2
3 5 3
4 5 1
```

---

### 예제 출력

```text
0
2
3
4
5
```

---

### 닿을 수 없는 노드 예제 입력

```text
6 4 1
1 2 2
2 3 4
2 4 6
5 6 1
```

### 닿을 수 없는 노드 예제 출력

```text
0
2
6
8
INF
INF
```

## 💡 힌트

우선순위 큐(min-heap)를 사용하면 시간 복잡도를 **O((N+M) log N)**으로 줄일 수 있습니다.

무방향 그래프이므로 u→v, v→u 둘 다 추가해야 합니다.

# 문제 풀이

## 문제 설계

1. distances 배열을 정의하고 모든 경로를 Infinity로 초기화
2. priority queue 또는 min heap을 정의해서 사용해야한다.
3. adjList 초기화 : N+1 개의 배열을 만들어서 빈배열로 초기화 한다.
4. 무방향 그래프 값을 edges를 순회하면서 초기화 한다.
5. dist 배열을 초기화 한다. 모든 거리의 초기값은 Infinity.
6. min heap에 `[거리, 노드]` 로 값을 넣는다.
7. min heap의 값을 pop 해서 [currDist, u] 변수로 할당한다. 이유는 그래프에서 u는 노드를 v는 간선을 의미하기 때문이다.
8. adjList의 노드 번째에서 간선과 거리를 꺼내 dist[v] 즉, 현재 거리보다 길면 우선순위 큐에 푸시한다. (푸시하는 이유는 다음 순회에서 같은 노드가 나올 수 있기 때문에 최단 거리 값을 갱신하기 위함이다.)
9. dist.slice(1) 하여 값을 출력한다.

## 실행 예제

```typescript
const N = 5,
  M = 6,
  S = 1;
const edges = [
  [1, 2, 2],
  [1, 3, 5],
  [2, 3, 1],
  [2, 4, 2],
  [3, 5, 3],
  [4, 5, 1],
];

class MinHeap {
  constructor() {
    this.items = [];
  }

  size() {
    return this.items.length;
  }

  swap(a, b) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
  }

  push(value) {
    this.items.push(value);
    this.bubbleUp();
  }

  pop() {
    let min = this.items[0];
    this.items[0] = this.items[this.size() - 1];
    this.items.pop();

    this.bubbleDown();

    return min;
  }

  bubbleUp() {
    let index = this.size() - 1;

    while (index > 0) {
      let parent = Math.floor((index - 1) / 2);

      if (this.items[parent] < this.items[index]) break;

      this.swap(parent, index);
      index = parent;
    }
  }

  bubbleDown() {
    let index = 0;
    while (index * 2 + 1 < this.size()) {
      let left = index * 2 + 1;
      let right = index * 2 + 2;

      let smaller =
        right < this.size() && this.items[right] < this.items[left]
          ? right
          : left;

      if (this.items[index] < this.items[smaller]) break;

      this.swap(index, smaller);
      index = smaller;
    }
  }
}

function dijkstra(n, edges, start) {
  // 1번 노드부터 입력값에 있으므로 n+1로 처리한다.
  const adjList = Array.from({ length: n + 1 }, () => []);

  for (const [u, v, w] of edges) {
    adjList[u].push([v, w]);
    adjList[v].push([u, w]);
  }

  const dist = Array.from({ length: n + 1 }).fill(Infinity);
  dist[start] = 0;

  const pq = new MinHeap();
  pq.push([0, start]);

  while (pq.size() > 0) {
    const [currDist, u] = pq.pop();

    for (const [v, w] of adjList[u]) {
      if (dist[v] > currDist + w) {
        dist[v] = currDist + w;
        pq.push([dist[v], v]);
      }
    }
  }

  return dist.slice(1);
}

const result = dijkstra(N, edges, S);
console.log(result.map((d) => (d === Infinity ? "INF" : d)).join("\n"));
```

## PriorityQueue 로 풀어보기

```typescript
class PriorityQueue {
  constructor() {
    this.items = [];
  }

  size() {
    return this.items.length;
  }

  sort() {
    this.items.sort((a, b) => a[1] - b[1]);
  }

  enqueue(value, priority) {
    this.items.push([value, priority]);
  }

  dequeue() {
    return this.items.shift();
  }
}

function dijkstra(n, edges, start) {
  const dist = Array.from({ length: n + 1 }).fill(Infinity);

  const adjList = Array.from({ length: n + 1 }, () => []);
  for (const [u, v, w] of edges) {
    adjList[u].push([v, w]);
    adjList[v].push([u, w]);
  }

  dist[start] = 0;

  const pq = new PriorityQueue();
  pq.enqueue(start, 0);

  while (pq.size() > 0) {
    const [u, currDist] = pq.dequeue();

    for (const [v, w] of adjList[u]) {
      if (dist[v] > currDist + w) {
        dist[v] = currDist + w;
        pq.enqueue(v, dist[v]);
      }
    }
  }

  return dist.slice(1);
}
```

# 정리

PriorityQueue와 MinHeap으로 모두 풀어보면서 비교를 해보았고 PriorityQueue로 풀었을 때 훨씬 짧아지는 장점이 있다. 그러나 성능상 이슈가 있을 때는 MinHeap으로 구현해야하므로 코테에서는 안전하게 MinHeap으로 푸는게 더 좋을 것이라 생각된다.

아쉽게도 Javascript에는 MinHeap과 PriorityQueue가 Node API로 제공되지는 않지만 고차함수가 잘 제공되기 때문에 문제없이 PriorityQueue와 MinHeap을 구현할 수 있다.
