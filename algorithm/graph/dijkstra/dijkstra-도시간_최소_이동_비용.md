# Tag

- Algorithm
- Dijkstra
- Graph

# Dijkstra 응용 문제

## 🚦 문제: 도시 간 최소 이동 비용 구하기

어떤 나라에는 **N개의 도시(1번 ~ N번)**와 M개의 양방향 도로가 있습니다.
각 도로는 이동 비용이 있으며, 특정 도시에서 다른 도시로 이동할 때 반드시 도로를 통해야 합니다.

당신은 시작 도시 S에서 다른 모든 도시까지의 최소 이동 비용을 구하려고 합니다.

---

## 입력 형식

```
N M
u1 v1 w1
u2 v2 w2
...
uM vM wM
S
```

- N (1 ≤ N ≤ 10,000) : 도시의 개수
- M (1 ≤ M ≤ 200,000) : 도로의 개수
- ui, vi : 도로로 연결된 두 도시 (1 ≤ ui, vi ≤ N, ui ≠ vi)
- wi (1 ≤ wi ≤ 1,000) : 해당 도로의 이동 비용
- S : 시작 도시 번호

---

## 출력 형식

- N줄에 걸쳐, 시작 도시 S에서 각 도시까지의 최소 이동 비용을 출력한다.
- 만약 도달할 수 없다면 INF를 출력한다.

---

## 입력 예시

```
6 11
1 2 2
1 3 5
2 3 4
2 4 6
2 5 10
3 4 2
3 5 3
4 5 1
4 6 7
5 6 1
3 6 8
1
```

## 출력 예시

```
0
2
5
7
8
9
```

---

## 💡 설명

시작 도시는 1번

1 → 2 → 3 → 4 → 5 → 6 경로를 타면 9로 최소가 된다.

# 코드

```javascript
class MinHeap {
  constructor() {
    this.items = [];
  }

  size() {
    return this.items.length;
  }

  push(value, priority) {
    this.items.push([value, priority]);
    this.bubbleUp();
  }

  pop() {
    let min = this.items[0];
    this.items[0] = this.items[this.size() - 1];
    this.items.pop();
    this.bubbleDown();

    return min;
  }

  swap(a, b) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
  }

  bubbleUp() {
    let index = this.size() - 1;

    while (index < this.size() - 1) {
      let parent = Math.floor((index - 1) / 2);
      if (this.items[parent][1] < this.items[index][1]) break;

      this.swap(index, parent);
      parent = index;
    }
  }

  bubbleDown() {
    let index = 0;

    while (index * 2 + 1 < this.size()) {
      let left = index * 2 + 1;
      let right = index * 2 + 2;

      let smaller =
        right < this.size() && this.items[left][1] < this.items[right][1]
          ? right
          : left;

      if (this.items[index][1] < this.items[smaller][1]) break;

      this.swap(index, smaller);
      index = smaller;
    }
  }
}

function solution(input) {
  let [n, m] = input[0];
  input.shift(); // 0번째 값을 제거

  // 그래프 초기값 설정
  const distances = Array(n + 1).fill(Infinity);

  const pq = new MinHeap();

  const startNode = input.pop(); // 마지막 시작점 제거
  // 초기값 설정
  pq.push(startNode, 0);

  distances[startNode] = 0;

  const graph = Array.from({ length: n + 1 }, () => []);
  for (const [u, v, w] of input) {
    graph[u].push([v, w]);
    graph[v].push([u, w]);
  }

  while (pq.size() > 0) {
    let [node, currDist] = pq.pop();

    // 현재 노드
    for (const [adj, dist] of graph[node]) {
      if (currDist + dist < distances[adj]) {
        distances[adj] = currDist + dist;
        pq.push(adj, distances[adj]);
      }
    }
  }

  return distances;
}

const input = [
  [6, 11],
  [1, 2, 2],
  [1, 3, 5],
  [2, 3, 4],
  [2, 4, 6],
  [2, 5, 10],
  [3, 4, 2],
  [3, 5, 3],
  [4, 5, 1],
  [4, 6, 7],
  [5, 6, 1],
  [3, 6, 8],
  [1],
];

console.log(solution(input));
```

# 디버깅시 발견된 문제

🚨 문제점 정리

1. MinHeap 비교 방식
   this.items.push([value, priority]);

여기서 items 배열에는 [value, priority] 형태가 들어가는데,
bubbleUp과 bubbleDown에서 비교할 때 단순히 this.items[a] < this.items[b] 이렇게 쓰면 배열끼리 비교가 됩니다.
→ 즉, JS에서는 배열 비교가 정상 동작하지 않아요. priority(거리) 를 기준으로 비교해야 해요.

✅ 수정:

if (this.items[parent][1] <= this.items[index][1]) break;
this.swap(parent, index);
index = parent;

그리고 bubbleDown도 마찬가지로 this.items[child][1] 기준으로 비교해야 해요.

2. swap 호출
   swap(index, parent);

→ this.swap(...) 로 호출해야 합니다. (swap은 클래스 메서드니까)

3. distances 초기화
   const distances = Array.from({ length: n + 1 }, () => []).fill(Infinity);

이 부분이 잘못됐어요.

Array.from(..., () => [])로 하면 내부에 배열이 들어갑니다.

거기에 .fill(Infinity)를 하면 모든 칸이 Infinity로 채워진 배열이 하나만 공유돼버려요.

✅ 의도대로 하려면:

const distances = Array(n + 1).fill(Infinity);

4. push 인자
   pq.push([startNode, 0]);

push(value, priority) 형태인데, 지금은 [startNode, 0] 하나만 넣고 있어요.
→ 그러면 value = [startNode, 0], priority = undefined가 들어가버립니다.

✅ 수정:

pq.push(startNode, 0);

5. pq.push([adj, distances[adj]]);

이 부분입니다.
MinHeap의 push 메서드는 value, priority 두 개의 인자를 받는데,
여기서는 [adj, distances[adj]]라는 배열 하나만 넘기고 있습니다.

따라서,
pq.push(adj, distances[adj]);
로 수정해야 합니다.

그리고 pop에서 반환값도 [node, currDist]로 구조분해 할당해야 하므로,
MinHeap의 pop 메서드가 [value, priority]를 반환하는 것이 맞습니다.
