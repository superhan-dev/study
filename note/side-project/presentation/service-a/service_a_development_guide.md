# Service A (Data Replay Service) & Airflow 개발 가이드

이 문서는 **Service A**와 **Airflow**의 역할, 책임, 그리고 상세 구현 명세를 정의합니다. 개발팀은 이 문서를 기준으로 구현을 진행합니다.

---

## 1. Airflow DAG 상세 설계

Airflow는 **데이터의 초기 적재(Init)**와 **이벤트 리플레이(Replay)의 오케스트레이션**을 담당합니다.

### 1.1 Init DAG (초기 데이터 적재)

- **DAG ID**: `olist_init_data_load`
- **목적**: Olist CSV 데이터를 Service A의 원본 저장소(`raw_order_data`)에 적재
- **작업 순서**:
  1.  **check_data_exists**: API(`GET /count`) 호출. 데이터 존재 시 `skip_load`로 분기.
  2.  **load_csv_to_service_a**: Pandas로 CSV 로드/병합 후 API(`POST /batch`)로 전송.
  3.  **verify_data_load**: 적재 후 데이터 개수 검증.

### 1.2 Replay DAG (이벤트 리플레이)

- **DAG ID**: `olist_replay`
- **목적**: DB에 적재된 데이터를 기반으로 시뮬레이션 이벤트 스트림 생성
- **작업 순서**:
  1.  **check_init_complete**: Init 완료 여부 확인.
  2.  **create_and_start_replay**: 파라미터(기간, 배속 등)로 Job 생성 및 시작 (`POST /replay-jobs`, `POST /start`).
  3.  **monitor_replay_progress**: 주기적 폴링으로 진행률 모니터링 (`GET /replay-jobs/{id}`).

---

## 2. Server API 상세 명세

Service A는 Airflow의 제어를 받아 데이터를 관리하고 이벤트를 생성합니다.

### 2.1 원본 데이터 관리 API

#### `POST /api/v1/raw-data/orders/batch`

- **역할**: 초기 데이터 적재 (Bulk Insert)
- **영향받는 테이블**: `raw_order_data` (Create)
- **요청 (Request)**:
  ```json
  {
    "sourceFile": "olist_orders.csv",
    "orders": [
      { "orderId": "abc", "customerId": "123", ... }
    ]
  }
  ```
- **응답 (Response)**:
  ```json
  { "imported": 1000, "failed": 0, "duplicates": 0 }
  ```
- **로직 설명**:
  1.  요청받은 주문 리스트의 필수 필드 검증.
  2.  `raw_order_data` 테이블에 `ON CONFLICT DO NOTHING`으로 일괄 삽입.
  3.  결과 통계 반환.

### 2.2 Job 관리 API

#### `POST /api/v1/replay-jobs`

- **역할**: 리플레이 작업 생성
- **영향받는 테이블**: `replay_jobs` (Create)
- **요청 (Request)**:
  ```json
  {
    "sourceType": "DATABASE",
    "filter": { "startTime": "2017-01-01...", "customerState": "SP" },
    "speedMultiplier": 10.0
  }
  ```
- **응답 (Response)**:
  ```json
  { "replayJobId": "job_123", "totalEvents": 5000, "status": "CREATED" }
  ```
- **로직 설명**:
  1.  `raw_order_data`에서 필터 조건에 맞는 데이터 개수 조회 (`SELECT COUNT`).
  2.  `replay_jobs` 테이블에 Job 메타데이터 저장 (Status: `CREATED`).

#### `POST /api/v1/replay-jobs/{id}/start`

- **역할**: 리플레이 시작 (비동기 프로세스 트리거)
- **영향받는 테이블**: `replay_jobs` (Update), `events` (Create)
- **로직 설명**:
  1.  Job 상태를 `RUNNING`으로 변경.
  2.  **비동기 스레드 실행**:
      - `raw_order_data`에서 데이터를 시간순으로 스트리밍 조회.
      - 설정된 배속(`speedMultiplier`)에 맞춰 `Thread.sleep`으로 딜레이 주입.
      - `events` 테이블에 이벤트 데이터 INSERT.
      - 주기적으로 `replay_jobs`의 `processed_events` 업데이트.

---

## 3. 인프라 및 연계 상세 (Infrastructure & Integration)

### 3.1 Kafka Topic: `raw_events` (CDC)

Service A는 Kafka Producer를 직접 구현하지 않고, **Debezium CDC**를 통해 이벤트를 발행합니다.

- **토픽명**: `raw_events`
- **생성 주체**: Debezium Connector (PostgreSQL `events` 테이블 감지)
- **파티션 수**: 3
- **Replication Factor**: 3 (운영 기준), 1 (개발 기준)
- **Message Key**: `aggregate_id` (order_id)
  > ⚠️ **주의**: `event_id`가 아닌 `aggregate_id`를 Key로 사용해야 동일 주문의 이벤트가 같은 파티션으로 라우팅되어 순서가 보장됨
- **Debezium SMT 설정** (Key 추출용):
  ```json
  {
    "transforms": "extractKey",
    "transforms.extractKey.type": "org.apache.kafka.connect.transforms.ValueToKey",
    "transforms.extractKey.fields": "aggregate_id"
  }
  ```
- **Message Value**:
  ```json
  {
    "op": "c", // Create operation
    "after": {
      "event_id": "uuid-...",
      "event_type": "OrderPlaced",
      "aggregate_id": "order_123",
      "payload": "{...}", // JSON String
      "occurred_at": "2017-01-01T10:00:00Z",
      "replay_job_id": "job_123"
    }
  }
  ```

### 3.2 Service B와의 연계

- **데이터 흐름**: Service A (DB Insert) -> Debezium -> Kafka (`raw_events`) -> Service B (Consumer)
- **계약 (Contract)**: Service A는 `events` 테이블에 데이터를 넣을 때 **불변성(Immutability)**을 보장해야 하며, `payload` 내부 구조는 Service B가 기대하는 포맷을 준수해야 합니다.

---

## 4. 테이블 리스트 (Table Specification)

| 테이블명             | 역할                   | 주요 컬럼                                              | 비고                |
| :------------------- | :--------------------- | :----------------------------------------------------- | :------------------ |
| **`raw_order_data`** | CSV 원본 데이터 저장소 | `order_id`, `customer_id`, `items` (JSONB)             | 리플레이의 Source   |
| **`replay_jobs`**    | 리플레이 Job 상태 관리 | `job_id`, `status`, `filter`, `speed`                  | 상태 머신 관리      |
| **`events`**         | 이벤트 소싱 저장소     | `event_id`, `aggregate_id`, `payload`, `replay_job_id` | **CDC 대상 테이블** |
| **`csv_offsets`**    | CSV 모드용 체크포인트  | `job_id`, `file_name`, `last_line`                     | 중단 후 재개용      |

---

## 5. 기술 의사결정 및 설계 의도 (Technical Decisions)

### 5.1 왜 Kafka Producer 대신 CDC(Debezium)를 사용하는가?

- **이유**: **Dual Write 문제 해결**. 애플리케이션에서 "DB 저장"과 "Kafka 발행"을 동시에 수행할 경우, 하나만 성공하고 하나는 실패하여 데이터 불일치가 발생할 수 있습니다.
- **결정**: 트랜잭션 로그(WAL)를 읽는 CDC 방식을 사용하여, DB에 저장된 데이터는 **반드시** Kafka로 발행됨을 보장(At-least-once)합니다.

### 5.2 왜 Airflow를 사용하는가?

- **이유**: 데이터 파이프라인의 **가시성 확보**와 **재시도 메커니즘**이 필요합니다. 단순 크론잡이나 스크립트로는 대용량 데이터 처리 중 실패 지점 파악과 복구가 어렵습니다.
- **결정**: Airflow의 DAG를 통해 작업 의존성을 관리하고, 실패 시 자동 재시도 및 알림 기능을 활용합니다.

### 5.3 왜 `raw_order_data` 테이블을 따로 두는가?

- **이유**: 매번 CSV 파일을 읽는 것은 I/O 비용이 높고 필터링(예: "SP 주만 리플레이")이 어렵습니다.
- **결정**: 초기에 DB에 적재해두면 SQL을 통해 다양한 조건으로 리플레이 시나리오를 유연하게 구성할 수 있습니다.

### 5.4 왜 Thread.sleep 대신 RateLimiter를 사용하는가?

- **이유**: Replay는 단순한 지연 실행이 아니라 시스템 처리량(Throughput)을 제어하는 작업입니다.
  Thread.sleep 기반 구현은 GC, DB 지연, OS 스케줄링 등의 영향을 받아 실제 이벤트 처리 속도가 불안정해지며,
  pause/resume 시 이벤트 폭주(burst)나 처리량 붕괴가 발생할 수 있습니다. 이는 대량 이벤트 리플레이 환경에서
  시스템 과부하와 데이터 불일치를 유발할 위험이 있습니다.

- **결정**: Guava RateLimiter를 사용하여 **초당 허용 이벤트 수(permits per second)**를 명시적으로 제한합니다.
  이를 통해 Replay 속도를 “시간 기반 지연”이 아닌 처리량 기반 제어로 전환하고,
  시스템 부하 변화(DB latency, GC 등)에 자연스럽게 적응하도록 설계했습니다.
  또한 RateLimiter는 내부적으로 공정성(fairness)을 보장하므로 pause/resume 시에도 이벤트 burst 없이
  안정적으로 Replay를 재개할 수 있습니다.

- **효과**:
  - Replay 속도의 예측 가능성 확보
  - 시스템 부하에 따른 자동 완화(back-pressure 효과)
  - 대규모 리플레이 시 DB/Kafka 과부하 방지
  - 향후 멀티 노드 확장 시에도 일관된 처리량 제어 가능

### 5.5 왜 Replay는 단일 스레드 / 파티션 기준으로 동작하는가?

- **이유**: Replay는 단순 배치 처리(batch processing)가 아니라,
  도메인 이벤트의 시간 순서와 인과 관계를 재현하는 시뮬레이션입니다.
  동일 Aggregate(예: order_id)에 대한 이벤트는 반드시 순차적으로 처리되어야 하며,
  병렬 처리는 상태 불일치나 Lost Update를 유발할 수 있습니다.

- **결정**: Replay 실행은 **Aggregate ID 기준으로 단일 실행 흐름(single-threaded stream)**을 유지하도록 설계했습니다.
  이는 Kafka 파티션의 순서 보장 모델과 일관되며,
  이후 Debezium → Kafka → Service B로 이어지는 전체 파이프라인에서
  이벤트 순서 보장을 자연스럽게 유지할 수 있습니다.

- **트레이드오프**:
  - 처리량은 낮아질 수 있음
  - 그러나 Replay의 목적은 “최대 속도”가 아니라 정확한 과거 재현성(Replayability)

- **효과**:
  - Aggregate 상태 일관성 보장
  - 낙관적 락 충돌 최소화
  - 재시작 및 디버깅 용이

> Replay는 병렬 컴퓨팅 문제가 아니라 시간을 되감는 문제이기 때문에,
> 순서를 희생한 병렬성은 허용하지 않습니다.

---

## 6. Replay Job 상태 머신 (State Machine)

### 6.1 상태 정의

| 상태        | 설명                        | 허용되는 전이                     |
| :---------- | :-------------------------- | :-------------------------------- |
| `CREATED`   | Job 생성 완료, 시작 대기 중 | → `RUNNING`, `CANCELLED`          |
| `RUNNING`   | 이벤트 리플레이 진행 중     | → `PAUSED`, `COMPLETED`, `FAILED` |
| `PAUSED`    | 일시 중지됨 (재개 가능)     | → `RUNNING`, `CANCELLED`          |
| `COMPLETED` | 모든 이벤트 처리 완료       | (최종 상태)                       |
| `FAILED`    | 오류로 인한 실패            | → `CREATED` (재시도 시)           |
| `CANCELLED` | 사용자에 의한 취소          | (최종 상태)                       |

### 6.2 상태 전이 다이어그램

```
                    ┌─────────────────────────────────────┐
                    │                                     │
                    ▼                                     │
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌───────────┐
│ CREATED │───▶│ RUNNING │───▶│ PAUSED  │───▶│ CANCELLED │
└─────────┘    └─────────┘    └─────────┘    └───────────┘
     │              │              │
     │              │              │
     │              ▼              │
     │         ┌─────────┐        │
     │         │COMPLETED│        │
     │         └─────────┘        │
     │              │              │
     │              ▼              │
     │         ┌─────────┐        │
     └────────▶│ FAILED  │◀───────┘
               └─────────┘
                    │
                    │ (retry)
                    ▼
               ┌─────────┐
               │ CREATED │
               └─────────┘
```

### 6.3 상태 전이 API 매핑

| 현재 상태           | API Endpoint                    | 결과 상태   |
| :------------------ | :------------------------------ | :---------- |
| `CREATED`           | `POST /replay-jobs/{id}/start`  | `RUNNING`   |
| `RUNNING`           | `POST /replay-jobs/{id}/pause`  | `PAUSED`    |
| `PAUSED`            | `POST /replay-jobs/{id}/resume` | `RUNNING`   |
| `RUNNING`, `PAUSED` | `POST /replay-jobs/{id}/cancel` | `CANCELLED` |
| `CREATED`           | `DELETE /replay-jobs/{id}`      | `CANCELLED` |
| `FAILED`            | `POST /replay-jobs/{id}/retry`  | `CREATED`   |

### 6.4 동시 실행 제약 (Critical)

> ⚠️ **반드시 구현 필요**: 동시에 여러 Replay Job이 실행되면 이벤트 순서가 보장되지 않음

**DB 레벨 제약**:

```sql
-- 활성 상태 Job은 최대 1개만 허용
CREATE UNIQUE INDEX idx_replay_jobs_active_singleton
ON replay_jobs ((1))
WHERE status IN ('CREATED', 'RUNNING', 'PAUSED');
```

**API 레벨 검증**:

```java
@Transactional
public ReplayJob createReplayJob(CreateReplayJobRequest request) {
    // Advisory Lock으로 동시 생성 방지
    jdbcTemplate.execute("SELECT pg_advisory_xact_lock(hashtext('replay_job_create'))");

    long activeCount = replayJobRepository.countByStatusIn(
        List.of(Status.CREATED, Status.RUNNING, Status.PAUSED)
    );
    if (activeCount > 0) {
        throw new ConflictException("Active replay job already exists");
    }
    // ... 생성 로직
}
```

**HTTP 응답**:

```
POST /api/v1/replay-jobs
→ 409 Conflict: {"error": "ACTIVE_JOB_EXISTS", "activeJobId": "job_456"}
```

---

## 7. 이벤트 생성 규칙 (Event Generation Rules)

### 7.1 이벤트 생성 기준표

> ⚠️ **명확한 규칙**: 이벤트는 **타임스탬프 컬럼의 존재 여부**로 생성 결정됨

| 조건 (raw_order_data 컬럼)                  | 생성되는 이벤트  | occurred_at 값                        |
| :------------------------------------------ | :--------------- | :------------------------------------ |
| `order_purchase_timestamp IS NOT NULL`      | `OrderPlaced`    | `order_purchase_timestamp`            |
| `order_approved_at IS NOT NULL`             | `OrderApproved`  | `order_approved_at`                   |
| `order_delivered_carrier_date IS NOT NULL`  | `OrderShipped`   | `order_delivered_carrier_date`        |
| `order_delivered_customer_date IS NOT NULL` | `OrderDelivered` | `order_delivered_customer_date`       |
| `order_status = 'canceled'`                 | `OrderCancelled` | `order_purchase_timestamp` (fallback) |

### 7.2 이벤트 생성 순서

하나의 주문에서 여러 이벤트가 생성될 때 **반드시 시간순으로 정렬**:

```sql
-- Replay 시 이벤트 생성 쿼리
WITH order_events AS (
    SELECT
        order_id,
        'OrderPlaced' as event_type,
        order_purchase_timestamp as occurred_at
    FROM raw_order_data WHERE order_purchase_timestamp IS NOT NULL

    UNION ALL

    SELECT
        order_id,
        'OrderApproved',
        order_approved_at
    FROM raw_order_data WHERE order_approved_at IS NOT NULL

    UNION ALL

    SELECT
        order_id,
        'OrderShipped',
        order_delivered_carrier_date
    FROM raw_order_data WHERE order_delivered_carrier_date IS NOT NULL

    UNION ALL

    SELECT
        order_id,
        'OrderDelivered',
        order_delivered_customer_date
    FROM raw_order_data WHERE order_delivered_customer_date IS NOT NULL
)
SELECT * FROM order_events
ORDER BY occurred_at ASC;  -- 전역 시간순 정렬
```

### 7.3 이벤트 생성 예시

**입력 데이터** (`raw_order_data` 1건):

```json
{
  "order_id": "abc123",
  "order_purchase_timestamp": "2017-01-01T10:00:00Z",
  "order_approved_at": "2017-01-01T10:05:00Z",
  "order_delivered_carrier_date": "2017-01-03T14:00:00Z",
  "order_delivered_customer_date": "2017-01-05T09:30:00Z",
  "order_status": "delivered"
}
```

**생성되는 이벤트** (4건, 시간순):

1. `OrderPlaced` @ `2017-01-01T10:00:00Z`
2. `OrderApproved` @ `2017-01-01T10:05:00Z`
3. `OrderShipped` @ `2017-01-03T14:00:00Z`
4. `OrderDelivered` @ `2017-01-05T09:30:00Z`

---

## 8. Event Payload JSON Schema

### 8.1 Base Event Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": [
    "eventId",
    "eventType",
    "aggregateId",
    "aggregateType",
    "occurredAt",
    "schemaVersion"
  ],
  "properties": {
    "eventId": {
      "type": "string",
      "format": "uuid",
      "description": "이벤트 고유 식별자 (Idempotency Key)"
    },
    "eventType": {
      "type": "string",
      "enum": [
        "OrderPlaced",
        "OrderApproved",
        "OrderShipped",
        "OrderDelivered",
        "OrderCancelled"
      ]
    },
    "aggregateId": {
      "type": "string",
      "description": "집계 루트 ID (order_id) - Kafka 파티션 키로도 사용됨"
    },
    "aggregateType": {
      "type": "string",
      "const": "Order"
    },
    "occurredAt": {
      "type": "string",
      "format": "date-time",
      "description": "원본 이벤트 발생 시각 (리플레이 시각 아님)"
    },
    "schemaVersion": {
      "type": "integer",
      "minimum": 1,
      "description": "페이로드 스키마 버전 (하위 호환성 관리용)"
    },
    "replayJobId": {
      "type": ["string", "null"],
      "description": "리플레이 Job ID"
    },
    "payload": {
      "type": "object",
      "description": "이벤트 타입별 상세 데이터"
    }
  }
}
```

> ⚠️ **schemaVersion vs eventSequence 구분**
>
> - `schemaVersion`: 페이로드 구조 변경 시 증가 (1 → 2 → 3)
> - `eventSequence`: 해당 aggregate 내 이벤트 순번 (별도 필드로 필요시 추가)

### 8.2 Event Type별 Payload

#### OrderPlaced

```json
{
  "orderId": "abc123",
  "customerId": "cust_456",
  "purchaseTimestamp": "2017-01-01T10:00:00Z",
  "items": [
    {
      "orderItemId": 1,
      "productId": "prod_789",
      "sellerId": "seller_012",
      "price": 99.99,
      "freightValue": 15.5,
      "quantity": 1
    }
  ],
  "payment": {
    "paymentType": "credit_card",
    "paymentInstallments": 3,
    "paymentValue": 115.49
  },
  "customer": {
    "customerCity": "sao paulo",
    "customerState": "SP"
  }
}
```

#### OrderApproved

```json
{
  "orderId": "abc123",
  "approvedAt": "2017-01-01T10:05:00Z"
}
```

#### OrderShipped

```json
{
  "orderId": "abc123",
  "shippedAt": "2017-01-03T14:00:00Z",
  "estimatedDeliveryDate": "2017-01-10"
}
```

#### OrderDelivered

```json
{
  "orderId": "abc123",
  "deliveredAt": "2017-01-05T09:30:00Z"
}
```

#### OrderCancelled

```json
{
  "orderId": "abc123",
  "cancelledAt": "2017-01-02T08:00:00Z",
  "reason": "customer_request"
}
```

---

## 9. 중복 이벤트 처리 정책 (Idempotency)

### 9.1 중복 발생 시나리오

| 시나리오        | 발생 위치        | 원인                                     |
| :-------------- | :--------------- | :--------------------------------------- |
| CDC 재전송      | Debezium → Kafka | Connector 재시작, at-least-once 보장     |
| Replay 재시작   | Service A        | FAILED → retry 시 체크포인트 이전 이벤트 |
| Consumer 재처리 | Service B        | offset commit 실패 후 재시작             |

### 9.2 Service A 책임 (Producer 측)

#### events 테이블 Unique Constraint

```sql
-- 동일 Job 내에서 동일 aggregate + 이벤트 타입 + 발생 시각 조합은 유일
CREATE UNIQUE INDEX idx_events_idempotency
ON events (replay_job_id, aggregate_id, event_type, occurred_at);
```

#### event_id 생성 규칙 (Deterministic)

```java
// 재시도해도 동일한 event_id 생성
public String generateEventId(String replayJobId, String aggregateId,
                               String eventType, Instant occurredAt) {
    String seed = String.format("%s:%s:%s:%s",
        replayJobId, aggregateId, eventType, occurredAt.toString());
    return UUID.nameUUIDFromBytes(seed.getBytes(StandardCharsets.UTF_8)).toString();
}
```

#### INSERT 전략

```sql
INSERT INTO events (event_id, aggregate_id, event_type, payload, occurred_at, replay_job_id)
VALUES (...)
ON CONFLICT (replay_job_id, aggregate_id, event_type, occurred_at) DO NOTHING
RETURNING event_id;

-- RETURNING이 없으면 이미 존재하는 이벤트 → 스킵
```

### 9.3 Service B 책임 (Consumer 측)

> **명시적 계약**: Service A는 중복 INSERT를 방지하지만, CDC의 at-least-once 특성상 Kafka에 동일 메시지가 중복 발행될 수 있음. **Service B는 event_id 기반 멱등성 처리 필수**.

```java
// Service B Consumer 예시
@KafkaListener(topics = "raw_events")
public void handleEvent(ConsumerRecord<String, String> record) {
    Event event = parse(record.value());

    // Idempotency check
    if (processedEventRepository.existsById(event.getEventId())) {
        log.info("Duplicate event skipped: {}", event.getEventId());
        return;
    }

    // Process event...
    processedEventRepository.save(new ProcessedEvent(event.getEventId()));
}
```

---

## 10. raw_order_data 컬럼 ↔ CSV 매핑

### 10.1 테이블 스키마

```sql
CREATE TABLE raw_order_data (
    -- PK
    order_id                    VARCHAR(32) PRIMARY KEY,

    -- From: olist_orders_dataset.csv
    customer_id                 VARCHAR(32) NOT NULL,
    order_status                VARCHAR(20) NOT NULL,
    order_purchase_timestamp    TIMESTAMP NOT NULL,
    order_approved_at           TIMESTAMP,
    order_delivered_carrier_date TIMESTAMP,
    order_delivered_customer_date TIMESTAMP,
    order_estimated_delivery_date DATE,

    -- From: olist_customers_dataset.csv (JOIN on customer_id)
    customer_unique_id          VARCHAR(32),
    customer_zip_code_prefix    VARCHAR(5),
    customer_city               VARCHAR(100),
    customer_state              CHAR(2),

    -- From: olist_order_items_dataset.csv (Aggregated)
    items                       JSONB NOT NULL DEFAULT '[]',

    -- From: olist_order_payments_dataset.csv (Aggregated)
    payments                    JSONB NOT NULL DEFAULT '[]',

    -- Computed
    total_items                 INTEGER GENERATED ALWAYS AS (jsonb_array_length(items)) STORED,
    total_amount                NUMERIC(12,2),
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_raw_order_purchase_time ON raw_order_data(order_purchase_timestamp);
CREATE INDEX idx_raw_order_customer_state ON raw_order_data(customer_state);
CREATE INDEX idx_raw_order_status ON raw_order_data(order_status);
```

### 10.2 CSV → 컬럼 매핑

| 테이블 컬럼                | Source CSV  | CSV 컬럼                   | 변환                            |
| :------------------------- | :---------- | :------------------------- | :------------------------------ |
| `order_id`                 | orders      | `order_id`                 | 그대로                          |
| `customer_id`              | orders      | `customer_id`              | 그대로                          |
| `order_status`             | orders      | `order_status`             | lowercase                       |
| `order_purchase_timestamp` | orders      | `order_purchase_timestamp` | ISO 8601 파싱                   |
| `customer_city`            | customers   | `customer_city`            | JOIN (customer_id)              |
| `customer_state`           | customers   | `customer_state`           | JOIN, uppercase 2자             |
| `items`                    | order_items | \*                         | GROUP BY order_id → JSONB array |
| `payments`                 | payments    | \*                         | GROUP BY order_id → JSONB array |
| `total_amount`             | payments    | `payment_value`            | SUM                             |

### 10.3 items JSONB 구조

```json
[
  {
    "order_item_id": 1,
    "product_id": "prod_123",
    "seller_id": "seller_456",
    "shipping_limit_date": "2017-01-10T00:00:00Z",
    "price": 99.99,
    "freight_value": 15.5
  }
]
```

---

## 11. Airflow DAG 운영 파라미터

### 11.1 Init DAG (`olist_init_data_load`)

| 파라미터              | 타입   | 기본값                     | 설명                       |
| :-------------------- | :----- | :------------------------- | :------------------------- |
| `csv_base_path`       | string | `/opt/airflow/data/olist/` | CSV 디렉토리               |
| `batch_size`          | int    | `5000`                     | API 호출당 레코드 수       |
| `max_retries`         | int    | `3`                        | API 실패 시 재시도         |
| `retry_delay_seconds` | int    | `30`                       | 재시도 대기                |
| `service_a_base_url`  | string | `http://service-a:8080`    | API 주소                   |
| `force_reload`        | bool   | `false`                    | 기존 데이터 삭제 후 재적재 |

### 11.2 Replay DAG (`olist_replay`)

| 파라미터                   | 타입   | 기본값       | 설명             |
| :------------------------- | :----- | :----------- | :--------------- |
| `replay_start_date`        | string | `2017-01-01` | 시작 날짜        |
| `replay_end_date`          | string | `2018-12-31` | 종료 날짜        |
| `speed_multiplier`         | float  | `10.0`       | 배속             |
| `customer_state_filter`    | string | `null`       | 주(State) 필터   |
| `polling_interval_seconds` | int    | `60`         | 진행률 폴링 주기 |
| `timeout_hours`            | float  | `24.0`       | 최대 실행 시간   |

### 11.3 DAG 기본 설정

```python
default_args = {
    'owner': 'data-platform',
    'retries': 2,
    'retry_delay': timedelta(minutes=5),
    'execution_timeout': timedelta(hours=6),
}

dag_init = DAG(
    'olist_init_data_load',
    schedule_interval=None,  # 수동 트리거
    max_active_runs=1,
    catchup=False,
)

dag_replay = DAG(
    'olist_replay',
    schedule_interval=None,
    max_active_runs=1,
    catchup=False,
)
```

---

## 12. Replay 재시작/중단 정책

### 12.1 체크포인트 구조

```sql
ALTER TABLE replay_jobs ADD COLUMN checkpoint JSONB DEFAULT '{}';

-- 체크포인트 예시
{
    "last_processed_order_id": "abc123",
    "last_occurred_at": "2017-06-15T10:30:00Z",
    "processed_count": 45000,
    "failed_order_ids": ["xyz789"],
    "updated_at": "2024-01-15T10:30:00Z"
}
```

### 12.2 Retry 시 이벤트 재생성 방지

```sql
-- Retry 시작 쿼리: 이미 생성된 이벤트는 스킵
SELECT * FROM raw_order_data r
WHERE r.order_purchase_timestamp >= :filter_start
  AND r.order_purchase_timestamp <= :filter_end
  AND NOT EXISTS (
      SELECT 1 FROM events e
      WHERE e.aggregate_id = r.order_id
        AND e.replay_job_id = :job_id
  )
ORDER BY r.order_purchase_timestamp ASC;
```

### 12.3 Replay 속도 제어 (Rate Limiter)

> ⚠️ **Thread.sleep 대신 RateLimiter 사용**

```java
// Guava RateLimiter 기반 구현
public class ReplayEventEmitter {
    private RateLimiter rateLimiter;

    public void start(double speedMultiplier, int baseEventsPerSecond) {
        // 10배속이면 초당 처리량 10배
        double permitsPerSecond = baseEventsPerSecond * speedMultiplier;
        this.rateLimiter = RateLimiter.create(permitsPerSecond);
    }

    public void emit(Event event) {
        rateLimiter.acquire();  // blocking but fair
        eventRepository.save(event);
    }

    public void pause() {
        // RateLimiter는 상태 유지, 재개 시 자연스럽게 이어감
    }
}
```

### 12.4 실패 책임 분리

| 실패 유형                    | 책임      | 재시도 주체 | 재시도 방식              |
| :--------------------------- | :-------- | :---------- | :----------------------- |
| Init API 호출 실패           | Airflow   | Airflow     | Task 레벨 retry          |
| Replay Job 생성 실패         | Airflow   | Airflow     | Task 레벨 retry          |
| Replay 실행 중 DB 오류       | Service A | Service A   | 내부 exponential backoff |
| Replay 실행 중 OOM           | Service A | **수동**    | 배치 크기 조정 후 retry  |
| Airflow ↔ Service A 타임아웃 | Airflow   | Airflow     | polling 재시도 (조회만)  |

> ⚠️ **원칙**: Airflow는 오케스트레이션만. Replay 로직 실패 판단 및 재시도는 Service A 단독 책임.

---

## 13. events 테이블 불변성 보장

### 13.1 DB 레벨 제약

```sql
-- 애플리케이션 사용자에게 UPDATE/DELETE 권한 박탈
REVOKE UPDATE, DELETE ON events FROM app_user;

-- 감사용 트리거 (선택)
CREATE OR REPLACE FUNCTION prevent_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Events table is immutable. Operation % not allowed.', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_events_immutable
BEFORE UPDATE OR DELETE ON events
FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();
```

### 13.2 애플리케이션 레벨

```java
@Entity
@Table(name = "events")
@Immutable  // Hibernate: UPDATE 쿼리 생성 방지
public class Event {
    // ...
}
```

---

## 14. Service B 계약 및 오류 처리

### 14.1 Payload 검증 책임

| 검증 항목      | 책임      | 실패 시 처리                              |
| :------------- | :-------- | :---------------------------------------- |
| 필수 필드 존재 | Service A | INSERT 전 validation, 실패 시 로그 + 스킵 |
| 데이터 타입    | Service A | 변환 실패 시 로그 + 스킵                  |
| 비즈니스 규칙  | Service B | Poison Event로 분류, DLQ 이동             |

### 14.2 Poison Event 처리 (Service B 책임)

```java
// Service B Consumer
@KafkaListener(topics = "raw_events")
public void handleEvent(ConsumerRecord<String, String> record) {
    try {
        Event event = parse(record.value());
        process(event);
    } catch (ValidationException e) {
        // Poison event → DLQ
        kafkaTemplate.send("raw_events.dlq", record.key(), record.value());
        poisonEventCounter.increment();
        log.error("Poison event: {}", record.value(), e);
    }
}
```

### 14.3 Service A Pre-validation (Optional)

```java
// 생성 전 샘플 검증 (선택 기능)
@PostMapping("/api/v1/replay-jobs/{id}/validate")
public ValidationResult validatePayloads(@PathVariable String id,
                                          @RequestParam int sampleSize) {
    List<Event> samples = generateSampleEvents(id, sampleSize);
    List<String> errors = schemaValidator.validate(samples);
    return new ValidationResult(errors.isEmpty(), errors);
}
```

---

## 15. 보안 및 접근 제어

### 15.1 API 인증/인가

| Endpoint                        | 필요 권한        | 비고          |
| :------------------------------ | :--------------- | :------------ |
| `GET /api/v1/replay-jobs`       | `replay:read`    | 조회          |
| `POST /api/v1/replay-jobs`      | `replay:write`   | 생성          |
| `POST /replay-jobs/{id}/start`  | `replay:execute` | 실행          |
| `POST /replay-jobs/{id}/cancel` | `replay:admin`   | 취소 (파괴적) |
| `POST /replay-jobs/{id}/retry`  | `replay:admin`   | 재시도        |
| `DELETE /replay-jobs/{id}`      | `replay:admin`   | 삭제          |

### 15.2 Airflow Service Account

```yaml
# Kubernetes ServiceAccount + RBAC
apiVersion: v1
kind: ServiceAccount
metadata:
  name: airflow-service-a
---
# Service A에서 Airflow 전용 API Key 검증
apiVersion: v1
kind: Secret
metadata:
  name: service-a-api-key
data:
  api-key: base64-encoded-key
```

### 15.3 감사 로그

```sql
CREATE TABLE replay_audit_log (
    id              SERIAL PRIMARY KEY,
    job_id          VARCHAR(36),
    action          VARCHAR(20),  -- CREATE, START, PAUSE, CANCEL, RETRY
    actor           VARCHAR(100), -- 사용자 또는 서비스 계정
    ip_address      INET,
    occurred_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    details         JSONB
);
```
