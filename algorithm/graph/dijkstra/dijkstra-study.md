# Tag

- Algorithm
- Dijkstra
- Graph

# Dijkstra Algorithm

다익스트라 알고리즘은 그래프의 가중치를 그리디 알고리즘의 원리로 무조건 짧으면 취하는 방식으로 노드간 길이를 구한다.

이때 사용되는 방식은 BFS를 사용하며 우선순위 큐 또는 최소힙을 사용하여 노드간의 거리를 구할 수 있다.

다익스트라를 공부하기 앞서 우선순위 큐와 최소힙을 공부해 보자.

# Priority Queue

`Priority Queue`의 주요 메소드로는 `enqueue`, `dequeue`, `sort`가 있다. 넣을때 정렬하고 pop하여 뺀다. 값을 넣을때는 value와 priority를 함께 넣어 줘야하며 `sort` 할때 priority에 따라 정렬하여 우선순위를 유지한다.

```Javascript
class PriorityQueue {
  constructor() {
    this.queue = [];
  }

  enqueue(value, priority) {
    this.queue.push({ value, priority });
    console.log(`Enqueued: `, this.queue);
    this.sort();
  }

  dequeue() {
    return this.queue.shift();
  }

  sort() {
    this.queue.sort((a, b) => a.priority - b.priority);
  }
}

const pq = new PriorityQueue();

pq.enqueue("A", 3);
pq.enqueue("B", 1);

```

---

# Min Heap

가장 작은 값을 최상위 노드로 갖는 트리 구조를 가르키며 `push`, `pop`, `bubleDown`, `bubleUp`, `swap` 과 같은 기본 메소드를 갖는다.

- push
  리스트 가장 끝에 값을 넣고 부모 노드와 값을 비교하면서 끌어올린다.

- pop
  가장 작은 노드를 반환하고 가장 끝의 값을 최상위 노드에 넣고 내려가며 적절한 위치를 찾는다.

- bubbleUp

  - 주요 로직
    - index는 가장 끝단의 노드의 인덱스를 지정하고 parent 노드의 인덱스를 찾아 두 값을 비교하면서 parent 노드의 값이 index보다 크다면 swap하며 올라가고 아니라면 break 하여 순회를 멈춘다.
    - parent 인덱스를 얻는 방법은 Math.floor를 사용하여 소수점을 버리고 반내림하여 찾으며 Math.floor((index - 1) / 2) 하여 구할 수 있다.

- bubbleDown

  - 주요 로직
    - index는 0부터 시작하여 left, right index를 찾는다.
      - 반복은 left 자식노드가 길이보다 작을때 순회한다.
      - left를 찾는 방법 : index \* 2 + 1
      - right를 찾는 방법 : index \* 2 + 2
      - 현재 인덱스가 0이라면 left=1, right=2 로 구해진다.
    - left와 right 중에 값을 비요하여 더 큰값 bubbleDown 시킨다.
    - 만약 구해진 smaller 값이 index 보다 더 작다면 자식 노드의 값과 index 노드의 값을 swap한다.

- swap
  javascript의 구조분해 할당을 이용해면 index 끼리 값을 간단히 할당할 수 있다.

```javascript
class MinHeap {
  constructor() {
    this.items = [];
  }
  push(value) {
    this.items.push(value);
    this.bubbleUp();
  }

  pop() {
    if (this.items.length === 0) {
      return null;
    }

    let min = this.items[0];
    this.items[0] = this.items[this.items.length - 1];
    const temp = this.items.pop();
    this.bubbleDown();

    return min;
  }
  swap(a, b) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
  }

  bubbleUp() {
    let index = this.items.length - 1;
    while (index > 0) {
      let parentIndex = Math.floor((index - 1) / 2);
      if (this.items[parentIndex] <= this.items[index]) break;

      this.swap(parentIndex, index);

      index = parentIndex;
    }
  }
  bubbleDown() {
    let index = 0;

    while (index * 2 + 1 < this.items.length) {
      let leftChild = index * 2 + 1;
      let rightChild = index * 2 + 2;
      let smallerChild =
        rightChild < this.items.length &&
        this.items[rightChild] < this.items[leftChild]
          ? rightChild
          : leftChild;

      if (this.items[index] <= this.items[smallerChild]) break;

      this.swap(index, smallerChild);
      index = smallerChild;
    }
  }
}

const minHeap = new MinHeap();
minHeap.push(5);
minHeap.push(3);
minHeap.push(8);
minHeap.push(1);
minHeap.push(4);

console.log(minHeap.pop()); // 1
console.log(minHeap.pop()); // 3
console.log(minHeap.pop()); // 4
console.log(minHeap.pop()); // 5
console.log(minHeap.pop()); // 8
```

---

# Dijkstra

```javascript
const graph = {
  A: { B: 9, C: 3 },
  B: { A: 9, D: 2 },
  C: { A: 3, D: 8, E: 1 },
  D: { B: 2, C: 8, E: 7, F: 4 },
  E: { C: 1, D: 7, F: 6 },
  F: { D: 4, E: 6 },
};

function solution(graph, start) {
  const distances = {};
  for (const node in graph) {
    distances[node] = Infinity;
  }

  distances[start] = 0;
  const minHeap = new MinHeap();

  minHeap.push([distances[start], start]);

  const paths = { [start]: [start] };

  while (minHeap.size() > 0) {
    const [currDist, currNode] = minHeap.pop();

    if (distances[currNode] < currDist) {
      continue;
    }

    for (const adjNode in graph[currNode]) {
      const weight = graph[currNode][adjNode];
      const dist = currDist + weight;

      if (dist < distances[adjNode]) {
        distances[adjNode] = dist;

        paths[adjNode] = [...paths[currNode], adjNode];

        minHeap.push([dist, adjNode]);
      }
    }
  }

  const sortedPaths = {};
  Object.keys(paths)
    .sort()
    .forEach((node) => {
      sortedPaths[node] = paths[node];
    });

  return [distances, sortedPaths];
}
```

```javascript
class MinHeap {
  constructor() {
    this.items = [];
  }

  swap(a, b) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
  }

  size() {
    return this.items.length;
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
      let parentIndex = Math.floor((index - 1) / 2);

      if (this.items[parentIndex] <= this.items[index]) {
        break;
      }

      this.swap(parentIndex, index);
      index = parentIndex;
    }
  }

  bubbleDown() {
    let index = 0;
    while (index < this.items.length) {
      let left = index * 2 + 1;
      let right = index * 2 + 2;
      let smaller = right < this.items.length && right < left ? right : left;

      // smaller 값이 index 보다 작다면 순회를 멈춘다.
      if (this.items[index] < this.items[smaller]) break;

      this.swap(smaller, index);
      index = smaller;
    }
  }
}
```

# comments

- [2025-08-27] 최소힙 + BFS를 함께 응용하여 다익스트라를 만들어보았다. 인접리스트 그래프를 BFS로 순회하는 로직에 최소힙을 응용하는 로직인데 최단거리를 그리디하게 구할때 유용하게 사용되는 로직이었다.

```javascript
[
  { A: 0, B: 9, C: 3, D: 11, E: 4, F: 10 },
  {
    A: ["A"],
    B: ["A", "B"],
    C: ["A", "C"],
    D: ["A", "C", "D"],
    E: ["A", "C", "E"],
    F: ["A", "C", "E", "F"],
  },
];
```
