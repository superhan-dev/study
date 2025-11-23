# 작성일

- 2025-11-22

# 구간합

prefix sum 문제라고 불리는 구간합을 구하는 방법은 배열의 인덱스 만큼 구간별 총계를 구하는 문제다.

```java

class Main {
    public static void main(String[] args){
        Scanner scanner = new Scanner(System.in);
        int n = scanner.nextInt();
        int m = scanner.nextInt();

        int[] arr = new int[n+1];
        int[] prefix = new int[n+1];

        for(int i=1;i<=n;i++){
            arr[i] = scanner.nextInt();
            prefix[i] = prefix[i-1] + arr[i];
        }

        for(int k=0;k<m;k++){
            int i = scanner.nextInt();
            int j = scanner.nextInt();
            // 구간합까지 더해진 값과 현재 구간의 값을 빼면 구간합이 나온다.
            // [0, 5, 9, 12, 14, 15] 중에서
            // 1~3 의 구간합을 구하기 위해 12 - 0을 해야 답을 구할 수 있다.
            int result = prefix[j] - prefix[i-1];
            System.out.println(result);
        }

        scanner.close();
    }

}

```

# 자가 점검

## 왜 를 설명할 수 있는가?

### 배열은 왜 n+1 로 생성하는지 설명하시오.

```java
int[] arr = new int[n+1];
int[] prefix = new int[n+1];
```

> 풀이:
> 구간합 0번째 합은 0이므로 이를 포함하기 위해서 n+1을 넣는 것이고 입력값이 첫번째 인덱스를 1로 입력하는 이유도 있음.

### 다음 코드에서 int i가 왜 1부터 시작하는지 설명하시오.

```java
for(int i=1;i<=n;i++){
    arr[i] = scanner.nextInt();
    prefix[i] = prefix[i-1] + arr[i];
}
```

> 풀이:
> 구간합이 1부터 시작이라면 1은 0이 되어야 한다. 예를 들어 입력값이 `[5,4,3,2,1]` 일때 0번째 인덱스 값은 5이지만 구간합으로 따지면 0이다. 이 배열의 전체 구간 합은 `[0,5,9,12,14,15]`가 되고 만약 1부터 3까지 구간합을 구하려면 `arr[j] - arr[3]` 인덱스를 계산해야한다. 이때 첫번째 구간합은 0이 들어가야한다는 의미.

### 구간합 공식

구간합 공식은 i~j 까지 값을 구해야 하므로 `prefix[j] - prefix[i-1]`로 구한다.
