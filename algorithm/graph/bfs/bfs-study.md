# BFS study

# Tag

- Algorithm
- Graph
- BFS

# Code

```javascript
const graph = [
  [1, 2],
  [1, 3],
  [2, 4],
  [2, 5],
  [3, 6],
  [3, 7],
  [4, 8],
  [5, 8],
  [6, 9],
  [7, 9],
];

function solution(graph, start) {
  const adjList = {};
  for (const [u, v] of graph) {
    if (!adjList[u]) adjList[u] = [];
    adjList[u].push(v);
  }

  const visited = new Set();
  visited.add(start);
  const queue = [start];
  const result = [start];
  while (queue.length > 0) {
    const curr = queue.shift();

    for (const adj of adjList[curr] || []) {
      if (!visited.has(adj)) {
        queue.push(adj);
        result.push(adj);
        visited.add(adj);
      }
    }
  }

  return result;
}

const res = solution(graph, 1);
```

# 시간복잡도

너비우선 탐색의 시간복잡도 역시 dfs와 같이 모든 노드의 간선을 탐색하므로 `O(N+E)`가 된다.

# 한번 더 정리하는 정보

- Javascript Array로 Queue를 구현할 때는 shift로 dequeue를 한다.
