# Tag

- DFS
- 알고리즘

# dfs 복습하기

```Javascript
const graph = [
  ["A", "B"],
  ["B", "C"],
  ["C", "D"],
  ["D", "E"],
];

function solution(graph, start) {
  let adjList = [];
  graph.forEach(([u, v]) => {
    console.log("u,v:", u, v);
    if (!adjList[u]) adjList[u] = [];
    adjList[u].push(v);
  });

  // Adjacency List: [ A: [ 'B' ], B: [ 'C' ], C: [ 'D' ], D: [ 'E' ] ]
  // 배열에도 key:value를 넣을 수 있다.
  // 인접노드를 생성
  console.log("Adjacency List:", adjList);

  // A 를 방문했을때
  function dfs(node, visited, result) {
    // A 를 방문했다고 표시
    visited.add(node);
    // 결과를 A에 넣는다.
    result.push(node);

    // 인접 노드에서 주변 노드들을 방문하면서
    (adjList[node] || []).forEach((neighbor) => {
        // 방문하지 않은 노드라면 dfs를 한다.
        // 이때 재귀 호출로 B를 방문하고 B를 방문하고 C를 방문하고 D를 방문하고 E를 방문한다.
        if (!visited[neighbor]) {
            dfs(neighbor, visited, result);
        }
    });
  }

  const visited = new Set();
  const result = [];

  dfs(start, visited, result);
  return result;
}

const res = solution(graph, "A");

console.log("DFS Result:", res); // [ 'A', 'B', 'C', 'D', 'E' ]

```

# 시간복잡도

- 인접리스틑를 생성했다고 가정했을 때 노드 개수를 N으로 보고 간선 개수를 E라고 한다면 복잡도는 인접 리스트 노드 개수 당 `O(E)` 가 된다. 따라서 탐색시 모든 노드를 N 번 방문하므로 깊이 우선탐색의 시간복잡도는 `O(N+E)` 가 된다.
- 예를 들어 `'A': ['B','C']` 가 있을 때 `노드 A`의 간선은 2개가 되므로 N + 2 가 되는 것이다. 만약 `'B': ['E','G','F']` 가 있다면 전체 인접리스트를 DFS로 순회할 시 `노드 A`의 2번 순회와 `노드 B`의 3번이 합쳐져서 5번이 되는데 이를 `O(N+E)`로 표현할 수 있게 되는 것이다.

# 다사 한번 알게된 사실

- 배열안에도 Key:Value 형태의 값을 만들 수 있다.

```javascript
// Adjacency List: [ A: [ 'B' ], B: [ 'C' ], C: [ 'D' ], D: [ 'E' ] ]
// 배열에도 key:value를 넣을 수 있다.
```

이와같이 adjList를 생성할때 배열로도 key:value 값을 생성할 수 있다.
이게 객체에서 `{[key]:value}` 와 같은 값으로 생성했을 때랑 뭐가 다르냐 하면 순회를 좀더 쉽게할 수 있다는 장점이 생긴다.
하지만 obj를 선언하고 프로그램상에서 Object.values로 변환해서 사용하는 것이 보다 좋다고 생각이 든다.
이유는 이와 같이 하면 obj를 map처럼도 사용하고 필요시 배열로도 사용할 수 있기 때문이다. 또한 보다 명확하게 Key:value라는 느낌을 주기에도 obj가 더 좋은것 같다.

- u,v 는 무슨 뜻인가?
  u,v는 흔히 그래프이론에서 정점과 간선을 표현할때 u,v로 표현한다고 한다.
