const fs = require("fs");
function main() {
  const input = fs.readFileSync(0, "utf-8").trim().split("\n");

  const dx = [-1, 1, 0, 0];
  const dy = [0, 0, -1, 1];

  const totalCaseCount = input[0];

  let currentCaseIdx = -1;

  let metrics = Array.from({ length: totalCaseCount }, () => []);

  for (let i = 1; i < input.length; i++) {
    let [n, m, k] = input[i].split(" ").map(Number);

    if (k) {
      currentCaseIdx++;
      metrics[currentCaseIdx] = Array.from({ length: n }, () =>
        Array(m).fill(0)
      );
    } else {
      metrics[currentCaseIdx][n][m] = 1;
    }
  }

  for (let i = 0; i < totalCaseCount; i++) {
    const count = solution(metrics[i]);

    console.log(count);
  }

  function solution(arr) {
    const visited = Array.from({ length: arr.length }, () =>
      Array.from({ length: arr[0].length }, () => false)
    );

    let count = 0;
    for (let i = 0; i < arr.length; i++) {
      for (let j = 0; j < arr[0].length; j++) {
        if (arr[i][j] === 1 && !visited[i][j]) {
          count = dfs(i, j, arr, visited, count);
        }
      }
    }

    return count;
  }

  function dfs(y, x, arr, visited, count) {
    if (visited[y][x]) return 0;

    visited[y][x] = true;

    for (let d = 0; d < 4; d++) {
      let nx = x + dx[d];
      let ny = y + dy[d];

      if (nx < 0 || ny < 0 || nx >= arr[0].length || ny >= arr.length) {
        continue;
      }

      if (arr[ny][nx] === 1 && !visited[ny][nx]) {
        dfs(ny, nx, arr, visited, count);
      }
    }

    return ++count;
  }
}

main();
