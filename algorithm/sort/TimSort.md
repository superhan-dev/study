# 작성일

- 2025-11-14

# TimSort

정렬을 파고 내려가다 만난 Tim sort에 대해 정리한다.

JDK 에서 정리한 소스를 AI를 통해 알아낸 부분을 추후 정리할 예정

🧠 핵심 코드 — TimSort 일부 (JDK 17 기준)

아래는 java.util.TimSort 소스의 일부입니다.
(단순화를 위해 불필요한 코드는 생략했어요.)

private static <T> int countRunAndMakeAscending(T[] a, int lo, int hi,
Comparator<? super T> c) {
int runHi = lo + 1;
if (runHi == hi)
return 1;

    // 첫 두 원소 비교
    if (c.compare(a[runHi++], a[lo]) < 0) { // descending
        while (runHi < hi && c.compare(a[runHi], a[runHi - 1]) < 0)
            runHi++;
        reverseRange(a, lo, runHi);
    } else { // ascending
        while (runHi < hi && c.compare(a[runHi], a[runHi - 1]) >= 0)
            runHi++;
    }
    return runHi - lo;

}

🔍 여기서 주목할 부분
① compare(...) < 0

→ “내림차순(run descending)”으로 판단합니다.
즉, 음수가 나오면 “앞의 값이 더 크다”고 인식.

② compare(...) >= 0

→ 오름차순 상태 유지로 인식합니다.

여기서 바로 0이 중요한 역할을 합니다.

⚖️ >= 0 조건의 의미

c.compare(a[runHi], a[runHi - 1]) >= 0
이 부분에서 만약 결과가 0이면?

두 값이 같다고 간주 → 오름차순(run ascending)에 포함시킴

즉, 같은 값이라도 뒤에 붙는 것을 허용함

✅ 이게 정렬 안정성의 핵심이에요.

만약 이 조건을 단순히 > 0으로 바꿔버리면?

같을 때(0)도 “순서가 어긋났다”고 판단 → 불필요한 스왑 발생

즉, 같은 값들의 순서가 뒤집힐 수 있음 (unstable sort)

🧩 또 다른 부분 — 병합(Merge) 시 비교
if (c.compare(a[cursor2], tmp[cursor1]) < 0) {
a[dest++] = a[cursor2++];
count2++;
count1 = 0;
} else {
a[dest++] = tmp[cursor1++];
count1++;
count2 = 0;
}

여기서도

compare(...) < 0 → “앞의 값보다 작다” → 왼쪽으로 보냄

else 부분에는 == 0의 경우도 포함됨
→ 같은 값이면 왼쪽(run1) 에서 먼저 들어간 원소를 먼저 채택함

즉, TimSort는 “같은 값(==0)”이면 항상 먼저 등장한 요소를 유지합니다.
→ 정렬 안정성(stable sort) 보장.

✅ 정리
비교 결과 TimSort 내부 처리 결과
< 0 내림차순 판단 / 스왑 발생 가능 순서 조정
== 0 오름차순으로 유지 / 교환 안 함 동등 처리, 안정성 유지

> 0 오름차순 판단 / 스왑 발생 가능 순서 조정
> 💡 결론

-2 (음수) → "앞의 값이 더 작다" → 순서 유지 (정렬 유지)

0 → "같은 값이다" → 비교 중단 + 안정성 유지

겉보기엔 둘 다 “스왑하지 않는다”지만
TimSort는 0을 특별하게 취급해서
같은 값의 상대적 순서까지 보존합니다.

# 참조링크

- [Tim sort에 대해 알아보자](https://d2.naver.com/helloworld/0315536)
