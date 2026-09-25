# Phase 2: MSA 기반 Event-Driven 아키텍처 상세 기획서

## 이벤트 리플레이 시스템 구현

---

## 📋 문서 개요

### Phase 2 목표

1. **단일 서비스(Phase 1)를 3개의 마이크로서비스로 분리**
2. **Event Sourcing + CQRS 패턴 구현**
3. **과거 데이터 리플레이 시스템 구축** (시간 여행 시뮬레이션)
4. **실시간 모니터링 및 관측 가능성(Observability) 확보**

### 핵심 컨셉

```
"과거 100만 건의 주문을 현재 시점에 빠르게 재생하면서,
만약 재고 관리 시스템이 있었다면 어떻게 달라졌을지 실시간으로 관찰한다"
```

---

## 🏗️ 전체 시스템 아키텍처

### MSA 구조 (3개 서비스)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              External Systems                                │
│  ┌──────────────┐     ┌──────────────┐      ┌──────────────┐               │
│  │  Grafana     │     │   Admin UI   │      │  API Client  │               │
│  │  Dashboard   │     │  (Optional)  │      │  (Future)    │               │
│  └──────┬───────┘     └──────┬───────┘      └──────┬───────┘               │
└─────────┼──────────────────────┼──────────────────────┼──────────────────────┘
          │                      │                      │
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          API Gateway (Optional)                              │
│                        Spring Cloud Gateway                                  │
└─────────────────────────────────────────────────────────────────────────────┘
          │                      │                      │
          │                      │                      │
    ┌─────▼─────┐          ┌────▼─────┐          ┌────▼─────┐
    │           │          │          │          │          │
┌───▼──────────────────┐ ┌▼─────────────────┐ ┌▼─────────────────┐
│   Service A          │ │   Service B      │ │   Service C      │
│   Event Replay       │ │   Command        │ │   Query          │
│   (Read Service)     │ │   (Domain)       │ │   (Analytics)    │
│                      │ │                  │ │                  │
│  ┌────────────────┐ │ │  ┌────────────┐ │ │  ┌────────────┐ │
│  │ Airflow        │ │ │  │ Domain     │ │ │  │ Projection │ │
│  │ (Scheduler)    │ │ │  │ Validation │ │ │  │ Engine     │ │
│  └────────────────┘ │ │  └────────────┘ │ │  └────────────┘ │
│                      │ │                  │ │                  │
│  ┌────────────────┐ │ │  ┌────────────┐ │ │  ┌────────────┐ │
│  │ Event API      │ │ │  │ Inventory  │ │ │  │ Statistics │ │
│  │ (REST)         │ │ │  │ Manager    │ │ │  │ Aggregator │ │
│  └────────────────┘ │ │  └────────────┘ │ │  └────────────┘ │
│                      │ │                  │ │                  │
│  ┌────────────────┐ │ │  ┌────────────┐ │ │  ┌────────────┐ │
│  │ CSV Processor  │ │ │  │ Outbox     │ │ │  │ Read API   │ │
│  │                │ │ │  │ Publisher  │ │ │  │            │ │
│  └────────────────┘ │ │  └────────────┘ │ │  └────────────┘ │
└──────────┬──────────┘ └──────────┬──────┘ └──────────┬──────┘
           │                       │                    │
           │                       │                    │
           ▼                       ▼                    ▼
┌──────────────────┐    ┌─────────────────┐   ┌─────────────────┐
│  PostgreSQL A    │    │  PostgreSQL B   │   │  PostgreSQL C   │
│  (Event Store)   │    │  (Command DB)   │   │  (Query DB)     │
│                  │    │                 │   │                 │
│  - events        │    │  - aggregates   │   │  - projections  │
│  - replay_jobs   │    │  - inventory    │   │  - statistics   │
│  - csv_offsets   │    │  - outbox       │   │  - dashboards   │
└──────────┬───────┘    └─────────┬───────┘   └─────────────────┘
           │                      │
           │                      │
           │  ┌───────────────────┴───────────────────┐
           │  │                                        │
           ▼  ▼                                        ▼
    ┌──────────────────────────────────┐    ┌─────────────────┐
    │        Debezium CDC              │    │                 │
    │    (Change Data Capture)         │    │  Direct Publish │
    │                                  │    │  (from Outbox)  │
    └────────────────┬─────────────────┘    └────────┬────────┘
                     │                               │
                     │                               │
                     ▼                               ▼
         ┌────────────────────────────────────────────────┐
         │              Kafka Cluster                      │
         │                                                 │
         │  Topic: raw_events     (Service A → Service B) │
         │  Topic: domain_events  (Service B → Service C) │
         │  Topic: replay_control (Replay 제어)           │
         │                                                 │
         └─────────────────────────────────────────────────┘
                     │                               │
                     │                               │
         ┌───────────┴───────────┐       ┌───────────▼───────────┐
         │                       │       │                       │
         ▼                       ▼       ▼                       ▼
   Service B                Service C   Service C          Service C
   (Consumer)              (Consumer)   (Consumer)         (Consumer)
```

---

## 🎭 Airflow의 역할 (CSV Replay Orchestrator)

### 1. Airflow는 Service A의 **외부 클라이언트**입니다

```
┌────────────────────────────────────────┐
│         Airflow (외부 시스템)           │
│                                        │
│  - CSV 파일 읽기                       │
│  - 이벤트 변환                         │
│  - 속도 제어 (time.sleep)              │
│  - Service A API 호출                  │
└────────────┬───────────────────────────┘
             │ HTTP
             │
             ▼
┌────────────────────────────────────────┐
│         Service A (Spring Boot)        │
│                                        │
│  - Event API (POST /api/v1/events)    │
│  - Replay Job API                      │
│  - 상태 관리                           │
└────────────────────────────────────────┘
```

---

### 2. Airflow DAG 구조 예시

```python
from airflow import DAG
from airflow.operators.python import PythonOperator
import pandas as pd
import requests
import time
from datetime import datetime, timedelta

def replay_csv_to_service_a(**context):
    """CSV를 읽어서 Service A로 전송"""

    # 1. Replay Job 생성
    replay_job_id = f"replay_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    requests.post("http://service-a:8080/api/v1/replay-jobs", json={
        "replayJobId": replay_job_id,
        "status": "RUNNING"
    })

    # 2. CSV 파일 읽기
    df = pd.read_csv("/data/olist_orders.csv")
    df = df.sort_values("order_purchase_timestamp")

    total_rows = len(df)
    processed = 0

    # 3. 각 행을 이벤트로 변환하여 전송
    for index, row in df.iterrows():
        event = {
            "eventType": "OrderPlaced",
            "aggregateId": row["order_id"],
            "payload": {
                "customerId": row["customer_id"],
                "orderStatus": row["order_status"],
                "purchaseTimestamp": row["order_purchase_timestamp"]
            },
            "occurredAt": row["order_purchase_timestamp"],
            "replayJobId": replay_job_id
        }

        # 4. Service A에 이벤트 전송
        response = requests.post(
            "http://service-a:8080/api/v1/events",
            json=event
        )

        if response.status_code != 201:
            raise Exception(f"Failed to send event: {response.text}")

        processed += 1

        # 5. 속도 제어 (10배속 = 0.1초 대기)
        time.sleep(0.1)

        # 6. 진행 상황 업데이트 (100개마다)
        if processed % 100 == 0:
            requests.put(
                f"http://service-a:8080/api/v1/replay-jobs/{replay_job_id}",
                json={"processedEvents": processed}
            )

    # 7. 완료 표시
    requests.put(
        f"http://service-a:8080/api/v1/replay-jobs/{replay_job_id}",
        json={"status": "COMPLETED", "processedEvents": total_rows}
    )

# DAG 정의
dag = DAG(
    "olist_replay_dag",
    schedule_interval=None,  # 수동 실행
    start_date=datetime(2026, 1, 1),
)

replay_task = PythonOperator(
    task_id="replay_orders",
    python_callable=replay_csv_to_service_a,
    dag=dag,
)
```

---

### 3. 왜 Airflow를 사용하나?

| 기능          | Airflow             | Service A 내장 시      |
| ------------- | ------------------- | ---------------------- |
| **CSV 파싱**  | ✅ Pandas 활용      | ❌ 복잡한 파싱 로직    |
| **속도 제어** | ✅ `time.sleep()`   | ❌ 비동기 복잡도 증가  |
| **중단/재개** | ✅ Task 재시작      | ❌ 상태 관리 복잡      |
| **스케줄링**  | ✅ Cron 표현식      | ❌ Quartz 등 추가 필요 |
| **모니터링**  | ✅ Web UI 기본 제공 | ❌ 별도 구현 필요      |
| **재시도**    | ✅ `retries=3`      | ❌ 수동 구현           |

---

### 4. Service A가 제공하는 API

#### 4.1. Event 저장 API

```http
POST /api/v1/events

Request:
{
  "eventType": "OrderPlaced",
  "aggregateId": "order_abc123",
  "payload": {
    "customerId": "customer_456",
    "sellerId": "seller_789",
    "productId": "product_001",
    "quantity": 2,
    "price": 149.90
  },
  "occurredAt": "2017-05-13T14:23:11Z",
  "replayJobId": "replay_20260124_103000"
}

Response: 201 Created
{
  "eventId": "uuid-12345",
  "status": "SAVED",
  "message": "Event saved successfully"
}
```

---

#### 4.2. Replay Job 생성 API

```http
POST /api/v1/replay-jobs

Request:
{
  "replayJobId": "replay_20260124_103000",
  "totalEvents": 100000,
  "status": "RUNNING"
}

Response: 201 Created
{
  "replayJobId": "replay_20260124_103000",
  "status": "RUNNING",
  "createdAt": "2026-01-24T10:30:00Z"
}
```

---

#### 4.3. 진행 상황 업데이트 API

```http
PUT /api/v1/replay-jobs/{replayJobId}

Request:
{
  "processedEvents": 45000,
  "lastProcessedAt": "2026-01-24T10:35:23Z"
}

Response: 200 OK
{
  "replayJobId": "replay_20260124_103000",
  "progress": 45.0,
  "status": "RUNNING"
}
```

---

#### 4.4. Replay Job 제어 API

```http
POST /api/v1/replay-jobs/{replayJobId}/pause
POST /api/v1/replay-jobs/{replayJobId}/resume
POST /api/v1/replay-jobs/{replayJobId}/cancel

Response: 200 OK
{
  "replayJobId": "replay_20260124_103000",
  "status": "PAUSED",
  "message": "Replay paused successfully"
}
```

---

### 5. csv_offsets 테이블의 용도

**문제**: Airflow DAG가 중간에 실패하면 어디서부터 재시작?

**해결책**: csv_offsets 테이블

```sql
-- Airflow가 100개 처리할 때마다 호출
PUT /api/v1/replay-jobs/{replayJobId}/checkpoint

Request:
{
  "csvFile": "olist_orders.csv",
  "lastLineNumber": 45000,
  "lastEventId": "uuid-45000"
}

-- Service A가 csv_offsets 테이블에 저장
INSERT INTO csv_offsets (replay_job_id, csv_file, last_line_number)
VALUES ('replay_20260124_103000', 'olist_orders.csv', 45000)
ON CONFLICT (replay_job_id, csv_file)
DO UPDATE SET last_line_number = 45000;
```

**재시작 시**:

```python
# Airflow DAG에서 체크포인트 조회
response = requests.get(
    f"http://service-a:8080/api/v1/replay-jobs/{replay_job_id}/checkpoint"
)
last_line = response.json().get("lastLineNumber", 0)

# 해당 줄부터 재개
df = pd.read_csv("/data/olist_orders.csv", skiprows=range(1, last_line))
```

---

## 🗄️ 데이터베이스 분리 전략

### DB 분리 원칙

1. **각 서비스는 독립된 DB 소유**
2. **서비스 간 직접 DB 접근 금지** (API 또는 이벤트로만 통신)
3. **이벤트를 통한 데이터 동기화**

---

### Database A: Event Store (Service A 전용)

**역할**: 모든 이벤트의 원천 저장소 (Single Source of Truth)

**Service A의 책임**:

1. **Event API 제공**: Airflow가 CSV를 읽어서 보낸 이벤트를 저장
2. **Replay Job 관리**: 리플레이 생성/시작/중지/재개 API
3. **진행 상황 추적**: 현재 몇 개 처리했는지 상태 업데이트

**중요**: Service A는 CSV를 직접 읽지 않습니다. Airflow가 읽어서 API로 전송합니다.

**테이블 목록**:

#### 1. `events` (핵심 테이블, CDC 대상)

```sql
CREATE TABLE events (
    event_id UUID PRIMARY KEY,

    -- 이벤트 메타데이터
    event_type VARCHAR(50) NOT NULL,           -- OrderPlaced, OrderApproved, OrderShipped 등
    event_version INT NOT NULL,                -- 스키마 버전 (v1, v2 등)

    -- Aggregate 정보
    aggregate_type VARCHAR(30) NOT NULL,       -- Order, Inventory 등
    aggregate_id VARCHAR(50) NOT NULL,         -- order_id, product_id 등

    -- 이벤트 데이터
    payload JSONB NOT NULL,                    -- 실제 이벤트 데이터 (유연한 스키마)

    -- 타임스탬프
    occurred_at TIMESTAMP NOT NULL,            -- 이벤트 발생 시각 (과거 데이터의 실제 시각)
    ingested_at TIMESTAMP DEFAULT NOW(),       -- DB 삽입 시각 (현재 시각)

    -- 리플레이 제어
    replay_job_id VARCHAR(50),                 -- 어느 리플레이에 속하는가?
    is_replayed BOOLEAN DEFAULT FALSE,         -- 리플레이 데이터인가?

    -- 추적
    correlation_id UUID,                       -- 분산 트레이싱용
    causation_id UUID,                         -- 어떤 이벤트가 이를 발생시켰나?

    -- 인덱스 최적화
    created_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_events_aggregate ON events(aggregate_type, aggregate_id);
CREATE INDEX idx_events_occurred_at ON events(occurred_at);
CREATE INDEX idx_events_replay_job ON events(replay_job_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_ingested_at ON events(ingested_at);  -- CDC 순서 보장용
```

**Payload 예시 (JSONB)**:

```json
{
  "orderId": "abc123",
  "customerId": "customer_456",
  "sellerId": "seller_789",
  "productId": "product_001",
  "quantity": 2,
  "price": 149.9,
  "purchaseTimestamp": "2017-05-13T14:23:11Z"
}
```

---

#### 2. `replay_jobs` (리플레이 제어)

```sql
CREATE TABLE replay_jobs (
    replay_job_id VARCHAR(50) PRIMARY KEY,

    -- 리플레이 설정
    source_type VARCHAR(20) NOT NULL,          -- CSV, DATABASE, MANUAL
    source_location VARCHAR(255),              -- CSV 파일 경로 또는 쿼리

    -- 시간 범위
    start_time TIMESTAMP,                      -- 리플레이할 시작 시각
    end_time TIMESTAMP,                        -- 리플레이할 종료 시각

    -- 속도 제어
    speed_multiplier DECIMAL(10, 2) DEFAULT 1.0,  -- 1.0 = 실시간, 10.0 = 10배속
    events_per_second INT,                        -- 초당 이벤트 발행 수 제한

    -- 상태 관리
    status VARCHAR(20) NOT NULL,               -- CREATED, RUNNING, PAUSED, COMPLETED, FAILED

    -- 진행 상황
    total_events BIGINT,                       -- 전체 이벤트 수
    processed_events BIGINT DEFAULT 0,         -- 처리된 이벤트 수
    last_processed_at TIMESTAMP,               -- 마지막 처리 시각

    -- 메타데이터
    created_by VARCHAR(50),                    -- 실행자
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- 에러 처리
    error_message TEXT,
    retry_count INT DEFAULT 0
);

CREATE INDEX idx_replay_status ON replay_jobs(status);
CREATE INDEX idx_replay_created_at ON replay_jobs(created_at);
```

---

#### 3. `csv_offsets` (CSV 리플레이 체크포인트)

```sql
CREATE TABLE csv_offsets (
    replay_job_id VARCHAR(50),
    csv_file VARCHAR(255),

    -- 진행 상황 (Airflow가 업데이트)
    last_line_number BIGINT DEFAULT 0,         -- 마지막 처리한 줄 번호
    last_event_id UUID,                        -- 마지막 생성한 이벤트 ID

    -- 통계
    total_lines BIGINT,
    processed_lines BIGINT DEFAULT 0,
    failed_lines BIGINT DEFAULT 0,

    -- 타임스탬프
    last_processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    PRIMARY KEY (replay_job_id, csv_file),
    FOREIGN KEY (replay_job_id) REFERENCES replay_jobs(replay_job_id)
);
```

**용도**:

- Airflow DAG 실패 시 재시작 위치 기억
- Airflow가 주기적으로 체크포인트 저장 (100개마다 또는 1분마다)
- Service A는 체크포인트 조회 API만 제공

---

#### 4. `event_snapshots` (성능 최적화용)

```sql
CREATE TABLE event_snapshots (
    snapshot_id UUID PRIMARY KEY,

    aggregate_type VARCHAR(30) NOT NULL,
    aggregate_id VARCHAR(50) NOT NULL,

    -- 스냅샷 데이터
    snapshot_data JSONB NOT NULL,             -- Aggregate의 현재 상태

    -- 버전 관리
    version BIGINT NOT NULL,                  -- 이벤트 몇 개까지 반영했나?
    last_event_id UUID,

    -- 타임스탬프
    snapshot_at TIMESTAMP DEFAULT NOW(),

    UNIQUE (aggregate_type, aggregate_id, version)
);

CREATE INDEX idx_snapshot_aggregate ON event_snapshots(aggregate_type, aggregate_id);
```

**용도**: Aggregate 재구성 시 처음부터 이벤트를 모두 재생하지 않고 스냅샷부터 시작

---

### Database B: Command DB (Service B 전용)

**역할**: 도메인 로직 실행 및 상태 관리

**테이블 목록**:

#### 1. `aggregates` (도메인 상태)

- 역할:

```sql
CREATE TABLE aggregates (
    aggregate_id VARCHAR(50) PRIMARY KEY,
    aggregate_type VARCHAR(30) NOT NULL,

    -- 현재 상태 (JSONB로 유연하게 저장)
    state JSONB NOT NULL,

    -- 버전 관리 (Optimistic Locking)
    version BIGINT NOT NULL DEFAULT 0,

    -- 최종 처리 이벤트
    last_event_id UUID,
    last_event_type VARCHAR(50),
    last_updated_at TIMESTAMP,

    -- 메타데이터
    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE (aggregate_id, version)
);

CREATE INDEX idx_aggregates_type ON aggregates(aggregate_type);
CREATE INDEX idx_aggregates_updated ON aggregates(last_updated_at);
```

**State 예시 (Order Aggregate)**:

```json
{
  "orderId": "abc123",
  "customerId": "customer_456",
  "status": "SHIPPED",
  "items": [
    {
      "productId": "product_001",
      "sellerId": "seller_789",
      "quantity": 2,
      "price": 149.9
    }
  ],
  "timeline": {
    "purchasedAt": "2017-05-13T14:23:11Z",
    "approvedAt": "2017-05-13T15:10:22Z",
    "shippedAt": "2017-05-15T09:30:45Z"
  },
  "currentSellerId": "seller_789",
  "expectedDeliveryDate": "2017-05-20T23:59:59Z"
}
```

---

#### 2. `processed_events` (멱등성 보장)

```sql
CREATE TABLE processed_events (
    event_id UUID PRIMARY KEY,

    aggregate_id VARCHAR(50) NOT NULL,
    event_type VARCHAR(50) NOT NULL,

    -- 처리 결과
    processing_status VARCHAR(20) NOT NULL,    -- SUCCESS, REJECTED, FAILED
    rejection_reason TEXT,                     -- 거부 이유 (도메인 룰 위반 등)

    -- 타임스탬프
    processed_at TIMESTAMP DEFAULT NOW(),

    FOREIGN KEY (aggregate_id) REFERENCES aggregates(aggregate_id)
);

CREATE INDEX idx_processed_aggregate ON processed_events(aggregate_id);
CREATE INDEX idx_processed_status ON processed_events(processing_status);
```

**용도**:

- 같은 이벤트를 두 번 처리하지 않도록 방지
- CDC 재전송 대응

---

#### 3. `inventory` (재고 관리)

```sql
CREATE TABLE inventory (
    product_id VARCHAR(32),
    seller_id VARCHAR(32),

    -- 재고 수량
    current_stock INT NOT NULL DEFAULT 0,
    reserved_stock INT NOT NULL DEFAULT 0,     -- 주문됐으나 미출고
    available_stock INT GENERATED ALWAYS AS (current_stock - reserved_stock) STORED,

    -- 재고 정책
    safety_stock INT DEFAULT 10,
    reorder_point INT,
    lead_time_days INT DEFAULT 3,

    -- 버전 (동시성 제어)
    version BIGINT NOT NULL DEFAULT 0,

    -- 타임스탬프
    last_updated_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),

    PRIMARY KEY (product_id, seller_id)
);

CREATE INDEX idx_inventory_available ON inventory(available_stock);
CREATE INDEX idx_inventory_seller ON inventory(seller_id);
```

---

#### 4. `outbox` (이벤트 발행 패턴)

```sql
CREATE TABLE outbox (
    outbox_id UUID PRIMARY KEY,

    -- 발행할 이벤트
    event_type VARCHAR(50) NOT NULL,
    event_payload JSONB NOT NULL,

    -- 대상
    destination_topic VARCHAR(100) NOT NULL,   -- domain_events, inventory_alerts 등

    -- 발행 상태
    published BOOLEAN DEFAULT FALSE,
    published_at TIMESTAMP,

    -- 재시도 관리
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    last_error TEXT,

    -- 메타데이터
    aggregate_id VARCHAR(50),
    correlation_id UUID,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_outbox_published ON outbox(published, created_at);
CREATE INDEX idx_outbox_aggregate ON outbox(aggregate_id);
```

**Outbox 패턴 흐름**:

1. Service B가 도메인 로직 실행
2. Aggregate 업데이트 + Outbox 삽입 (단일 트랜잭션)
3. 별도 Outbox Publisher가 주기적으로 읽어서 Kafka로 발행
4. 발행 성공 시 `published = true` 업데이트

---

#### 5. `domain_rules` (도메인 규칙 설정)

```sql
CREATE TABLE domain_rules (
    rule_id VARCHAR(50) PRIMARY KEY,
    rule_type VARCHAR(30) NOT NULL,            -- STATE_TRANSITION, SLA_CHECK, INVENTORY_POLICY

    -- 규칙 정의
    rule_definition JSONB NOT NULL,

    -- 활성화
    is_active BOOLEAN DEFAULT TRUE,
    priority INT DEFAULT 0,

    -- 메타데이터
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

**예시: 상태 전이 규칙**

```json
{
  "from": "APPROVED",
  "to": "SHIPPED",
  "conditions": ["inventory.available_stock > 0", "seller.status == ACTIVE"],
  "actions": ["inventory.reserve_stock", "notify_customer"]
}
```

---

### Database C: Query DB (Service C 전용)

**역할**: 조회 최적화 및 분석

**테이블 목록**:

#### 1. `order_projections` (주문 조회용 비정규화)

```sql
CREATE TABLE order_projections (
    order_id VARCHAR(32) PRIMARY KEY,

    -- 기본 정보
    customer_id VARCHAR(32),
    customer_state CHAR(2),
    customer_zip INT,

    -- 셀러 정보
    seller_id VARCHAR(32),
    seller_state CHAR(2),
    seller_zip INT,

    -- 상품 정보
    product_id VARCHAR(32),
    product_category VARCHAR(50),

    -- 상태
    order_status VARCHAR(20),

    -- 타임라인 (비정규화)
    purchased_at TIMESTAMP,
    approved_at TIMESTAMP,
    carrier_date TIMESTAMP,
    customer_date TIMESTAMP,
    estimated_date TIMESTAMP,

    -- 계산 필드
    prep_hours DECIMAL(10, 2),
    shipping_hours DECIMAL(10, 2),
    total_hours DECIMAL(10, 2),
    is_delayed BOOLEAN,

    -- 금액
    price DECIMAL(10, 2),
    freight DECIMAL(10, 2),

    -- 리뷰
    review_score INT,

    -- 리플레이 정보
    replay_job_id VARCHAR(50),
    is_simulated BOOLEAN DEFAULT FALSE,

    -- 타임스탬프
    projection_updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_order_proj_status ON order_projections(order_status);
CREATE INDEX idx_order_proj_seller ON order_projections(seller_id);
CREATE INDEX idx_order_proj_customer_state ON order_projections(customer_state);
CREATE INDEX idx_order_proj_purchased ON order_projections(purchased_at);
CREATE INDEX idx_order_proj_replay ON order_projections(replay_job_id);
```

---

#### 2. `seller_performance` (셀러 성과 집계)

```sql
CREATE TABLE seller_performance (
    seller_id VARCHAR(32) PRIMARY KEY,
    seller_state CHAR(2),
    seller_city VARCHAR(50),

    -- 통계 (실시간 업데이트)
    total_orders BIGINT DEFAULT 0,

    -- 출고 시간
    avg_prep_hours DECIMAL(10, 2),
    p50_prep_hours DECIMAL(10, 2),
    p90_prep_hours DECIMAL(10, 2),

    -- 배송 성과
    on_time_rate DECIMAL(5, 2),
    avg_review_score DECIMAL(3, 2),

    -- 셀러 등급
    seller_tier VARCHAR(20),                   -- PLATINUM, GOLD, SILVER, BRONZE
    tier_updated_at TIMESTAMP,

    -- 리플레이별 성과 (JSONB)
    replay_performance JSONB,

    -- 타임스탬프
    last_calculated_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_seller_perf_tier ON seller_performance(seller_tier);
CREATE INDEX idx_seller_perf_state ON seller_performance(seller_state);
```

**replay_performance 예시**:

```json
{
  "replay_001": {
    "totalOrders": 123,
    "avgPrepHours": 48.5,
    "onTimeRate": 92.3
  },
  "replay_002": {
    "totalOrders": 145,
    "avgPrepHours": 52.1,
    "onTimeRate": 89.7
  }
}
```

---

#### 3. `route_statistics` (경로별 통계)

```sql
CREATE TABLE route_statistics (
    route_id VARCHAR(100) PRIMARY KEY,         -- "SP-RJ", "PR-AL" 등

    seller_state CHAR(2),
    customer_state CHAR(2),

    -- 통계
    total_deliveries BIGINT DEFAULT 0,
    avg_shipping_days DECIMAL(10, 2),
    delay_rate DECIMAL(5, 2),

    -- 위험 수준
    risk_level VARCHAR(20),                    -- HIGH_RISK, MEDIUM_RISK, NORMAL

    -- 리플레이별 통계
    replay_stats JSONB,

    -- 타임스탬프
    last_calculated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_route_risk ON route_statistics(risk_level);
CREATE INDEX idx_route_delay ON route_statistics(delay_rate DESC);
```

---

#### 4. `simulation_comparisons` (시뮬레이션 비교)

```sql
CREATE TABLE simulation_comparisons (
    comparison_id UUID PRIMARY KEY,

    -- 비교 대상
    replay_job_id_a VARCHAR(50),               -- 실제 데이터
    replay_job_id_b VARCHAR(50),               -- 최적화 시나리오

    -- 집계 결과
    total_orders_compared BIGINT,

    -- 시나리오 A (실제)
    avg_delivery_time_a DECIMAL(10, 2),
    total_delay_count_a BIGINT,

    -- 시나리오 B (최적화)
    avg_delivery_time_b DECIMAL(10, 2),
    total_delay_count_b BIGINT,

    -- 개선율
    time_improvement_pct DECIMAL(5, 2),
    delay_reduction_pct DECIMAL(5, 2),

    -- 상세 (JSONB)
    comparison_details JSONB,

    created_at TIMESTAMP DEFAULT NOW()
);
```

---

#### 5. `real_time_metrics` (실시간 메트릭 스냅샷)

```sql
CREATE TABLE real_time_metrics (
    metric_id UUID PRIMARY KEY,

    -- 메트릭 종류
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(20, 4),

    -- 차원
    dimensions JSONB,                          -- {"replay_id": "xxx", "seller_tier": "GOLD"}

    -- 타임스탬프
    measured_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_metrics_name_time ON real_time_metrics(metric_name, measured_at DESC);
```

**용도**: Grafana 대시보드용 시계열 데이터

---

## 🔄 이벤트 흐름 및 데이터 상호작용

### 1. 정상 흐름 (Happy Path)

```
┌─────────────────────────────────────────────────────────────────────┐
│                       1. CSV → Event Store                          │
└─────────────────────────────────────────────────────────────────────┘

Airflow DAG (외부)
  │
  │ 1. CSV 파일 읽기 (olist_orders.csv - 로컬 또는 S3)
  │ 2. 각 행을 Event 형식으로 변환
  │ 3. Service A API 호출
  │
  ▼
Service A (Event API)
  │
  │ POST /api/v1/events
  │ {
  │   "eventType": "OrderPlaced",
  │   "aggregateId": "order_abc",
  │   "payload": {...},
  │   "occurredAt": "2017-05-13T14:23:11Z",
  │   "replayJobId": "replay_001"
  │ }
  │
  ▼
Database A: events 테이블
  │
  │ INSERT INTO events (
  │   event_id, event_type, aggregate_id, payload, occurred_at, replay_job_id
  │ ) VALUES (
  │   'uuid-001', 'OrderPlaced', 'order_abc', '{"customerId": "..."}', '2017-05-13 14:23', 'replay_001'
  │ );
  │
  ▼
Debezium CDC
  │
  │ 감지: events 테이블에 새 행 삽입됨
  │ 변환: DB Row → Kafka Message
  │
  ▼
Kafka Topic: raw_events
  │
  │ Message:
  │ {
  │   "eventId": "uuid-001",
  │   "eventType": "OrderPlaced",
  │   "aggregateId": "order_abc",
  │   "payload": {...},
  │   "occurredAt": "2017-05-13T14:23:11Z",
  │   "replayJobId": "replay_001"
  │ }
  │
  └──────────────────────────────────────────────────────────────────┐
                                                                      │
┌─────────────────────────────────────────────────────────────────────┘
│                       2. Event → Domain Processing                  │
└─────────────────────────────────────────────────────────────────────┘

Service B (Consumer)
  │
  │ Kafka Consume (raw_events)
  │
  ▼
Domain Logic
  │
  │ 1. 멱등성 체크: processed_events 테이블 확인
  │    → 이미 처리했나? → 스킵
  │
  │ 2. Aggregate 로딩: aggregates 테이블 조회
  │    → 없으면 신규 생성
  │
  │ 3. 도메인 검증
  │    - 상태 전이 가능한가? (CREATED → APPROVED)
  │    - 재고가 있는가? (inventory 테이블 확인)
  │    - 시간 역행은 없는가?
  │
  │ 4. 검증 성공 시
  │
  ▼
Database B: 트랜잭션 시작
  │
  │ BEGIN TRANSACTION;
  │
  │ -- Aggregate 업데이트
  │ UPDATE aggregates
  │ SET state = {...}, version = version + 1, last_event_id = 'uuid-001'
  │ WHERE aggregate_id = 'order_abc' AND version = 5;  -- Optimistic Lock
  │
  │ -- 멱등성 기록
  │ INSERT INTO processed_events (event_id, aggregate_id, processing_status)
  │ VALUES ('uuid-001', 'order_abc', 'SUCCESS');
  │
  │ -- 재고 차감
  │ UPDATE inventory
  │ SET reserved_stock = reserved_stock + 1, version = version + 1
  │ WHERE product_id = 'prod_001' AND seller_id = 'seller_789' AND version = 3;
  │
  │ -- Domain Event 생성 (Outbox)
  │ INSERT INTO outbox (event_type, event_payload, destination_topic)
  │ VALUES ('OrderApproved', '{"orderId": "order_abc", ...}', 'domain_events');
  │
  │ COMMIT;
  │
  ▼
Outbox Publisher (별도 스레드)
  │
  │ 1. outbox 테이블 폴링 (published = false)
  │ 2. Kafka에 발행
  │
  ▼
Kafka Topic: domain_events
  │
  │ Message:
  │ {
  │   "eventType": "OrderApproved",
  │   "orderId": "order_abc",
  │   "approvedAt": "2017-05-13T15:10:22Z",
  │   "sellerId": "seller_789",
  │   "replayJobId": "replay_001"
  │ }
  │
  └──────────────────────────────────────────────────────────────────┐
                                                                      │
┌─────────────────────────────────────────────────────────────────────┘
│                       3. Event → Projection Update                  │
└─────────────────────────────────────────────────────────────────────┘

Service C (Consumer)
  │
  │ Kafka Consume (domain_events)
  │
  ▼
Projection Engine
  │
  │ 1. 이벤트 타입별 핸들러 실행
  │    - OrderApproved → order_projections 업데이트
  │    - OrderApproved → seller_performance 재계산
  │
  ▼
Database C: order_projections
  │
  │ INSERT INTO order_projections (
  │   order_id, customer_id, seller_id, order_status, approved_at, replay_job_id
  │ ) VALUES (
  │   'order_abc', 'customer_456', 'seller_789', 'APPROVED', '2017-05-13 15:10', 'replay_001'
  │ )
  │ ON CONFLICT (order_id) DO UPDATE
  │ SET order_status = 'APPROVED', approved_at = '2017-05-13 15:10';
  │
  ▼
Database C: seller_performance
  │
  │ UPDATE seller_performance
  │ SET
  │   total_orders = total_orders + 1,
  │   avg_prep_hours = (avg_prep_hours * (total_orders - 1) + <new_prep>) / total_orders,
  │   last_calculated_at = NOW()
  │ WHERE seller_id = 'seller_789';
  │
  ▼
Grafana Dashboard
  │
  │ SELECT * FROM seller_performance WHERE seller_tier = 'PLATINUM';
  │ → 실시간 업데이트 반영
```

---

### 2. 이벤트 스키마 버전 관리

**문제**: CSV 스키마가 변경되면 어떻게 처리하나?

**해결책**: `event_version` 필드 활용

```java
// Service A: Event Mapper
public Event mapCsvToEvent(String[] csvRow, int eventVersion) {
    switch (eventVersion) {
        case 1:
            return mapV1(csvRow);  // 기존 스키마
        case 2:
            return mapV2(csvRow);  // 새 컬럼 추가 (예: delivery_method)
        default:
            throw new UnsupportedVersionException();
    }
}

// Service B: Event Handler
public void handle(Event event) {
    switch (event.getEventVersion()) {
        case 1:
            handleV1(event);
        case 2:
            handleV2(event);
    }
}
```

**Database A: events 테이블**

```sql
SELECT event_version, COUNT(*)
FROM events
GROUP BY event_version;

-- 결과:
-- event_version | count
-- --------------|-------
--       1       | 80,000
--       2       | 20,000
```

---

## ⏱️ 리플레이 제어 및 관찰

### 1. 리플레이 시나리오별 제어

#### Scenario 1: 실시간 속도 리플레이 (1:1)

```sql
INSERT INTO replay_jobs (replay_job_id, source_type, speed_multiplier, events_per_second, status)
VALUES ('replay_realtime', 'CSV', 1.0, 100, 'CREATED');
```

**동작**:

- 과거 2017년 5월 13일 14:23에 발생한 이벤트 → 현재 시각 기준 14:23에 발행
- 이벤트 간 간격 유지 (예: 10초 간격이었으면 10초 대기)

---

#### Scenario 2: 10배속 리플레이

```sql
INSERT INTO replay_jobs (replay_job_id, source_type, speed_multiplier, events_per_second, status)
VALUES ('replay_fast', 'CSV', 10.0, 1000, 'CREATED');
```

**동작**:

- 1시간짜리 데이터를 6분 만에 재생
- Kafka 처리 성능 고려하여 `events_per_second` 제한

---

#### Scenario 3: 특정 기간만 리플레이

```sql
INSERT INTO replay_jobs (
    replay_job_id, source_type, start_time, end_time, speed_multiplier, status
) VALUES (
    'replay_may_2017', 'CSV', '2017-05-01', '2017-05-31', 100.0, 'CREATED'
);
```

**동작**:

- 2017년 5월 한 달치 데이터만 추출
- 100배속으로 빠르게 재생

---

### 2. 리플레이 상태 관리 (State Machine)

```
┌──────────┐
│ CREATED  │  초기 상태
└────┬─────┘
     │ POST /replay-jobs/{id}/start
     ▼
┌──────────┐
│ RUNNING  │  이벤트 발행 중
└────┬─────┘
     │
     ├─────┐ POST /replay-jobs/{id}/pause
     │     ▼
     │  ┌─────────┐
     │  │ PAUSED  │  일시 중지
     │  └────┬────┘
     │       │ POST /replay-jobs/{id}/resume
     │       ▼
     │  ┌──────────┐
     │  │ RUNNING  │
     │  └────┬─────┘
     │       │
     ▼       ▼
┌──────────┐  ┌──────────┐
│COMPLETED │  │ FAILED   │
└──────────┘  └──────────┘
```

**API 명세**:

```http
POST /api/v1/replay-jobs/{id}/pause
→ replay_jobs.status = 'PAUSED'
→ csv_offsets 업데이트 (현재 줄 번호 저장)

POST /api/v1/replay-jobs/{id}/resume
→ csv_offsets에서 마지막 위치 조회
→ 그 위치부터 재개
```

---

### 3. 실시간 진행 상황 관찰

#### Grafana 대시보드 패널

**Panel 1: 리플레이 진행률**

```sql
SELECT
    replay_job_id,
    status,
    ROUND(processed_events * 100.0 / total_events, 2) AS progress_pct,
    processed_events,
    total_events,
    last_processed_at
FROM replay_jobs
WHERE status IN ('RUNNING', 'PAUSED')
ORDER BY created_at DESC;
```

**Panel 2: 초당 이벤트 처리 속도**

```sql
-- real_time_metrics 테이블 활용
SELECT
    measured_at,
    metric_value AS events_per_second
FROM real_time_metrics
WHERE metric_name = 'replay_throughput'
  AND dimensions->>'replay_id' = 'replay_001'
ORDER BY measured_at DESC
LIMIT 100;
```

**Panel 3: 리플레이별 배송 시간 비교**

```sql
SELECT
    replay_job_id,
    AVG(prep_hours) AS avg_prep,
    AVG(shipping_hours) AS avg_shipping,
    AVG(total_hours) AS avg_total
FROM order_projections
WHERE replay_job_id IN ('replay_actual', 'replay_optimized')
GROUP BY replay_job_id;
```

---

### 4. 타임 트래블 쿼리 (특정 시점 상태 조회)

**문제**: "2017년 5월 15일 오후 3시 기준으로 셀러 A의 재고는 얼마였나?"

**해결책**: Event Sourcing의 장점 활용

```sql
-- 특정 시점까지의 이벤트만 재생
WITH events_until_time AS (
    SELECT *
    FROM events
    WHERE aggregate_id = 'seller_A-product_001'
      AND occurred_at <= '2017-05-15 15:00:00'
      AND event_type IN ('InventoryReceived', 'InventoryReserved', 'InventoryShipped')
    ORDER BY occurred_at
)
SELECT
    SUM(CASE WHEN event_type = 'InventoryReceived' THEN (payload->>'quantity')::INT ELSE 0 END) AS total_received,
    SUM(CASE WHEN event_type = 'InventoryReserved' THEN (payload->>'quantity')::INT ELSE 0 END) AS total_reserved,
    SUM(CASE WHEN event_type = 'InventoryShipped' THEN (payload->>'quantity')::INT ELSE 0 END) AS total_shipped
FROM events_until_time;

-- 결과: 특정 시점의 재고 상태 복원
```

**성능 최적화**: `event_snapshots` 테이블 활용

```sql
-- 스냅샷 + 이후 이벤트만 재생
SELECT snapshot_data
FROM event_snapshots
WHERE aggregate_id = 'seller_A-product_001'
  AND snapshot_at <= '2017-05-15 15:00:00'
ORDER BY snapshot_at DESC
LIMIT 1;

-- 스냅샷 이후 이벤트만 가져와서 재생
-- (수천 개 이벤트가 아닌 수십 개만 처리)
```

---

## 🔍 관측 가능성 (Observability) 상세 설계

### 1. 분산 트레이싱

**목표**: 하나의 주문이 Service A → B → C를 거쳐가는 전체 여정 추적

**구현**: Correlation ID 전파

```
Service A (Event 생성)
  │
  │ correlation_id = UUID.randomUUID()
  │
  ▼
Database A: events
  │ event_id = uuid-001
  │ correlation_id = corr-abc-123  ← 저장
  │
  ▼
Kafka: raw_events
  │ headers: {
  │   "correlation-id": "corr-abc-123",
  │   "trace-id": "trace-xyz-789"
  │ }
  │
  ▼
Service B (처리)
  │
  │ MDC.put("correlationId", "corr-abc-123")  // 로깅 컨텍스트
  │
  ▼
Database B: processed_events
  │ event_id = uuid-001
  │ correlation_id = corr-abc-123 (같은 값)
  │
  ▼
Kafka: domain_events
  │ headers: {
  │   "correlation-id": "corr-abc-123",  // 동일 ID 전파
  │   "causation-id": "uuid-001"         // 원인 이벤트
  │ }
  │
  ▼
Service C (Projection)
  │
  │ MDC.put("correlationId", "corr-abc-123")
  │
  ▼
Database C: order_projections
  │ 로그: "Projection updated for order_abc [correlation=corr-abc-123]"
```

**결과**:

- Grafana Loki 또는 ELK에서 `correlation_id`로 검색하면 전체 흐름 추적 가능
- 지연 구간 식별 (Service B에서 5초 걸림 등)

---

### 2. 메트릭 수집 (Prometheus)

**Service A 메트릭**:

```java
// Micrometer 활용
Counter.builder("olist.events.published")
    .tag("event_type", "OrderPlaced")
    .tag("replay_id", replayJobId)
    .register(meterRegistry)
    .increment();

Gauge.builder("olist.replay.progress", () ->
    replayJobRepository.findById(id).getProcessedEvents() * 100.0 / getTotalEvents()
)
    .tag("replay_id", id)
    .register(meterRegistry);
```

**Service B 메트릭**:

```java
Timer.builder("olist.domain.processing.time")
    .tag("event_type", eventType)
    .register(meterRegistry)
    .record(() -> {
        processEvent(event);
    });

Counter.builder("olist.domain.validation.rejected")
    .tag("rejection_reason", reason)
    .register(meterRegistry)
    .increment();
```

**Service C 메트릭**:

```java
Gauge.builder("olist.projection.lag", () ->
    calculateLag()  // Kafka offset lag
)
    .register(meterRegistry);

Counter.builder("olist.seller.tier.count")
    .tag("tier", "PLATINUM")
    .register(meterRegistry)
    .increment();
```

**Grafana 대시보드**:

```promql
# 초당 이벤트 발행 속도
rate(olist_events_published_total[1m])

# 도메인 처리 지연 시간 (P95)
histogram_quantile(0.95, olist_domain_processing_time_seconds_bucket)

# Projection Lag (지연)
olist_projection_lag
```

---

### 3. 로그 집계 (구조화 로깅)

**로그 포맷 (JSON)**:

```json
{
  "timestamp": "2026-01-24T10:30:45.123Z",
  "level": "INFO",
  "service": "service-b",
  "traceId": "trace-xyz-789",
  "correlationId": "corr-abc-123",
  "eventId": "uuid-001",
  "aggregateId": "order_abc",
  "message": "Order approved successfully",
  "replayJobId": "replay_001",
  "processingTimeMs": 23
}
```

**Grafana Loki 쿼리**:

```logql
{service="service-b"}
  |= "Order approved"
  | json
  | correlationId="corr-abc-123"
```

---

## 🚦 동시성 제어 및 일관성 보장

### 1. Optimistic Locking (낙관적 잠금)

**시나리오**: 두 개의 이벤트가 거의 동시에 같은 Aggregate 수정 시도

```sql
-- Service B의 Aggregate 업데이트
UPDATE aggregates
SET
    state = '{"status": "SHIPPED", ...}',
    version = version + 1,
    last_event_id = 'uuid-002'
WHERE aggregate_id = 'order_abc'
  AND version = 5;  -- ← 현재 버전 체크

-- 결과:
-- - 성공 시: 1 row affected
-- - 실패 시: 0 rows affected (다른 트랜잭션이 먼저 버전 증가시킴)
```

**실패 시 처리**:

```java
int updated = jdbcTemplate.update(sql, params);
if (updated == 0) {
    // 버전 충돌 발생
    throw new OptimisticLockException("Aggregate was modified by another transaction");
}
```

---

### 2. Idempotency (멱등성) 보장

**문제**: Kafka 메시지 재전송 시 중복 처리 방지

**해결책**: `processed_events` 테이블

```java
@Transactional
public void handleEvent(Event event) {
    // 1. 이미 처리했는지 확인
    if (processedEventRepository.existsById(event.getEventId())) {
        log.info("Event {} already processed, skipping", event.getEventId());
        return;  // 중복 처리 방지
    }

    // 2. 도메인 로직 실행
    Aggregate aggregate = loadOrCreate(event.getAggregateId());
    aggregate.apply(event);
    aggregateRepository.save(aggregate);

    // 3. 처리 완료 기록
    processedEventRepository.save(new ProcessedEvent(
        event.getEventId(),
        event.getAggregateId(),
        ProcessingStatus.SUCCESS
    ));

    // 4. Domain Event 발행 (Outbox)
    outboxRepository.save(new OutboxMessage(...));
}
```

---

### 3. Outbox 패턴 (At-Least-Once 보장)

**문제**: Aggregate 업데이트는 성공했는데 Kafka 발행 실패 시?

**해결책**: 단일 트랜잭션 내에서 Outbox에 저장

```java
@Transactional
public void handleEvent(Event event) {
    // 1. Aggregate 업데이트
    aggregateRepository.save(aggregate);

    // 2. Outbox에 발행할 이벤트 저장 (같은 트랜잭션)
    outboxRepository.save(OutboxMessage.builder()
        .eventType("OrderShipped")
        .payload(domainEvent.toJson())
        .destinationTopic("domain_events")
        .published(false)
        .build());

    // COMMIT: 둘 다 성공하거나 둘 다 롤백
}

// 별도 스레드에서 실행
@Scheduled(fixedDelay = 1000)
public void publishOutboxMessages() {
    List<OutboxMessage> unpublished = outboxRepository.findByPublishedFalse();

    for (OutboxMessage msg : unpublished) {
        try {
            kafkaTemplate.send(msg.getDestinationTopic(), msg.getPayload());

            // 발행 성공 시 플래그 업데이트
            msg.setPublished(true);
            msg.setPublishedAt(LocalDateTime.now());
            outboxRepository.save(msg);
        } catch (Exception e) {
            msg.incrementRetryCount();
            outboxRepository.save(msg);
        }
    }
}
```

---

## 📊 리플레이별 데이터 격리 및 비교

### 1. 리플레이 격리 (Namespace 개념)

**Database A: events**

```sql
SELECT
    replay_job_id,
    COUNT(*) AS total_events
FROM events
GROUP BY replay_job_id;

-- 결과:
-- replay_job_id    | total_events
-- -----------------|-------------
-- replay_actual    | 100,000   (실제 과거 데이터)
-- replay_optimized | 100,000   (최적화 시나리오)
-- NULL             | 50,000    (운영 환경 실시간 데이터)
```

**Database C: order_projections**

```sql
-- 특정 리플레이의 결과만 조회
SELECT *
FROM order_projections
WHERE replay_job_id = 'replay_optimized'
  AND order_status = 'DELIVERED';
```

---

### 2. 리플레이 간 성과 비교 쿼리

```sql
-- 실제 vs 최적화 비교
WITH actual AS (
    SELECT
        AVG(total_hours) AS avg_total,
        COUNT(CASE WHEN is_delayed THEN 1 END) * 100.0 / COUNT(*) AS delay_rate
    FROM order_projections
    WHERE replay_job_id = 'replay_actual'
),
optimized AS (
    SELECT
        AVG(total_hours) AS avg_total,
        COUNT(CASE WHEN is_delayed THEN 1 END) * 100.0 / COUNT(*) AS delay_rate
    FROM order_projections
    WHERE replay_job_id = 'replay_optimized'
)
SELECT
    a.avg_total AS actual_avg_hours,
    o.avg_total AS optimized_avg_hours,
    ROUND((a.avg_total - o.avg_total) / a.avg_total * 100, 2) AS improvement_pct,
    a.delay_rate AS actual_delay_rate,
    o.delay_rate AS optimized_delay_rate
FROM actual a, optimized o;

-- 결과:
-- actual_avg_hours | optimized_avg_hours | improvement_pct | actual_delay_rate | optimized_delay_rate
-- -----------------|---------------------|-----------------|-------------------|---------------------
--     230.5        |        76.2         |      66.9       |       18.5        |         5.3
```

---

### 3. 셀러별 리플레이 성과 비교

```sql
SELECT
    sp.seller_id,
    sp.seller_state,
    sp.replay_performance->>'replay_actual'->>'avgPrepHours' AS actual_prep,
    sp.replay_performance->>'replay_optimized'->>'avgPrepHours' AS optimized_prep,
    sp.seller_tier
FROM seller_performance sp
WHERE sp.replay_performance IS NOT NULL
ORDER BY actual_prep DESC
LIMIT 20;
```

---

## 🔄 리플레이 시나리오별 구현 예시

### Scenario 1: "과거 데이터 있는 그대로" 리플레이

**목적**: 실제로 어떤 일이 있었는지 재현

**Airflow DAG 코드**:

```python
def run_actual_replay(**context):
    """실제 과거 데이터를 그대로 재현"""

    # 1. Replay Job 생성
    replay_job_id = "replay_actual_20260124"
    requests.post("http://service-a:8080/api/v1/replay-jobs", json={
        "replayJobId": replay_job_id,
        "status": "RUNNING"
    })

    # 2. CSV 파일 읽기
    df = pd.read_csv("/data/olist_orders.csv")
    df = df.sort_values("order_purchase_timestamp")

    # 3. 각 주문을 원본 그대로 이벤트화
    for _, row in df.iterrows():
        event = {
            "eventType": "OrderPlaced",
            "aggregateId": row["order_id"],
            "payload": {
                "customerId": row["customer_id"],
                "sellerId": row["seller_id"],  # ← 원본 셀러 그대로
                "productId": row["product_id"],
                "quantity": 1,
                "price": row["price"]
            },
            "occurredAt": row["order_purchase_timestamp"],
            "replayJobId": replay_job_id
        }

        # 4. Service A로 전송
        requests.post("http://service-a:8080/api/v1/events", json=event)

        # 5. 속도 제어 (선택적)
        time.sleep(0.01)  # 100배속
```

**Service A는 단순히 저장만**:

```java
@RestController
@RequestMapping("/api/v1/events")
public class EventController {

    @PostMapping
    public ResponseEntity<EventResponse> saveEvent(@RequestBody EventRequest request) {
        // 1. 이벤트 생성
        Event event = Event.builder()
            .eventId(UUID.randomUUID())
            .eventType(request.getEventType())
            .aggregateId(request.getAggregateId())
            .payload(request.getPayload())
            .occurredAt(request.getOccurredAt())
            .replayJobId(request.getReplayJobId())
            .build();

        // 2. DB 저장 (CDC가 자동으로 Kafka 발행)
        eventRepository.save(event);

        return ResponseEntity.status(201).body(
            new EventResponse(event.getEventId(), "SAVED")
        );
    }
}
```

---

### Scenario 2: "만약 재고가 있었다면" 시뮬레이션

**목적**: 최적화 시나리오 검증

**Airflow DAG 코드**:

```python
def run_optimized_replay(**context):
    """재고 관리 시스템이 있었다면 시나리오"""

    replay_job_id = "replay_optimized_20260124"
    requests.post("http://service-a:8080/api/v1/replay-jobs", json={
        "replayJobId": replay_job_id,
        "status": "RUNNING"
    })

    # 1. 가상 재고 초기화 (Service B에 요청)
    requests.post("http://service-b:8081/api/v1/inventory/initialize", json={
        "replayJobId": replay_job_id
    })

    # 2. CSV 읽기
    df = pd.read_csv("/data/olist_orders.csv")
    df = df.sort_values("order_purchase_timestamp")

    # 3. 각 주문마다 최적 셀러 선택
    for _, row in df.iterrows():
        # 최적 셀러 찾기 (Service C에 요청)
        optimal_response = requests.get(
            f"http://service-c:8082/api/v1/routing/optimal-seller",
            params={
                "customerZip": row["customer_zip_code_prefix"],
                "productId": row["product_id"],
                "replayJobId": replay_job_id
            }
        )

        optimal_seller = optimal_response.json().get("sellerId")

        if not optimal_seller:
            # 재고 없으면 원본 셀러 사용
            optimal_seller = row["seller_id"]

        # 이벤트 생성 (최적 셀러로 변경)
        event = {
            "eventType": "OrderPlaced",
            "aggregateId": row["order_id"],
            "payload": {
                "customerId": row["customer_id"],
                "sellerId": optimal_seller,  # ← 최적 셀러!
                "productId": row["product_id"],
                "quantity": 1,
                "price": row["price"]
            },
            "occurredAt": row["order_purchase_timestamp"],
            "replayJobId": replay_job_id
        }

        # Service A로 전송
        requests.post("http://service-a:8080/api/v1/events", json=event)

        time.sleep(0.01)
```

**Service C는 최적 셀러 추천 API 제공**:

```java
@RestController
@RequestMapping("/api/v1/routing")
public class RoutingController {

    @GetMapping("/optimal-seller")
    public OptimalSellerResponse findOptimalSeller(
        @RequestParam int customerZip,
        @RequestParam String productId,
        @RequestParam String replayJobId
    ) {
        // 1. 재고가 있는 셀러 조회 (Service B에서 가져온 재고 정보 활용)
        List<Seller> availableSellers = inventoryService.findSellersWithStock(
            productId, replayJobId
        );

        if (availableSellers.isEmpty()) {
            return new OptimalSellerResponse(null, "NO_STOCK");
        }

        // 2. 가장 가까운 셀러 선택
        Seller optimal = availableSellers.stream()
            .min(Comparator.comparingInt(s ->
                Math.abs(s.getZipCode() - customerZip)
            ))
            .orElse(null);

        return new OptimalSellerResponse(optimal.getId(), "FOUND");
    }
}
```

---

### Scenario 3: "A/B 테스트" (두 가지 정책 비교)

**목적**: 다른 라우팅 정책 비교

**Airflow DAG 코드**:

```python
def run_ab_test(**context):
    """두 가지 라우팅 정책 동시 테스트"""

    replay_a = "replay_policy_distance_20260124"  # 거리 기반
    replay_b = "replay_policy_rating_20260124"    # 리뷰 점수 기반

    # Replay Job 생성
    for replay_id in [replay_a, replay_b]:
        requests.post("http://service-a:8080/api/v1/replay-jobs", json={
            "replayJobId": replay_id,
            "status": "RUNNING"
        })

    # CSV 읽기
    df = pd.read_csv("/data/olist_orders.csv")

    for _, row in df.iterrows():
        # Policy A: 거리 최우선
        seller_a_response = requests.get(
            "http://service-c:8082/api/v1/routing/nearest-seller",
            params={
                "customerZip": row["customer_zip_code_prefix"],
                "productId": row["product_id"]
            }
        )
        seller_a = seller_a_response.json()["sellerId"]

        # Policy B: 리뷰 점수 최우선
        seller_b_response = requests.get(
            "http://service-c:8082/api/v1/routing/best-rated-seller",
            params={
                "customerZip": row["customer_zip_code_prefix"],
                "productId": row["product_id"]
            }
        )
        seller_b = seller_b_response.json()["sellerId"]

        # 두 개의 이벤트 생성 (다른 replay_job_id)
        for replay_id, seller_id in [(replay_a, seller_a), (replay_b, seller_b)]:
            event = {
                "eventType": "OrderPlaced",
                "aggregateId": row["order_id"],
                "payload": {
                    "customerId": row["customer_id"],
                    "sellerId": seller_id,
                    "productId": row["product_id"]
                },
                "occurredAt": row["order_purchase_timestamp"],
                "replayJobId": replay_id
            }

            requests.post("http://service-a:8080/api/v1/events", json=event)

    # 결과 비교 (나중에)
    comparison_response = requests.get(
        "http://service-c:8082/api/v1/replays/compare",
        params={"replayA": replay_a, "replayB": replay_b}
    )

    print(f"Comparison: {comparison_response.json()}")
```

---

## 🎛️ 리플레이 제어 API 명세

### 1. 리플레이 생성

```http
POST /api/v1/replays

Request:
{
  "name": "Replay May 2017 with Inventory",
  "sourceType": "CSV",
  "sourceLocation": "s3://olist-data/orders_2017_05.csv",
  "startTime": "2017-05-01T00:00:00Z",
  "endTime": "2017-05-31T23:59:59Z",
  "speedMultiplier": 100.0,
  "eventsPerSecond": 1000,
  "config": {
    "useInventory": true,
    "routingPolicy": "OPTIMAL_SELLER"
  }
}

Response:
{
  "replayJobId": "replay_001",
  "status": "CREATED",
  "estimatedDuration": "PT30M",  // ISO 8601 Duration
  "createdAt": "2026-01-24T10:30:00Z"
}
```

---

### 2. 리플레이 시작/중지/재개

```http
POST /api/v1/replays/{id}/start
POST /api/v1/replays/{id}/pause
POST /api/v1/replays/{id}/resume
POST /api/v1/replays/{id}/cancel

Response:
{
  "replayJobId": "replay_001",
  "status": "RUNNING",
  "message": "Replay started successfully"
}
```

---

### 3. 진행 상황 조회

```http
GET /api/v1/replays/{id}/status

Response:
{
  "replayJobId": "replay_001",
  "status": "RUNNING",
  "progress": {
    "totalEvents": 100000,
    "processedEvents": 45230,
    "progressPercentage": 45.23,
    "estimatedTimeRemaining": "PT15M"
  },
  "metrics": {
    "eventsPerSecond": 150.3,
    "averageProcessingTime": "23ms",
    "errorCount": 0
  },
  "lastProcessedEvent": {
    "eventId": "uuid-45230",
    "occurredAt": "2017-05-15T14:23:11Z",
    "eventType": "OrderShipped"
  }
}
```

---

### 4. 리플레이 결과 비교

```http
GET /api/v1/replays/compare?replayA=replay_actual&replayB=replay_optimized

Response:
{
  "comparison": {
    "replayA": {
      "id": "replay_actual",
      "totalOrders": 100000,
      "avgDeliveryHours": 230.5,
      "delayRate": 18.5
    },
    "replayB": {
      "id": "replay_optimized",
      "totalOrders": 100000,
      "avgDeliveryHours": 76.2,
      "delayRate": 5.3
    },
    "improvement": {
      "deliveryTimeReduction": "66.9%",
      "delayRateReduction": "71.4%",
      "totalTimeSaved": "15,430,000 hours"
    }
  }
}
```

---

## 📈 Grafana 대시보드 구성 (상세)

### Dashboard 1: 리플레이 모니터링

**Panel 1: 리플레이 진행률 (Gauge)**

```sql
SELECT
    ROUND(processed_events * 100.0 / total_events, 2) AS value,
    'replay_001' AS metric
FROM replay_jobs
WHERE replay_job_id = 'replay_001';
```

**Panel 2: 초당 이벤트 처리 속도 (Graph)**

```promql
rate(olist_events_published_total{replay_id="replay_001"}[1m])
```

**Panel 3: 서비스별 처리 지연 (Heatmap)**

```promql
histogram_quantile(0.95,
  rate(olist_domain_processing_time_seconds_bucket[5m])
) by (service, event_type)
```

---

### Dashboard 2: 비즈니스 인사이트

**Panel 1: 실제 vs 최적화 배송 시간**

```sql
SELECT
    replay_job_id AS metric,
    AVG(total_hours) AS value
FROM order_projections
WHERE replay_job_id IN ('replay_actual', 'replay_optimized')
GROUP BY replay_job_id;
```

**Panel 2: 셀러 티어 분포 변화**

```sql
SELECT
    seller_tier AS metric,
    COUNT(*) AS value
FROM seller_performance
WHERE replay_performance->>'replay_optimized' IS NOT NULL
GROUP BY seller_tier;
```

**Panel 3: 지역별 개선율 (Map)**

```sql
SELECT
    customer_state AS geo,
    ROUND(
        (AVG(CASE WHEN replay_job_id = 'replay_actual' THEN total_hours END) -
         AVG(CASE WHEN replay_job_id = 'replay_optimized' THEN total_hours END)) /
        AVG(CASE WHEN replay_job_id = 'replay_actual' THEN total_hours END) * 100,
        2
    ) AS improvement_pct
FROM order_projections
WHERE replay_job_id IN ('replay_actual', 'replay_optimized')
GROUP BY customer_state;
```

---

## 🔐 보안 및 격리

### 1. 리플레이 데이터 격리

**문제**: 리플레이 데이터가 운영 데이터를 오염시키지 않도록

**해결책**:

- `replay_job_id` 필드로 명확히 구분
- 운영 데이터는 `replay_job_id = NULL`
- Projection 업데이트 시 리플레이 여부 체크

```java
@Service
public class OrderProjectionService {

    public void updateProjection(DomainEvent event) {
        if (event.getReplayJobId() != null) {
            // 리플레이 데이터 → 별도 처리
            updateReplayProjection(event);
        } else {
            // 운영 데이터 → 실제 Projection 업데이트
            updateProductionProjection(event);
        }
    }
}
```

---

### 2. 리플레이 권한 관리

**API 보안**:

```http
POST /api/v1/replays
Authorization: Bearer <JWT_TOKEN>
X-User-Role: ADMIN  ← 관리자만 리플레이 생성 가능
```

**감사 로그**:

```sql
CREATE TABLE replay_audit_logs (
    log_id UUID PRIMARY KEY,
    replay_job_id VARCHAR(50),
    action VARCHAR(20),  -- START, PAUSE, CANCEL
    performed_by VARCHAR(50),
    performed_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🚀 Phase 2 구현 우선순위

### Week 1-2: 인프라 구축

- [ ] Service A, B, C 프로젝트 생성
- [ ] PostgreSQL 3개 DB 생성 및 Flyway 마이그레이션
- [ ] Kafka 클러스터 구축 (Docker Compose)
- [ ] Debezium CDC 설정

### Week 3-4: Service A 구현

- [ ] CSV 리플레이 로직
- [ ] Event 생성 API
- [ ] replay_jobs 상태 관리

### Week 5-6: Service B 구현

- [ ] Kafka Consumer (raw_events)
- [ ] Domain Validation 로직
- [ ] Outbox Publisher

### Week 7-8: Service C 구현

- [ ] Projection Engine
- [ ] Grafana 대시보드
- [ ] 비교 분석 API

---

## ✅ Definition of Done (Phase 2)

- [ ] **기능**:
  - [ ] 10만 건 리플레이 성공
  - [ ] 실제 vs 최적화 비교 결과 도출
  - [ ] 리플레이 중단/재개 정상 작동

- [ ] **성능**:
  - [ ] 초당 1000 이벤트 처리
  - [ ] Projection Lag < 10초

- [ ] **관측**:
  - [ ] Grafana 대시보드 10개 이상
  - [ ] 분산 트레이싱 작동

- [ ] **검증**:
  - [ ] "67% 개선" 시뮬레이션 재현
  - [ ] 타임 트래블 쿼리 성공

---

**이 문서로 MSA 기반 Event-Driven 아키텍처를 구축하세요!** 🚀
