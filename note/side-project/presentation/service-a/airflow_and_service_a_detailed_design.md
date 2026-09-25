# Airflow & Service A 상세 설계 문서
## Data Replay Service 완전 분석

---

## 📋 목차
1. [Service A 데이터 가공 흐름](#service-a-데이터-가공-흐름)
2. [Airflow가 호출하는 API 명세](#airflow가-호출하는-api-명세)
3. [테이블별 상세 동작](#테이블별-상세-동작)
4. [Replay Job 상태 관리](#replay-job-상태-관리)
5. [체크포인트 시스템](#체크포인트-시스템)
6. [전체 시퀀스 다이어그램](#전체-시퀀스-다이어그램)

---

## 1. Service A 데이터 가공 흐름

### 1.1 가공되는 데이터 종류

Service A는 **가공을 하지 않습니다**. 단순히 **저장**만 합니다.

#### ❌ Service A가 하지 않는 것
- CSV 파싱 (Airflow가 수행)
- 데이터 변환 (Airflow가 수행)
- 비즈니스 로직 (Service B가 수행)
- 통계 계산 (Service C가 수행)

#### ✅ Service A가 하는 것
1. **이벤트 수신** - Airflow로부터 HTTP 요청 받기
2. **검증** - 필수 필드 존재 확인
3. **UUID 생성** - event_id 자동 생성
4. **타임스탬프 추가** - ingested_at 자동 설정
5. **DB 저장** - events 테이블에 INSERT
6. **상태 업데이트** - replay_jobs 진행 상황 갱신

### 1.2 데이터 흐름 다이어그램

```
┌─────────────────────────────────────────────────────────────┐
│  Airflow가 보낸 데이터                                       │
├─────────────────────────────────────────────────────────────┤
│  {                                                           │
│    "eventType": "OrderPlaced",                              │
│    "aggregateId": "order_abc123",                           │
│    "payload": {                                             │
│      "customerId": "customer_456",                          │
│      "sellerId": "seller_789",                              │
│      "productId": "product_001",                            │
│      "quantity": 2,                                         │
│      "price": 149.90                                        │
│    },                                                       │
│    "occurredAt": "2017-05-13T14:23:11Z",                   │
│    "replayJobId": "replay_20260124_103000"                 │
│  }                                                          │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Service A가 추가하는 데이터                                 │
├─────────────────────────────────────────────────────────────┤
│  - event_id: UUID.randomUUID()                              │
│    → "550e8400-e29b-41d4-a716-446655440000"                 │
│                                                              │
│  - event_version: 1 (기본값)                                │
│                                                              │
│  - ingested_at: LocalDateTime.now()                         │
│    → "2026-01-24T10:30:45.123Z"                             │
│                                                              │
│  - is_replayed: true (replayJobId 있으면)                   │
│                                                              │
│  - correlation_id: UUID.randomUUID()                        │
│    → "660e8400-e29b-41d4-a716-446655440001"                 │
│                                                              │
│  - causation_id: null (첫 이벤트이므로)                      │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  events 테이블에 저장되는 최종 데이터                         │
├─────────────────────────────────────────────────────────────┤
│  INSERT INTO events (                                       │
│    event_id,                                                │
│    event_type,                                              │
│    event_version,                                           │
│    aggregate_type,                                          │
│    aggregate_id,                                            │
│    payload,                                                 │
│    occurred_at,                                             │
│    ingested_at,                                             │
│    replay_job_id,                                           │
│    is_replayed,                                             │
│    correlation_id,                                          │
│    causation_id                                             │
│  ) VALUES (                                                 │
│    '550e8400-e29b-41d4-a716-446655440000',                 │
│    'OrderPlaced',                                           │
│    1,                                                       │
│    'Order',                                                 │
│    'order_abc123',                                          │
│    '{"customerId":"customer_456",...}',                     │
│    '2017-05-13T14:23:11Z',                                 │
│    '2026-01-24T10:30:45.123Z',                             │
│    'replay_20260124_103000',                               │
│    true,                                                    │
│    '660e8400-e29b-41d4-a716-446655440001',                 │
│    null                                                     │
│  );                                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Airflow가 호출하는 API 명세

### 🔄 두 가지 리플레이 방식

#### 방식 1: CSV 기반 (간단, 초기 개발용)
- Airflow가 CSV 파일 읽어서 직접 이벤트 전송
- API #3 (POST /events) 반복 호출

#### 방식 2: DB 기반 (권장, 운영용) ⭐
- 초기에 한 번 CSV 데이터를 DB에 적재
- Service A가 DB에서 조회해서 이벤트 생성
- 유연한 필터링 가능

---

### 2.0 API #0: 원본 데이터 적재 (DB 기반 방식) ⭐

#### Endpoint
```
POST /api/v1/raw-data/orders/batch
```

#### 호출 시점
**최초 1회** - Airflow DAG `initial_data_load` 실행 시

#### 목적
CSV 데이터를 raw_order_data 테이블에 저장하여, 이후 리플레이는 DB에서 수행

#### Request Body
```json
{
  "sourceFile": "olist_orders_2017_05.csv",
  "orders": [
    {
      "orderId": "order_abc123",
      "customerId": "customer_456",
      "orderStatus": "delivered",
      "orderPurchaseTimestamp": "2017-05-13T14:23:11Z",
      "orderApprovedAt": "2017-05-13T15:10:22Z",
      "orderDeliveredCarrierDate": "2017-05-15T09:30:45Z",
      "orderDeliveredCustomerDate": "2017-05-18T16:45:30Z",
      "orderEstimatedDeliveryDate": "2017-05-20T23:59:59Z",
      "customerState": "SP",
      "customerCity": "São Paulo",
      "customerZipCodePrefix": 1000,
      "orderItems": [
        {
          "orderItemId": 1,
          "productId": "product_001",
          "sellerId": "seller_789",
          "price": 149.90,
          "freight": 15.50,
          "shippingLimitDate": "2017-05-20T23:59:59Z"
        }
      ],
      "paymentValue": 165.40,
      "paymentType": "credit_card",
      "paymentInstallments": 3,
      "reviewScore": 5,
      "reviewCommentTitle": "Excellent!",
      "reviewCommentMessage": "Great product"
    }
    // ... 최대 1000개 배치
  ]
}
```

#### Service A 동작
1. **검증**
   - 필수 필드 존재 확인
   - orderId 중복 체크

2. **테이블 변경: raw_order_data (BULK INSERT)**
   ```sql
   INSERT INTO raw_order_data (
       order_id,
       customer_id,
       order_status,
       order_purchase_timestamp,
       order_approved_at,
       order_delivered_carrier_date,
       order_delivered_customer_date,
       order_estimated_delivery_date,
       customer_state,
       customer_city,
       customer_zip_code_prefix,
       order_items,
       payment_value,
       payment_type,
       payment_installments,
       review_score,
       review_comment_title,
       review_comment_message,
       source_file
   ) VALUES
   ('order_abc123', 'customer_456', 'delivered', ...),
   ('order_abc124', 'customer_457', 'delivered', ...),
   ... -- 최대 1000개
   ON CONFLICT (order_id) DO NOTHING;  -- 중복 스킵
   ```

3. **응답 반환**
   ```json
   {
     "imported": 998,
     "failed": 0,
     "duplicates": 2,
     "totalProcessed": 1000
   }
   ```

#### Airflow 사용 예시
```python
# Airflow DAG: initial_data_load
def load_csv_to_service_a(**context):
    # 1. CSV 파일들 읽기 및 JOIN
    orders_df = pd.read_csv("olist_orders.csv")
    items_df = pd.read_csv("olist_order_items.csv")
    customers_df = pd.read_csv("olist_customers.csv")
    payments_df = pd.read_csv("olist_order_payments.csv")
    reviews_df = pd.read_csv("olist_order_reviews.csv")
    
    # 2. JOIN
    merged = orders_df.merge(customers_df, on='customer_id') \
                      .merge(payments_df, on='order_id') \
                      .merge(reviews_df, on='order_id', how='left')
    
    # 3. order_items를 JSONB로 그룹화
    items_grouped = items_df.groupby('order_id').apply(
        lambda x: x.to_dict('records')
    ).to_dict()
    
    # 4. 1000개씩 배치 전송
    batch_size = 1000
    for i in range(0, len(merged), batch_size):
        batch = merged.iloc[i:i+batch_size]
        
        orders_data = []
        for _, row in batch.iterrows():
            order = {
                "orderId": row["order_id"],
                "customerId": row["customer_id"],
                "orderStatus": row["order_status"],
                "orderPurchaseTimestamp": row["order_purchase_timestamp"],
                "orderItems": items_grouped.get(row["order_id"], []),
                "paymentValue": row["payment_value"],
                "customerState": row["customer_state"],
                # ... 나머지 필드
            }
            orders_data.append(order)
        
        # Service A API 호출
        response = requests.post(
            f"{SERVICE_A_URL}/api/v1/raw-data/orders/batch",
            json={
                "sourceFile": "olist_orders_2017_05.csv",
                "orders": orders_data
            }
        )
        
        print(f"Batch {i//batch_size + 1}: {response.json()}")
```

---

### 2.1 API #1: Replay Job 생성 (수정됨) ⭐

#### Endpoint
```
POST /api/v1/replay-jobs
```

#### 호출 시점
Airflow DAG 시작 직후

#### Request Body (방식 1: CSV 기반)
```json
{
  "replayJobId": "replay_csv_20260124_103000",
  "sourceType": "CSV",
  "sourceLocation": "s3://olist-data/olist_orders.csv",
  "startTime": "2017-05-01T00:00:00Z",
  "endTime": "2017-05-31T23:59:59Z",
  "speedMultiplier": 100.0,
  "eventsPerSecond": 1000,
  "totalEvents": 99441
}
```

#### Request Body (방식 2: DB 기반) ⭐ 권장
```json
{
  "replayJobId": "replay_db_sp_may_2017",
  "sourceType": "DATABASE",
  "sourceLocation": "raw_order_data",
  "filter": {
    "startTime": "2017-05-01T00:00:00Z",
    "endTime": "2017-05-31T23:59:59Z",
    "customerState": "SP",
    "minPaymentValue": 100.0,
    "orderStatus": ["delivered", "shipped"]
  },
  "speedMultiplier": 100.0,
  "eventsPerSecond": 1000
}
```

#### Service A 동작

**방식 1 (CSV)**: 
- totalEvents를 그대로 저장

**방식 2 (DB)**: ⭐
1. **필터 조건으로 데이터 개수 조회**
   ```sql
   SELECT COUNT(*) FROM raw_order_data
   WHERE order_purchase_timestamp BETWEEN '2017-05-01' AND '2017-05-31'
     AND customer_state = 'SP'
     AND payment_value >= 100.0
     AND order_status IN ('delivered', 'shipped');
   -- 결과: 5,234건
   ```

2. **테이블 변경: replay_jobs**
   ```sql
   INSERT INTO replay_jobs (
       replay_job_id,
       source_type,
       source_location,
       filter_condition,        -- 새 필드 (JSONB)
       start_time,
       end_time,
       speed_multiplier,
       events_per_second,
       total_events,            -- 5,234 (조회 결과)
       processed_events,
       status,
       created_at,
       updated_at
   ) VALUES (
       'replay_db_sp_may_2017',
       'DATABASE',
       'raw_order_data',
       '{"customerState":"SP","minPaymentValue":100.0}',
       '2017-05-01 00:00:00',
       '2017-05-31 23:59:59',
       100.0,
       1000,
       5234,                    -- 계산된 값
       0,
       'CREATED',
       '2026-01-24 10:30:00',
       '2026-01-24 10:30:00'
   );
   ```

3. **응답 반환**
   ```json
   {
     "replayJobId": "replay_db_sp_may_2017",
     "sourceType": "DATABASE",
     "totalEvents": 5234,
     "status": "CREATED",
     "message": "Replay job created successfully (5,234 events from database)"
   }
   ```

#### 실패 케이스
- replayJobId 중복 → 409 Conflict
- 필수 필드 누락 → 400 Bad Request
- DB 기반인데 raw_order_data에 데이터 없음 → 400 Bad Request

---

### 2.2 API #2: Replay Job 시작 (수정됨)

#### Endpoint
```
POST /api/v1/replay-jobs/{replayJobId}/start
```

#### 호출 시점
Replay Job 생성 직후

#### Request Body
없음 (경로 변수만 사용)

#### Service A 동작

**1. 조회**
```sql
SELECT * FROM replay_jobs
WHERE replay_job_id = 'replay_db_sp_may_2017';
```

**2. 상태 검증**
- 현재 상태가 'CREATED' 또는 'PAUSED'인지 확인
- 다른 상태면 에러 반환

**3. 테이블 변경: replay_jobs**
```sql
UPDATE replay_jobs
SET 
    status = 'RUNNING',
    started_at = '2026-01-24 10:30:05',
    updated_at = '2026-01-24 10:30:05'
WHERE replay_job_id = 'replay_db_sp_may_2017';
```

**4. 비동기 이벤트 생성 시작 (sourceType에 따라 분기)** ⭐

#### 방식 1: CSV 기반
```java
// Airflow가 이벤트를 전송하므로, 여기서는 상태만 변경
// 실제 이벤트는 API #3 (POST /events)로 받음
```

#### 방식 2: DB 기반 (Service A 내부 처리) ⭐
```java
@Async  // 별도 스레드에서 실행
public void startDatabaseReplay(String replayJobId) {
    // 1. Replay Job 조회
    ReplayJob job = replayJobRepository.findById(replayJobId);
    
    // 2. 필터 조건 파싱
    JsonNode filter = job.getFilterCondition();
    
    // 3. raw_order_data 조회 (필터 적용)
    String sql = buildDynamicQuery(filter);
    List<RawOrderData> orders = jdbcTemplate.query(sql, new RawOrderDataMapper());
    
    // SELECT * FROM raw_order_data
    // WHERE order_purchase_timestamp BETWEEN ? AND ?
    //   AND customer_state = ?
    //   AND payment_value >= ?
    // ORDER BY order_purchase_timestamp ASC;
    
    // 4. 각 주문을 이벤트로 변환하여 저장
    for (RawOrderData order : orders) {
        // 이벤트 생성
        Event event = Event.builder()
            .eventId(UUID.randomUUID())
            .eventType("OrderPlaced")
            .aggregateType("Order")
            .aggregateId(order.getOrderId())
            .payload(order.toJsonString())
            .occurredAt(order.getOrderPurchaseTimestamp())
            .ingestedAt(LocalDateTime.now())
            .replayJobId(replayJobId)
            .isReplayed(true)
            .correlationId(UUID.randomUUID())
            .build();
        
        // events 테이블에 저장
        eventRepository.save(event);
        
        // 진행 상황 업데이트 (100개마다)
        if (processedCount % 100 == 0) {
            replayJobRepository.updateProgress(replayJobId, processedCount);
        }
        
        // 속도 제어
        Thread.sleep(calculateDelay(job.getSpeedMultiplier()));
    }
    
    // 5. 완료 처리
    replayJobRepository.updateStatus(replayJobId, ReplayStatus.COMPLETED);
}
```

**5. 응답 반환**
```json
{
  "replayJobId": "replay_db_sp_may_2017",
  "status": "RUNNING",
  "sourceType": "DATABASE",
  "startedAt": "2026-01-24T10:30:05Z",
  "message": "Replay started (processing 5,234 events from database)"
}
```

---

### 2.3 API #3: 이벤트 저장 (CSV 방식 전용)

#### Endpoint
```
POST /api/v1/events
```

#### 호출 시점
**CSV 방식일 때만** - CSV의 각 행마다 반복 호출 (예: 99,441번)

**DB 방식일 때는 호출 안 함** - Service A 내부에서 자동 생성

#### Request Body
```json
{
  "eventType": "OrderPlaced",
  "aggregateId": "order_abc123",
  "payload": {
    "customerId": "customer_456",
    "sellerId": "seller_789",
    "productId": "product_001",
    "quantity": 2,
    "price": 149.90,
    "purchaseTimestamp": "2017-05-13T14:23:11Z"
  },
  "occurredAt": "2017-05-13T14:23:11Z",
  "replayJobId": "replay_csv_20260124_103000"
}
```

#### Service A 동작
1. **검증**
   - eventType 존재?
   - aggregateId 존재?
   - occurredAt 유효한 날짜?

2. **UUID 생성**
   ```java
   UUID eventId = UUID.randomUUID();
   UUID correlationId = UUID.randomUUID();
   ```

3. **aggregate_type 결정**
   ```java
   String aggregateType = determineAggregateType(eventType);
   // "OrderPlaced" → "Order"
   // "InventoryReserved" → "Inventory"
   ```

4. **테이블 변경 #1: events**
   ```sql
   INSERT INTO events (
       event_id,
       event_type,
       event_version,
       aggregate_type,
       aggregate_id,
       payload,
       occurred_at,
       ingested_at,
       replay_job_id,
       is_replayed,
       correlation_id,
       causation_id
   ) VALUES (
       '550e8400-e29b-41d4-a716-446655440000',
       'OrderPlaced',
       1,
       'Order',
       'order_abc123',
       '{"customerId":"customer_456","sellerId":"seller_789","productId":"product_001","quantity":2,"price":149.90}',
       '2017-05-13 14:23:11',
       '2026-01-24 10:30:45.123',
       'replay_csv_20260124_103000',
       true,
       '660e8400-e29b-41d4-a716-446655440001',
       null
   );
   ```

5. **테이블 변경 #2: replay_jobs (진행 상황)**
   ```sql
   UPDATE replay_jobs
   SET 
       processed_events = processed_events + 1,
       last_processed_at = '2026-01-24 10:30:45.123',
       updated_at = '2026-01-24 10:30:45.123'
   WHERE replay_job_id = 'replay_csv_20260124_103000';
   ```
   
   **최적화**: 매번 UPDATE는 비효율적이므로, 100개마다 또는 별도 API #4 사용

6. **응답 반환**
   ```json
   {
     "eventId": "550e8400-e29b-41d4-a716-446655440000",
     "status": "SAVED",
     "ingestedAt": "2026-01-24T10:30:45.123Z"
   }
   ```

---

### 2.4 API #4: 진행 상황 업데이트 (배치)

#### Endpoint
```
PUT /api/v1/replay-jobs/{replayJobId}/progress
```

#### 호출 시점
100개 이벤트마다 한 번 (성능 최적화)

#### Request Body
```json
{
  "processedEvents": 100,
  "lastProcessedEventId": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### Service A 동작
1. **테이블 변경: replay_jobs**
   ```sql
   UPDATE replay_jobs
   SET 
       processed_events = 100,
       last_processed_at = '2026-01-24 10:30:50',
       updated_at = '2026-01-24 10:30:50'
   WHERE replay_job_id = 'replay_20260124_103000';
   ```

2. **응답 반환**
   ```json
   {
     "replayJobId": "replay_20260124_103000",
     "processedEvents": 100,
     "totalEvents": 99441,
     "progressPercentage": 0.1
   }
   ```

---

### 2.5 API #5: 체크포인트 저장

#### Endpoint
```
POST /api/v1/replay-jobs/{replayJobId}/checkpoint
```

#### 호출 시점
100개 이벤트마다 또는 1분마다 (Airflow가 결정)

#### Request Body
```json
{
  "csvFile": "olist_orders.csv",
  "lastLineNumber": 100,
  "lastEventId": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### Service A 동작
1. **UPSERT 동작**
   ```sql
   INSERT INTO csv_offsets (
       replay_job_id,
       csv_file,
       last_line_number,
       last_event_id,
       total_lines,
       processed_lines,
       last_processed_at,
       updated_at
   ) VALUES (
       'replay_20260124_103000',
       'olist_orders.csv',
       100,
       '550e8400-e29b-41d4-a716-446655440000',
       99441,
       100,
       '2026-01-24 10:30:50',
       '2026-01-24 10:30:50'
   )
   ON CONFLICT (replay_job_id, csv_file)
   DO UPDATE SET
       last_line_number = 100,
       last_event_id = '550e8400-e29b-41d4-a716-446655440000',
       processed_lines = 100,
       last_processed_at = '2026-01-24 10:30:50',
       updated_at = '2026-01-24 10:30:50';
   ```

2. **응답 반환**
   ```json
   {
     "replayJobId": "replay_20260124_103000",
     "csvFile": "olist_orders.csv",
     "checkpointSaved": true,
     "lastLineNumber": 100
   }
   ```

---

### 2.6 API #6: 체크포인트 조회

#### Endpoint
```
GET /api/v1/replay-jobs/{replayJobId}/checkpoint?csvFile=olist_orders.csv
```

#### 호출 시점
Airflow DAG 재시작 시 (중단 후 재개)

#### Request Body
없음 (Query Parameter 사용)

#### Service A 동작
1. **조회**
   ```sql
   SELECT 
       last_line_number,
       last_event_id,
       processed_lines,
       last_processed_at
   FROM csv_offsets
   WHERE replay_job_id = 'replay_20260124_103000'
     AND csv_file = 'olist_orders.csv';
   ```

2. **응답 반환 (존재할 때)**
   ```json
   {
     "replayJobId": "replay_20260124_103000",
     "csvFile": "olist_orders.csv",
     "lastLineNumber": 100,
     "lastEventId": "550e8400-e29b-41d4-a716-446655440000",
     "processedLines": 100,
     "lastProcessedAt": "2026-01-24T10:30:50Z"
   }
   ```

3. **응답 반환 (없을 때 - 첫 실행)**
   ```json
   {
     "replayJobId": "replay_20260124_103000",
     "csvFile": "olist_orders.csv",
     "lastLineNumber": 0,
     "lastEventId": null,
     "processedLines": 0,
     "lastProcessedAt": null
   }
   ```

#### 테이블 변경
**없음** (읽기 전용 API)

---

### 2.7 API #7: Replay Job 일시정지

#### Endpoint
```
POST /api/v1/replay-jobs/{replayJobId}/pause
```

#### 호출 시점
사용자가 일시정지 버튼 클릭 시 (Airflow UI 또는 Admin UI)

#### Service A 동작
1. **상태 검증**
   ```sql
   SELECT status FROM replay_jobs
   WHERE replay_job_id = 'replay_20260124_103000';
   ```
   - 현재 'RUNNING'인지 확인
   - 아니면 에러 반환

2. **테이블 변경: replay_jobs**
   ```sql
   UPDATE replay_jobs
   SET 
       status = 'PAUSED',
       paused_at = '2026-01-24 10:35:00',
       updated_at = '2026-01-24 10:35:00'
   WHERE replay_job_id = 'replay_20260124_103000';
   ```

3. **응답 반환**
   ```json
   {
     "replayJobId": "replay_20260124_103000",
     "status": "PAUSED",
     "pausedAt": "2026-01-24T10:35:00Z",
     "processedEvents": 5000,
     "totalEvents": 99441
   }
   ```

---

### 2.8 API #8: Replay Job 재개

#### Endpoint
```
POST /api/v1/replay-jobs/{replayJobId}/resume
```

#### 호출 시점
일시정지된 Job을 다시 시작할 때

#### Service A 동작
1. **상태 검증**
   - 현재 'PAUSED'인지 확인

2. **테이블 변경: replay_jobs**
   ```sql
   UPDATE replay_jobs
   SET 
       status = 'RUNNING',
       resumed_at = '2026-01-24 10:40:00',
       updated_at = '2026-01-24 10:40:00'
   WHERE replay_job_id = 'replay_20260124_103000';
   ```

3. **응답 반환**
   ```json
   {
     "replayJobId": "replay_20260124_103000",
     "status": "RUNNING",
     "resumedAt": "2026-01-24T10:40:00Z"
   }
   ```

---

### 2.9 API #9: Replay Job 완료

#### Endpoint
```
POST /api/v1/replay-jobs/{replayJobId}/complete
```

#### 호출 시점
모든 이벤트 전송 완료 후

#### Request Body
```json
{
  "finalProcessedEvents": 99441
}
```

#### Service A 동작
1. **테이블 변경: replay_jobs**
   ```sql
   UPDATE replay_jobs
   SET 
       status = 'COMPLETED',
       processed_events = 99441,
       completed_at = '2026-01-24 11:45:23',
       updated_at = '2026-01-24 11:45:23'
   WHERE replay_job_id = 'replay_20260124_103000';
   ```

2. **응답 반환**
   ```json
   {
     "replayJobId": "replay_20260124_103000",
     "status": "COMPLETED",
     "completedAt": "2026-01-24T11:45:23Z",
     "processedEvents": 99441,
     "totalEvents": 99441,
     "duration": "1h 15m 23s"
   }
   ```

---

### 2.10 API #10: Replay Job 취소

#### Endpoint
```
POST /api/v1/replay-jobs/{replayJobId}/cancel
```

#### 호출 시점
사용자가 취소 버튼 클릭 시

#### Service A 동작
1. **테이블 변경: replay_jobs**
   ```sql
   UPDATE replay_jobs
   SET 
       status = 'CANCELLED',
       cancelled_at = '2026-01-24 10:50:00',
       updated_at = '2026-01-24 10:50:00'
   WHERE replay_job_id = 'replay_20260124_103000';
   ```

---

### 2.11 API #11: Replay Job 상태 조회

#### Endpoint
```
GET /api/v1/replay-jobs/{replayJobId}
```

#### 호출 시점
Airflow DAG 내에서 주기적으로 (모니터링용)

#### Service A 동작
1. **조회**
   ```sql
   SELECT * FROM replay_jobs
   WHERE replay_job_id = 'replay_20260124_103000';
   ```

2. **응답 반환**
   ```json
   {
     "replayJobId": "replay_20260124_103000",
     "sourceType": "CSV",
     "sourceLocation": "s3://olist-data/olist_orders.csv",
     "status": "RUNNING",
     "processedEvents": 5000,
     "totalEvents": 99441,
     "progressPercentage": 5.03,
     "speedMultiplier": 100.0,
     "eventsPerSecond": 1000,
     "startedAt": "2026-01-24T10:30:05Z",
     "lastProcessedAt": "2026-01-24T10:35:10Z",
     "estimatedCompletionTime": "2026-01-24T11:59:23Z"
   }
   ```

#### 테이블 변경
**없음** (읽기 전용 API)

---

## 3. 테이블별 상세 동작

### 3.1 events 테이블

#### INSERT 시점
API #3 (이벤트 저장) 호출할 때마다

#### 변경 필드
```sql
-- 모든 필드가 INSERT 시 결정됨
-- UPDATE는 없음 (불변 데이터)
```

#### 예시 데이터 흐름
```
Airflow 전송:
{
  "eventType": "OrderPlaced",
  "aggregateId": "order_abc123",
  "payload": {...},
  "occurredAt": "2017-05-13T14:23:11Z",
  "replayJobId": "replay_001"
}

↓ Service A 처리

events 테이블:
event_id              | 550e8400-... (생성)
event_type            | OrderPlaced (그대로)
event_version         | 1 (기본값)
aggregate_type        | Order (추론)
aggregate_id          | order_abc123 (그대로)
payload               | {...} (그대로)
occurred_at           | 2017-05-13 14:23:11 (그대로)
ingested_at           | 2026-01-24 10:30:45 (생성)
replay_job_id         | replay_001 (그대로)
is_replayed           | true (자동)
correlation_id        | 660e8400-... (생성)
causation_id          | null (기본값)
```

---

### 3.2 replay_jobs 테이블

#### 생명주기

```
1. CREATE (API #1)
   status = 'CREATED'
   
2. START (API #2)
   status = 'RUNNING'
   started_at = NOW()
   
3. PROGRESS (API #4, 반복)
   processed_events += 100
   last_processed_at = NOW()
   
4-1. COMPLETE (API #9)
   status = 'COMPLETED'
   completed_at = NOW()
   
4-2. PAUSE (API #7)
   status = 'PAUSED'
   paused_at = NOW()
   
   → RESUME (API #8)
   status = 'RUNNING'
   resumed_at = NOW()
   
4-3. CANCEL (API #10)
   status = 'CANCELLED'
   cancelled_at = NOW()
```

#### 상태별 테이블 값

| 상태 | processed_events | started_at | completed_at | paused_at |
|------|------------------|------------|--------------|-----------|
| CREATED | 0 | null | null | null |
| RUNNING | 증가 중 | 있음 | null | null |
| PAUSED | 고정 | 있음 | null | 있음 |
| COMPLETED | = total_events | 있음 | 있음 | null |
| CANCELLED | 중단된 값 | 있음 | null | null |

---

### 3.3 csv_offsets 테이블

#### UPSERT 시점
API #5 (체크포인트 저장) 호출할 때마다

#### 동작 흐름

**첫 번째 체크포인트 (INSERT)**
```sql
-- 100번째 줄 처리 완료
INSERT INTO csv_offsets (
    replay_job_id,
    csv_file,
    last_line_number,
    last_event_id,
    processed_lines
) VALUES (
    'replay_001',
    'olist_orders.csv',
    100,
    'event-uuid-100',
    100
);
```

**두 번째 체크포인트 (UPDATE)**
```sql
-- 200번째 줄 처리 완료
UPDATE csv_offsets
SET 
    last_line_number = 200,
    last_event_id = 'event-uuid-200',
    processed_lines = 200,
    last_processed_at = NOW()
WHERE replay_job_id = 'replay_001'
  AND csv_file = 'olist_orders.csv';
```

#### 실제 데이터 예시

| replay_job_id | csv_file | last_line_number | processed_lines | last_processed_at |
|---------------|----------|------------------|-----------------|-------------------|
| replay_001 | olist_orders.csv | 0 | 0 | null |
| replay_001 | olist_orders.csv | 100 | 100 | 10:30:50 |
| replay_001 | olist_orders.csv | 200 | 200 | 10:31:05 |
| replay_001 | olist_orders.csv | 5000 | 5000 | 10:45:23 |

---

### 3.4 raw_order_data 테이블 ⭐ (신규 추가)

#### 목적
**CSV 원본 데이터를 DB에 저장하여 유연한 리플레이 제공**

#### 왜 필요한가?
1. **CSV 파일 독립**: 파일 삭제되어도 리플레이 가능
2. **유연한 필터링**: "2017년 5월 SP주만" 같은 조건 리플레이
3. **빠른 조회**: SQL 인덱스로 특정 구간 선택
4. **Service A 단독 실행**: Airflow 없이도 리플레이 가능

#### 테이블 구조
```sql
CREATE TABLE raw_order_data (
    -- Primary Key
    order_id VARCHAR(32) PRIMARY KEY,
    
    -- 주문 기본 정보
    customer_id VARCHAR(32) NOT NULL,
    order_status VARCHAR(20) NOT NULL,
    order_purchase_timestamp TIMESTAMP NOT NULL,
    order_approved_at TIMESTAMP,
    order_delivered_carrier_date TIMESTAMP,
    order_delivered_customer_date TIMESTAMP,
    order_estimated_delivery_date TIMESTAMP,
    
    -- 고객 정보 (비정규화)
    customer_unique_id VARCHAR(32),
    customer_zip_code_prefix INT,
    customer_city VARCHAR(50),
    customer_state CHAR(2),
    
    -- 주문 아이템 (JSONB - 한 주문에 여러 상품 가능)
    order_items JSONB NOT NULL,
    -- 예시: [
    --   {
    --     "orderItemId": 1,
    --     "productId": "prod_001",
    --     "sellerId": "seller_789",
    --     "price": 149.90,
    --     "freight": 15.50,
    --     "shippingLimitDate": "2017-05-20T23:59:59Z"
    --   }
    -- ]
    
    -- 결제 정보
    payment_sequential INT,
    payment_type VARCHAR(20),
    payment_installments INT,
    payment_value DECIMAL(10, 2),
    
    -- 리뷰 정보 (nullable - 모든 주문에 리뷰가 있는 건 아님)
    review_id VARCHAR(32),
    review_score INT,
    review_comment_title VARCHAR(100),
    review_comment_message TEXT,
    review_creation_date TIMESTAMP,
    
    -- 메타데이터
    source_file VARCHAR(255),               -- "olist_orders_2017_05.csv"
    ingested_at TIMESTAMP DEFAULT NOW(),
    data_version INT DEFAULT 1,
    
    -- 타임스탬프
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스 (리플레이 필터링 최적화)
CREATE INDEX idx_raw_order_purchase_time ON raw_order_data(order_purchase_timestamp);
CREATE INDEX idx_raw_order_customer_state ON raw_order_data(customer_state);
CREATE INDEX idx_raw_order_status ON raw_order_data(order_status);
CREATE INDEX idx_raw_order_source_file ON raw_order_data(source_file);
CREATE INDEX idx_raw_order_payment_value ON raw_order_data(payment_value);
```

#### INSERT 시점
**초기 데이터 적재 시 (한 번만)**

Airflow DAG `initial_data_load` 실행:
1. CSV 5개 파일 읽기 (orders, items, customers, payments, reviews)
2. JOIN 및 변환
3. Service A API 호출 → raw_order_data 테이블 INSERT

#### 예시 데이터
```sql
INSERT INTO raw_order_data (
    order_id,
    customer_id,
    order_status,
    order_purchase_timestamp,
    order_approved_at,
    order_delivered_carrier_date,
    order_delivered_customer_date,
    order_estimated_delivery_date,
    customer_state,
    customer_city,
    customer_zip_code_prefix,
    order_items,
    payment_value,
    review_score,
    source_file
) VALUES (
    'order_abc123',
    'customer_456',
    'delivered',
    '2017-05-13 14:23:11',
    '2017-05-13 15:10:22',
    '2017-05-15 09:30:45',
    '2017-05-18 16:45:30',
    '2017-05-20 23:59:59',
    'SP',
    'São Paulo',
    1000,
    '[
        {
            "orderItemId": 1,
            "productId": "product_001",
            "sellerId": "seller_789",
            "price": 149.90,
            "freight": 15.50
        }
    ]',
    165.40,
    5,
    'olist_orders_2017_05.csv'
);
```

#### 리플레이 시 조회 예시
```sql
-- 시나리오 1: 2017년 5월 전체 리플레이
SELECT * FROM raw_order_data
WHERE order_purchase_timestamp BETWEEN '2017-05-01' AND '2017-05-31'
ORDER BY order_purchase_timestamp ASC;

-- 시나리오 2: SP주만 리플레이
SELECT * FROM raw_order_data
WHERE customer_state = 'SP'
ORDER BY order_purchase_timestamp ASC;

-- 시나리오 3: 100달러 이상 주문만 리플레이
SELECT * FROM raw_order_data
WHERE payment_value >= 100.0
ORDER BY order_purchase_timestamp ASC;

-- 시나리오 4: 복합 조건
SELECT * FROM raw_order_data
WHERE order_purchase_timestamp BETWEEN '2017-05-01' AND '2017-05-31'
  AND customer_state = 'SP'
  AND payment_value >= 100.0
ORDER BY order_purchase_timestamp ASC;
```

---

### 3.5 event_snapshots 테이블

#### 목적
성능 최적화 (현재 Phase에서는 사용 안 함)

#### 사용 시나리오
나중에 Event Sourcing으로 Aggregate 재구성할 때, 처음부터 모든 이벤트를 재생하지 않고 최근 스냅샷부터 시작

#### 예시
```sql
-- 10,000개 이벤트마다 스냅샷 생성
INSERT INTO event_snapshots (
    snapshot_id,
    aggregate_type,
    aggregate_id,
    snapshot_data,
    version,
    last_event_id,
    snapshot_at
) VALUES (
    'snapshot-uuid-001',
    'Order',
    'order_abc123',
    '{"status":"SHIPPED","items":[...]}',
    10000,
    'event-uuid-10000',
    '2026-01-24 11:00:00'
);
```

**Phase 2에서는 구현하지 않음** (추후 확장용)

---

## 4. Replay Job 상태 관리

### 4.1 상태 전이 다이어그램

```
                     ┌─────────┐
                     │ CREATED │
                     └────┬────┘
                          │ start
                          ▼
                     ┌─────────┐
              ┌──────│ RUNNING │──────┐
              │      └────┬────┘      │
              │           │           │
          pause│           │complete   │cancel
              │           │           │
              ▼           ▼           ▼
         ┌────────┐  ┌──────────┐  ┌──────────┐
         │ PAUSED │  │COMPLETED │  │CANCELLED │
         └────┬───┘  └──────────┘  └──────────┘
              │
          resume│
              │
              └──────────────┐
                             │
                             ▼
                        ┌─────────┐
                        │ RUNNING │
                        └─────────┘
```

### 4.2 상태별 허용 동작

| 현재 상태 | 허용 동작 | 금지 동작 |
|-----------|-----------|-----------|
| CREATED | start | pause, resume, complete |
| RUNNING | pause, complete, cancel | start, resume |
| PAUSED | resume, cancel | start, pause, complete |
| COMPLETED | (없음 - 종료 상태) | 모든 동작 |
| CANCELLED | (없음 - 종료 상태) | 모든 동작 |

### 4.3 상태별 API 호출 가능 여부

```
┌──────────────────────────────────────────────────────────┐
│  상태          │ start │ pause │ resume │ complete │ cancel │
├────────────────┼───────┼───────┼────────┼──────────┼────────┤
│  CREATED       │   ✅  │   ❌  │   ❌   │    ❌    │   ❌   │
│  RUNNING       │   ❌  │   ✅  │   ❌   │    ✅    │   ✅   │
│  PAUSED        │   ❌  │   ❌  │   ✅   │    ❌    │   ✅   │
│  COMPLETED     │   ❌  │   ❌  │   ❌   │    ❌    │   ❌   │
│  CANCELLED     │   ❌  │   ❌  │   ❌   │    ❌    │   ❌   │
│  FAILED        │   ❌  │   ❌  │   ❌   │    ❌    │   ❌   │
└──────────────────────────────────────────────────────────┘
```

### 4.4 에러 처리 예시

#### 시나리오 1: 이미 RUNNING 상태에서 start 호출
```
Request:
POST /api/v1/replay-jobs/replay_001/start

Response: 400 Bad Request
{
  "error": "InvalidStateTransition",
  "message": "Cannot start replay job in RUNNING state",
  "currentStatus": "RUNNING",
  "allowedTransitions": ["pause", "complete", "cancel"]
}
```

#### 시나리오 2: COMPLETED 상태에서 resume 호출
```
Request:
POST /api/v1/replay-jobs/replay_001/resume

Response: 400 Bad Request
{
  "error": "InvalidStateTransition",
  "message": "Cannot resume replay job in COMPLETED state",
  "currentStatus": "COMPLETED",
  "allowedTransitions": []
}
```

---

## 5. 체크포인트 시스템

### 5.1 체크포인트 저장 전략

#### 옵션 1: 시간 기반 (1분마다)
```python
# Airflow DAG
last_checkpoint_time = time.time()

for index, row in df.iterrows():
    send_event(row)
    
    # 1분 경과 체크
    if time.time() - last_checkpoint_time >= 60:
        save_checkpoint(replay_id, csv_file, index)
        last_checkpoint_time = time.time()
```

#### 옵션 2: 개수 기반 (100개마다)
```python
# Airflow DAG
for index, row in df.iterrows():
    send_event(row)
    
    # 100개마다 체크포인트
    if (index + 1) % 100 == 0:
        save_checkpoint(replay_id, csv_file, index)
```

#### 옵션 3: 하이브리드 (100개 또는 1분)
```python
# Airflow DAG (권장)
last_checkpoint_time = time.time()
last_checkpoint_index = 0

for index, row in df.iterrows():
    send_event(row)
    
    # 100개 또는 1분 중 먼저 도달한 조건
    should_checkpoint = (
        (index - last_checkpoint_index >= 100) or
        (time.time() - last_checkpoint_time >= 60)
    )
    
    if should_checkpoint:
        save_checkpoint(replay_id, csv_file, index)
        last_checkpoint_time = time.time()
        last_checkpoint_index = index
```

### 5.2 체크포인트 조회 및 재개 흐름

```
1. Airflow DAG 시작
   ↓
2. GET /api/v1/replay-jobs/{id}/checkpoint
   ↓
3. Service A 응답:
   - lastLineNumber: 5000
   - processedLines: 5000
   ↓
4. Airflow: df.iloc[5001:] 부터 재개
   (5001번째 줄부터 읽기)
   ↓
5. 이벤트 전송 계속
```

### 5.3 체크포인트 데이터 예시

**정상 진행 중**
```json
{
  "replayJobId": "replay_001",
  "csvFile": "olist_orders.csv",
  "lastLineNumber": 5000,
  "lastEventId": "uuid-5000",
  "processedLines": 5000,
  "totalLines": 99441,
  "lastProcessedAt": "2026-01-24T10:35:10Z"
}
```

**중단 후 재시작**
```
[Airflow 중단]
- lastLineNumber: 5000

[Airflow 재시작]
1. 체크포인트 조회 → 5000
2. df.iloc[5001:] 읽기
3. 5001번째 줄부터 이벤트 전송
4. 새 체크포인트: 5100 저장
```

---

## 6. 전체 시퀀스 다이어그램

### 6.1 정상 흐름 (처음부터 끝까지)

```
Airflow                Service A              PostgreSQL
   │                        │                       │
   │  1. POST /replay-jobs  │                       │
   ├───────────────────────>│                       │
   │                        │  INSERT replay_jobs   │
   │                        ├──────────────────────>│
   │  201 Created           │                       │
   │<───────────────────────┤                       │
   │                        │                       │
   │  2. POST /start        │                       │
   ├───────────────────────>│                       │
   │                        │  UPDATE replay_jobs   │
   │                        │  SET status=RUNNING   │
   │                        ├──────────────────────>│
   │  200 OK                │                       │
   │<───────────────────────┤                       │
   │                        │                       │
   │  3. POST /events (x100)│                       │
   ├───────────────────────>│                       │
   │                        │  INSERT events        │
   │                        ├──────────────────────>│
   │  201 Created           │                       │
   │<───────────────────────┤                       │
   │                        │                       │
   │  4. POST /checkpoint   │                       │
   ├───────────────────────>│                       │
   │                        │  UPSERT csv_offsets   │
   │                        ├──────────────────────>│
   │  200 OK                │                       │
   │<───────────────────────┤                       │
   │                        │                       │
   │  ... (반복)            │                       │
   │                        │                       │
   │  5. POST /complete     │                       │
   ├───────────────────────>│                       │
   │                        │  UPDATE replay_jobs   │
   │                        │  SET status=COMPLETED │
   │                        ├──────────────────────>│
   │  200 OK                │                       │
   │<───────────────────────┤                       │
```

### 6.2 중단 및 재개 흐름

```
Airflow (1차)         Service A              PostgreSQL
   │                        │                       │
   │  1. 이벤트 전송 중...  │                       │
   │  (5000개 처리)         │                       │
   │                        │                       │
   │  [중단 발생]           │                       │
   │                        │                       │
   
   
Airflow (2차)         Service A              PostgreSQL
   │                        │                       │
   │  1. GET /checkpoint    │                       │
   ├───────────────────────>│                       │
   │                        │  SELECT csv_offsets   │
   │                        ├──────────────────────>│
   │  {lastLineNumber:5000} │                       │
   │<───────────────────────┤                       │
   │                        │                       │
   │  2. POST /resume       │                       │
   ├───────────────────────>│                       │
   │                        │  UPDATE replay_jobs   │
   │                        │  SET status=RUNNING   │
   │                        ├──────────────────────>│
   │  200 OK                │                       │
   │<───────────────────────┤                       │
   │                        │                       │
   │  3. 5001번째 줄부터    │                       │
   │     이벤트 전송 재개   │                       │
   ├───────────────────────>│                       │
```

---

## 7. 성능 최적화 전략

### 7.1 배치 진행 상황 업데이트

**문제**: 매 이벤트마다 replay_jobs UPDATE → 느림

**해결**: 100개마다 한 번만 UPDATE

```python
# Airflow
batch_size = 100
processed_in_batch = 0

for index, row in df.iterrows():
    send_event(row)
    processed_in_batch += 1
    
    if processed_in_batch >= batch_size:
        update_progress(replay_id, index + 1)
        processed_in_batch = 0
```

### 7.2 비동기 체크포인트

```python
# Airflow - 별도 스레드
import threading

def async_checkpoint(replay_id, csv_file, line_number):
    threading.Thread(
        target=save_checkpoint,
        args=(replay_id, csv_file, line_number)
    ).start()

# 메인 루프
for index, row in df.iterrows():
    send_event(row)
    
    if (index + 1) % 100 == 0:
        async_checkpoint(replay_id, csv_file, index)
```

### 7.3 Connection Pool

```python
# Airflow - requests 세션 재사용
import requests

session = requests.Session()
session.headers.update({'Content-Type': 'application/json'})

for index, row in df.iterrows():
    event = create_event(row)
    session.post(f"{SERVICE_A_URL}/events", json=event)
```

---

## 8. 에러 처리 및 재시도

### 8.1 Airflow 측 재시도 로직

```python
# Airflow DAG
from airflow.exceptions import AirflowException
import time

MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds

def send_event_with_retry(event):
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                f"{SERVICE_A_URL}/events",
                json=event,
                timeout=10
            )
            response.raise_for_status()
            return response.json()
            
        except requests.exceptions.Timeout:
            if attempt == MAX_RETRIES - 1:
                raise AirflowException(f"Timeout after {MAX_RETRIES} retries")
            time.sleep(RETRY_DELAY)
            
        except requests.exceptions.HTTPError as e:
            if e.response.status_code >= 500:
                # 서버 에러 → 재시도
                if attempt == MAX_RETRIES - 1:
                    raise AirflowException(f"Server error: {e}")
                time.sleep(RETRY_DELAY)
            else:
                # 클라이언트 에러 (4xx) → 재시도 안 함
                raise AirflowException(f"Client error: {e}")
```

### 8.2 Service A 측 에러 응답

```json
// 400 Bad Request - 검증 실패
{
  "error": "ValidationError",
  "message": "Missing required field: eventType",
  "field": "eventType",
  "timestamp": "2026-01-24T10:30:45Z"
}

// 409 Conflict - 중복 리플레이 ID
{
  "error": "DuplicateReplayJob",
  "message": "Replay job with ID 'replay_001' already exists",
  "existingJobId": "replay_001",
  "timestamp": "2026-01-24T10:30:45Z"
}

// 500 Internal Server Error - DB 장애
{
  "error": "DatabaseError",
  "message": "Failed to insert event into database",
  "timestamp": "2026-01-24T10:30:45Z"
}
```

---

## 9. 모니터링 및 로깅

### 9.1 Service A 로그 포맷

```json
{
  "timestamp": "2026-01-24T10:30:45.123Z",
  "level": "INFO",
  "service": "service-a",
  "api": "/api/v1/events",
  "method": "POST",
  "replayJobId": "replay_001",
  "eventId": "uuid-001",
  "eventType": "OrderPlaced",
  "processingTime": "23ms",
  "message": "Event saved successfully"
}
```

### 9.2 Airflow 로그

```
[2026-01-24 10:30:45] INFO - Replay job replay_001 started
[2026-01-24 10:30:45] INFO - Total events to process: 99441
[2026-01-24 10:30:50] INFO - Progress: 100/99441 (0.1%)
[2026-01-24 10:31:05] INFO - Checkpoint saved: line 100
[2026-01-24 10:35:23] INFO - Progress: 5000/99441 (5.0%)
```

---

## ✅ 요약

### 두 가지 리플레이 방식

#### 방식 1: CSV 기반 (초기 개발용)
- Airflow가 CSV 파일 읽기
- API #3 (POST /events) 반복 호출
- 간단하지만 유연성 부족

#### 방식 2: DB 기반 (운영 권장) ⭐
- 초기에 API #0으로 CSV 데이터를 raw_order_data에 적재
- Service A가 DB에서 조회하여 이벤트 자동 생성
- 유연한 필터링 가능

---

### Service A가 하는 일

#### 공통
1. ✅ Replay Job 상태 관리
2. ✅ 체크포인트 저장/조회

#### CSV 방식
3. ✅ 이벤트 수신 (POST /events)
4. ✅ UUID 생성 (자동)
5. ✅ DB 저장 (events 테이블)

#### DB 방식 ⭐
3. ✅ 원본 데이터 적재 (POST /raw-data/orders/batch)
4. ✅ raw_order_data 조회
5. ✅ 이벤트 자동 생성 (내부)
6. ✅ DB 저장 (events 테이블)

---

### Service A가 하지 않는 일
1. ❌ CSV 파싱 (Airflow)
2. ❌ Kafka 발행 (Debezium이 수행)
3. ❌ 도메인 검증 (Service B가 수행)

---

### 핵심 테이블 (5개)

1. **events** - 이벤트 저장 (INSERT만)
2. **replay_jobs** - 상태 관리 (CREATED → RUNNING → COMPLETED)
3. **csv_offsets** - 체크포인트 (CSV 방식 시)
4. **raw_order_data** - 원본 데이터 저장 (DB 방식 시) ⭐ 신규
5. **event_snapshots** - 성능 최적화 (미사용)

---

### 핵심 흐름

#### CSV 방식
```
CSV → Airflow 읽기 → Service A 저장 → CDC → Kafka
```

#### DB 방식 (권장) ⭐
```
CSV → Airflow 적재 → raw_order_data 저장
                         ↓
                  Service A 조회 → events 생성 → CDC → Kafka
```

---

### 권장 구현 순서

**Week 1-2**: 
- raw_order_data 테이블 생성
- API #0 (원본 데이터 적재) 구현
- Airflow DAG `initial_data_load` 작성

**Week 3-4**:
- API #1 (Replay Job 생성) DB 방식 지원
- API #2 (Replay Job 시작) DB 기반 내부 처리
- 비동기 이벤트 생성 로직

**Week 5-6**:
- 테스트 (CSV 방식 vs DB 방식)
- 성능 최적화
- 필터링 기능 확장

---

**이제 Airflow와 Service A의 모든 동작이 완벽히 명확합니다!** 🎯

두 가지 방식 모두 지원하며, **DB 기반 방식이 운영에 더 적합**합니다!
