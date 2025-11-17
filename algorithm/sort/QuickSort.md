# 작성일

# 퀵정렬 (Quick Sort)

퀵정렬도 투포인터를 사용하는 알고리즘이다.

start, end 투포인터를 움직이면서 pivot의 값과 비교하여
작다면 p-1, 크다면 p+1에 위치시킨다.

end point를 구한

## 포인터 종류

- start
  - start는 가장 왼쪽에 있는 포인터로 왼쪽에는 가장 작은 값이 와야한다. 때문에 start가 가리키는 포인터보다 pivot이 가리키는 포인트가 작으면 swap을 하고 오른쪽으로 한칸 이동한다.
- end
  - end는 가장 오른쪽에서 시작한다. 오른쪽에는 가장 큰값이 위치해야 한다. 때문에 end가 가리키는 값이 pivot이 가르키는 값보다 크다면 swap하고 왼쪽으로 한 칸 이동한다.
- pivot
  - pivot은 중심값으로 데이터를 비교하는 값
  - pivot이 알고리즘 성능 향상의 키 포인트다.

# 함수

퀵정렬에 필요한 함수는 partition, quickSort 함수이다.

1. partition(start, end, arr)
   파티션을 구하는 이유는 피벗 인덱스를 구하면서 좌,우 파티션을 나누기 위함이다.
   때문에 파티션을 구할 때에도 피벗값을 기준으로 정렬을 한번 한다.

2. quickSort(arr,left,right)
   left 가 right 보다 클때까지 진행하며, 재귀적으로 계속해서 호출한다.

# 코드

```java

public class Main {
    public static void main(String[] args) {
        try (BufferedReader br = new BufferedReader(new InputStreamReader(System.in))) {
            String[] str = br.readLine().split("");

            int[] arr = new int[str.length];
            for(int i=0;i<str.length;i++) arr[i] = Integer.parseInt(str[i]);

            quickSort(arr, 0, arr.length-1);
            for(int i=0;i<arr.length;i++) System.out.print(arr[i]);



        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    static int partition(int[] arr, int p, int length){
        int pivot = arr[p];
        int start = p+1;
        int end = length;

        while(true){
            // start index가 pivot 보다 큰 값을 가리킬 때 까지 계속해서 start++한다.
            while(start<=end && arr[start] < pivot) start++;

            // end index가 pivot 보다 작은 값을 가리킬 때 까지 계속해서 end--한다.
            while(start<=end && arr[end] > pivot) end--;

            if(start > end) break;

            int temp = arr[start];
            arr[start] = arr[end];
            arr[end] = temp;

            start++;
            end--;
        }

        int temp = arr[p];
        arr[p] = arr[end];
        arr[end] = temp;

        return end;
    }

    static void quickSort(int[] arr, int left, int right){
        if(left < right){
            int pivot = partition(arr, left, right);
            quickSort(arr, left, pivot-1);
            quickSort(arr, pivot+1, right);
        }
    }
}

```

# 질문

- 투포인터 알고리즘을 사용하면 어떻게 O(n2) 알고리즘보다 빠른걸까?
  - 피벗을 두기 때문에 평균적으로 O(nlogn) 복잡도가 나오게 된다.
- 데이터를 옮기는 것은 코드로 어떤식으로 표현하게 되는가?
  - swap 함수가 기본적으로 정렬 알고리즘에 많이 사용된다.

# while을 사용한다는 의미

문제에서 "~할 때 까지 계속" 이라는 동작을 구현할 때는 반복문을 사용하는데 for문 보다는 while문을 사용하는 것이 적합하다고 생각한다.
for문은 정확한 목표점이 있을 때 반복적으로 사용하기 좋고 while문은 어떤 조건이 있는데 조건을 달성할 때까지 계속 사용하는 용도라고 느껴진다.
