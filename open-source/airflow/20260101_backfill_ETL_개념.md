# 1. backfill 개념

데이터를 채워 넣는 과정을 의미하며 데이터베이스를 다운받아 전처리 후 DB에 insert하는 과정을 의미한다고 볼 수 있다. 이때 흔히 사용하는 개념을 ETL이라고 한다.

# 2. 여러가지 방법의 ETL

ETL이란 Extract, Transform, Load의 약자이다.
말그대로 외부 데이터를 추출해서 Insert할 수 있도록 변환한 후 Insert하는 것을 의미한다.

## 2.1. ETL 쿼리에서 멱등성 확보하기

postgres 기준으로 다음과 같은 쿼리를 할 수 있다. order_id가 실패하면 다시 로직이 돌면서 똑같은 쿼리를 요청할 수 있기 때문에 `unique key`를 활용해서 컨플릭트가나면 다시 set을 하지 않도록 미리 장치를 두어 멱등성을 확보하는 DAG를 구성할 수 있게된다.

```sql
INSERT INTO olist_orders (
        order_id,
        customer_id,
        order_status,
        order_purchase_timestamp,
        order_approved_at,
        order_delivered_carrier_date,
        order_delivered_customer_date,
        order_estimated_delivery_date
    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
    ON CONFLICT (order_id)
    DO UPDATE SET
        order_status = EXCLUDED.order_status,
        order_approved_at = EXCLUDED.order_approved_at,
        order_delivered_carrier_date = EXCLUDED.order_delivered_carrier_date,
        order_delivered_customer_date = EXCLUDED.order_delivered_customer_date,
        order_estimated_delivery_date = EXCLUDED.order_estimated_delivery_date;
```

멱등성에 대한 처리가 없다면 어떻게 될까?
하나의 날짜에 대해 쿼리를 날렸지만 실수하게됬을 떄 다시 시도(replay)를 한다고 치자. 이때 같은 order_id를 여러번 INSERT하게 되면 unique key에 대한 컨플릭트가 나기 때문에 전체 로직이 성공할 수없게 된다.

때문에 다음 패턴과 같이 멱등성 확보를 위한 처리가 필요해진다.

```sql
INSERT ...
ON CONFLICT (order_id)
DO UPDATE SET ...
```

backfill 실행시 멱등성 처리는 replay를 안정적으로 하기 위해 또 실패시 retry를 했을 때 문제가 되지 않기 위해 필수적으로 처리되어야 한다.

# 3. for 문을 사용한 insert에서 벌어지는 일

INSERT를 for문으로 처리하게되면 DB는 모든 요청마다 다음과 같은 작업을 실행한다.

1. Parser
   - SQL 문법 체크
2. Planner / Optimizer
   - 실행 계획 생성
3. Executor

   - 실제 작업 시작

4. 트랜잭션 시작 (implicit)

5. Row 생성
   - 새 row version 생성 (MVCC)
   - 테이블 파일에 append
6. Index 업데이트

   - PK / 인덱스 하나당 B-Tree insert
   - 충돌 시 unique check

7. WAL 기록 (디스크)

   - durability 보장
   - fsync 발생 가능

8. Lock

   - row-level lock
   - unique index lock

9. COMMIT
   - visibility 보장

때문에 로직에서 for문을 돌며 10만번 insert를 한다는 것은 모든 요청에 대한 처리를 10만 번씩 반복한다는 의미가 된다.

또한 App에서 DB에 요청을 하기 위해 TCP 커넥션을 맺게 되는데 이 또한 10만번 반복해야하는 불상사에 가까운 일이 얼어진다.

## 3.1. bulk insert

위와 같은 현상을 막기위해 bulk insert를 사용하면 보다 효과적으로 sql을 처리할 수 있다.
다음과 같은 문법을 사용하여 VALUES 이하 콤마로 하나의 Insert문으로 묶는 방법을 사용하면 보다 효과적으로 sql을 처리할 수 있게 된다.

```sql
INSERT INTO table (a,b,c)
VALUES
  (1,2,3),
  (4,5,6),
  (7,8,9);
```

## 3.2. 보다 나은 방법 COPY

다음과 같은 방법으로 staging table을 만들고 COPY를 사용하면 SQL을 요청하는 것이 아닌 DB 엔진에게 파일을 직접 주는 형태로 구현을 할 수 있게 된다.

```
CSV
 ↓
[ COPY ]
 ↓
staging_olist_orders
 ↓
[ INSERT ... ON CONFLICT DO UPDATE ]
 ↓
olist_orders
```

### 3.2.1. INSERT와의 차이

1. SQL 파싱 거의 없음
   단한번의 COPY 파싱으로 이후에는 row stream을 직접 다루게 된다.

2. row format 직접 삽입

INSERT를 사용하면 다음과 같은 과정이 발생한다.

```text
text → parse → cast → validate → tuple
```

하지만 COPY를 사용하면 다음 두 동작으로 끝나게 된다.

```text
stream → internal tuple format
```

3. executor bypass 수준

COPY는 일반 executor를 거치지 않고 heap_insert()를 batch 단위로 호출하여 인덱스도 묶어서 처리하므로

4. WAL 최적화

INSERT는 row 1개 = WAL 1개가 생기는 반면 COPY는 chunk 단위 WAL을 생성하므로 page 단위 full image를 사용하게된다.

약 1000개 row가 하나의 WAL 레코드를 생성하게 된다. 이는 수십배에 달하는 디스크 I/O 차이를 만들게 된다.

### 3.2.2. COPY를 “정석”이라 부르는 이유

| 항목      | INSERT        | COPY       |
| --------- | ------------- | ---------- |
| 목적      | 트랜잭션 변경 | 대량 로딩  |
| 사용처    | OLTP          | ETL / DW   |
| 성능      | row 기준      | block 기준 |
| 파싱      | 반복          | 1회        |
| WAL       | row 단위      | batch      |
| 장애 복구 | 약            | 강         |
| Backfill  | 위험          | 안전       |

> COPY FROM STDIN은 “Postgres가 데이터 스트림을 신뢰하고, SQL을 거의 거치지 않고 직접 저장하는 모드”이다.

# 다음으로 봐야할 것.

COPY가 동작하는 원리를 위해 PostgreSQL의 내부 아키텍처에 대한 공부가 필요하다.
