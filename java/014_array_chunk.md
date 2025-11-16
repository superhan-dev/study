# 작성일

- 2025-11-12

# Array chunk 로직 정리

- 로직 한번더 정리하고 Arrays.copyOfRange를 학습할 것

```java
public class Main {
    private final static CHUNK_SIZE = 1000;
    public static void main(String[] args) {
        int[] arr = new int[10_000_000];
        for(int i=0;i<arr.length;i++) arr[i] = i+1;

        sandInChunk(arr,CHUNK_SIZE);
    }

    public static void sandInChunk(int[] arr, int chunkSize){
        for(int start = 0; start < arr.length; start+=chunkSize){
            int end = Math.min(i+chunkSize, arr.length);
            processWindow(arr, start, end);
        }
    }

    // data = arr 맨처음 받음 데이터에서 시작점 부터 끝점까지만 복사해서 처리
    public static void processWindow(int[] data, int start, int end){
        int[] copy = Arrays.copyOfRange(data, start, end);
        System.out.println("Window: " + start + " ~ " + end);
        System.out.println("Copy: " + Arrays.toString(copy));
    }
}

```
