# COPY sql 개념 정리

COPY는 테이블과 파일 간에 데이터를 대량으로 전송하는 PostgreSQL 고유 명령이다.

```sql
-- 파일 -> 테이블로 데이터를 가져오기
COPY users FROM '/path/users.csv' WITH (FORMAT csv, HEADER true);

-- 테이블 -> 파일로 데이터 내보내기
COPY users TO '/path/users.csv' WITH(FORMAT csv, HEADER true);

-- 쿼리 결과를 파일로 내보내기
COPY (SELECT * FROM users WHERE age > 20) TO '/path/users.csv' WITH csv;
```

이와같은 방식으로 파일을 직접 DB엔진에서 I/O하는 기능이 가능하다.

# INSERT 보다 COPY가 빠른 이유

COPY는 일반적으로 INSERT 명령어 보다 빠르다고 알려져있다. 그 이유는 INSERT시 발생하는 작업들 중 다수를 생략하기 때문이다.

한번의 INSERT 가 요청되면 다음과 같이 약 7단계정도를 거치게 된다.

> `1.SQL 파싱 (문법 분석) -> 2. 쿼리 재작성 -> 3. 실행 계획 생성 -> 4. 트랜잭션 로깅 -> 5. 인덱스 업데이트 -> 6. 제약 조건 검사 -> 7. 네트워크 왕복 (클라이언트 ↔ 서버)`

이런 과정이 100만건이라면 700만 이상 작업이 필요하게 된다.

이런 과정을 줄이기 위해 대용량 데이터를 처리할 떄는 COPY를 사용해서 처리할 수 있다.

COPY에 필요한 과정은 100만건이 들어오더라도 한번에 처리하게되는 장점이 있다.

> `1. 파일 열기 -> 2. 데이터 스트리밍 읽기 -> 3. 배치 단위로 버퍼에 쌓기 -> 4. 한 번에 테이블에 쓰기 -> 5. 인덱스 일괄 업데이트`

실제 코드를 보면 COPY를 할때 배치게 1000개씩 처리되도록 설정이 된것을 볼 수 있다.

```c
// copyfrom.c의 실제 코드 구조 (간략화)
uint64
CopyFrom(CopyFromState cstate)
{
    HeapTuple *tuples;
    int ntuples;
    int max_tuples = 1000;  // ← 배치 크기 (기본값)
    uint64 processed = 0;

    tuples = palloc(max_tuples * sizeof(HeapTuple));

    for (;;)  // ← 무한 루프: 파일 끝까지 반복
    {
        ntuples = 0;

        // 1000개씩 읽기
        while (ntuples < max_tuples)
        {
            if (!NextCopyFrom(cstate, ...))
                break;  // 파일 끝

            tuples[ntuples] = make_tuple(...);
            ntuples++;
        }

        if (ntuples == 0)
            break;

        // 1000개를 한 번에 삽입
        heap_multi_insert(cstate->rel, tuples, ntuples, ...);

        processed += ntuples;

        // 다음 배치로 계속...
    }

    return processed;  // 총 100만 건
}
```

만약 COPY로 100만건을 처리한다고 **한 번에 처리하지 않고**,
하면 다음과 같은 처리과정을 거친다.

```
파일 읽기 (스트리밍)
    ↓
1,000개씩 배치로 모으기
    ↓
heap_multi_insert (배치 삽입)
    ↓
WAL 기록 (배치당 1번)
    ↓
메모리 해제
    ↓
다음 배치로 반복 (1,000번)
```

이 때문에 INSERT를 매번 실행하거나 배치로 실행하는 것보다 성능상 이점을 가지고있게 된다.
