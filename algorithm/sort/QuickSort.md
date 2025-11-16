# 작성일

# 퀵정렬 (Quick Sort)

퀵정렬도 투포인터를 사용하는 알고리즘이다.

start, end 투포인터를 움직이면서 pivot의 값과 비교하여
작다면 p-1, 크다면 p+1에 위치시킨다.

## [포인터 종류]

- start
  - start는 가장 왼쪽에 있는 포인터로 왼쪽에는 가장 작은 값이 와야한다. 때문에 start가 가리키는 포인터보다 pivot이 가리키는 포인트가 작으면 swap을 하고 오른쪽으로 한칸 이동한다.
- end
  - end는 가장 오른쪽에서 시작한다. 오른쪽에는 가장 큰값이 위치해야 한다. 때문에 end가 가리키는 값이 pivot이 가르키는 값보다 크다면 swap하고 왼쪽으로 한 칸 이동한다.
- pivot
  - pivot은 중심값으로 데이터를 비교하는 값

## O(nlogn)이 정확히 무엇인가?

# 함수

퀵정렬에 필요한 함수는 partition, quickSort 함수이다.

1. partition(start, end, arr)

- 시작점, 끝점, 배열을 파라미터로 받는다.
- pivot값을 구한다.
- start < end까지 pivot과 비교해서

# 코드

```java


class Main {
    public static void main(String[] args) {
        try (BufferedReader br = new BufferedReader(new InputStreamReader(System.in))) {
            String[] strs = br.readLine().split("");

            int[] arr = new int[strs.length()];

            for(int i=0;i<strs.length();i++) arr[i] = strs[i];

            quickSort(arr, 0, arr.length);
        }
    }

    static int partition(int arr[], int p, int r){
        int low, high;
        int pivot = arr[p];

        low = p+1;
        high = r;

        while(low <= high){
            while(arr[low] < pivot) low++;
            while(arr[high] > pivot) high--;

            if(low <= high) {
                int temp = arr[low];
                arr[low] = arr[high];
                arr[high] = temp;
            }
        }

        int temp = arr[p];
        arr[p] = arr[high];
        arr[high] = temp;
    }

    static void quickSort(int arr[], int left, int right){
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
