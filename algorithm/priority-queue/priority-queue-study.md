# Tag

- Algorithm
- PriorityQueue

# Priority Queue

우선순위 큐는 sort로 간단하게 구현할 수도 있고 MinHeap으로 정석으로 구현할 수도 있다. 간단하게 구현하게 되면 성능 측면에서 n log n 이 발생하는 단점이 있지만 코드가 간단해 지는 장점이 있다.

```javascript
class PriorityQueue {
  constructor() {
    this.items = [];
  }

  enqueue(value, priority) {
    this.items.push({ value, priority });
    this.sort();
  }

  dequeue() {
    return this.items.shift().value;
  }

  sort() {
    this.items.sort((a, b) => a.priority - b.priority);
  }
}

const pq = new PriorityQueue();

pq.enqueue("John", 2);
pq.enqueue("Jane", 1);
pq.enqueue("Doe", 3);

console.log(pq.dequeue());
console.log(pq.dequeue());
console.log(pq.dequeue());
```

```javascript
class MinHeap {
  constructor() {
    this.items = [];
  }

  size() {
    return this.items.length;
  }

  push(value) {
    this.items.push(value);
    this.bubbleUp();
  }

  pop() {
    if (this.size() === 0) return null;
    let min = this.items[0];
    this.items[0] = this.items[this.size() - 1];
    this.items.pop();

    this.bubbleDown();

    return min;
  }

  swap(a, b) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
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

      if (this.items[index] <= this.items[smaller]) break;

      this.swap(index, smaller);
      index = smaller;
    }
  }

  bubbleUp() {
    let index = this.size() - 1;

    while (index > 0) {
      let parent = Math.floor((index - 1) / 2);

      if (this.items[parent] <= this.items[index]) break;

      this.swap(index, parent);
      index = parent;
    }
  }
}

const mh = new MinHeap();

mh.push(5);
mh.push(3);
mh.push(8);
mh.push(1);

console.log(mh.pop());
console.log(mh.pop());
console.log(mh.pop());
console.log(mh.pop());
```

```javascript
class PriorityQueue {
  constructor() {
    this.items = [];
  }

  enqueue(value, priority) {
    this.items.push({ value, priority });
    this.sort();
  }

  dequeue() {
    return this.items.shift().value;
  }

  sort() {
    this.items.sort((a, b) => a.priority - b.priority);
  }
}

const graph = {
  A: { B: 9, C: 3 },
  B: { A: 5 },
  C: { B: 1 },
};

function solution(graph, start) {
  const distances = [];
  for (const node in graph) {
    if (!distances[node]) distances[node] = Infinity;

    const paths = { [start]: [start] };

    const queue = new MinHeap();
    queue.push([distances[start], start]);

    while (queue.size() > 0) {
      const [currDist, currNode] = queue.dequeue();

      if (distances[currNode] < currDist) {
        continue;
      }

      for (const adjNode of graph[currNode]) {
        const weight = graph[currNode][adjNode];
        const distance = currDist + weight;

        if (distance < distances[adjNode]) {
          distances[adjNode] = distance;

          paths[adjNode] = [...paths[currNode], adjNode];

          queue.push([distance, adjNode]);
        }
      }
    }
  }
}

solution(graph, "A");
```
