# 작성일

- 2025-11-21

# OnesInTheRange 문제

커스텀 클래스 내에 1과 0으로 이루어진 배열 arr이 있을 때, 주어진 인덱스 s와 e 사이에(inclusive) 몇 개의 1이 존재하는지를 리턴하는 함수를 작성하세요.

numOfOnes(...) 메소드는 아주 많이 호출될 수 있습니다.

## 예제 1:

입력: arr = [0, 0, 1, 0, 1], s = 2, e = 4
출력: 2

## 예제 2:

입력: arr = [0, 1, 1, 0, 0, 1, 1, 1], s = 2, e = 6
출력: 3

## 예제 3:

입력: arr = [0, 1, 1, 0, 0, 1, 1, 1], s = 1, e = 7
출력: 5

## 제약사항:

2 <= arr.length <= 10^8
1 <= number of numOfOnes is called <= 10^8
0 <= s < e <= arr.length

## 구현할 method:

```java
public class OnesInTheRange {
	static final int[] arr = new int[]{0, 0, 1, 0, 1}; // ex 1

	public OneInTheRange() {
		// implementation
	}

    public int numOfOnes(int s, int e) {
    // implementation
    }
}

```

# 풀이

단순한 루프 문제로 볼 수 있지만 10의 8승은 100,000,000으로 1억번이다. 이는 단순한 루프를 돌면 1초에 1억번 연산이 가능한 한계를 봤을때 통과하지 못하는 함정이 있다.

그렇다면 정확히 어떤 지식을 물어보는 것일까? 여러번 호출될 수 있다는 의미는 캐시 한번으로 여러번 처리하라는 의미로 해석할 수 있다.

## prefix sum(누적 합)

누적합이라는 개념으로 풀 수 있다는 것을 알게되고 누적 합에 대해 공부해보았다.

# 코드

## 브루트 포스 코드

이와 같이 풀면 작은 배열은 풀 수 있게된다. 하지만 1억번 호출을 하게되면 문제가 발생한다.

```java
class OnesInTheRange {
//    static final int[] input = new int[]{0,0,1,0,1};
    private int[] input;

    public  OnesInTheRange(){}

    public OnesInTheRange(int[] input){
        this.input = input;
    }

    public int numOfOnes(int s, int e){
        int count = 0;
        for(int i=s;i<=e;i++){
            if(this.input[i] == 1){
                count++;
            }
        }

        return count;
    }
}


public class Main {
    public static void main(String[] args) {
        OnesInTheRange onesInTheRange = new OnesInTheRange(new int[]{0,0,1,0,1});
        System.out.println(onesInTheRange.numOfOnes(2, 4));
    }
}

```

## 누적합 이란?

인덱스까지
http://acmicpc.net/problem/11660

4 3
// 배열
1 2 3 4
2 3 4 5
3 4 5 6
4 5 6 7
// 구간합

1. 2 2 3 4

2,2 부터 3,4 까지 구간합이므로 이런식으로 잘려야한다.
3 4 5
4 5 6

2. 3 4 3 4
3. 1 1 4 4

# 구간합 표 만들기

구간합으로 풀기위해서는 다음과 같이 2차원배열 구간합을 구해야한다.

2,2 ~ 3,4 까지 구해야한다.

1. prefix[3][4]

- 1,1 ~ 3,4 큰 네모 전체 합을 구한다.

2. 위 쪽

- 1,1 ~ 1,4를 빼면

```
	0열	1열	2열	3열	4열
0행	0	0	0	0	0
1행	0	1	3	6	10
2행	0	3	8	15	24
3행	0	6	15	27	42
4행	0	10	24	42	64

```

1+3+6+10 = 20

20 - 42 = 22

# 공식

```
S = prefix[x2][y2]
　- prefix[x1-1][y2]
　- prefix[x2][y1-1]
　+ prefix[x1-1][y1-1]
```
