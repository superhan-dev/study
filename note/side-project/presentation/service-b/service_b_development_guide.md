# Service B (Command Service) 개발 가이드

이 문서는 **Service B (Domain Event Translator)**의 역할, 책임, 그리고 상세 구현 명세를 정의합니다. 개발팀은 이 문서를 기준으로 구현을 진행합니다.

---

## 1. 도메인 로직 및 아키텍처 (Domain Logic & Architecture)

Service B는 **Raw Event를 수신하여 도메인 검증을 수행하고, Domain Event를 발행하는 중간 계층**입니다.

### 1.1 핵심 역할 및 책임

- **이벤트 소비 (Consumer)**: Kafka `raw_events` 토픽 구독.
- **도메인 검증 (Validation)**: 비즈니스 규칙(상태 전이, 재고) 검증.
- **상태 관리 (State Management)**: Aggregate 패턴 및 낙관적 락(Optimistic Lock) 적용.
- **이벤트 발행 (Publisher)**: **Transactional Outbox Pattern**을 통해 이벤트 발행의 원자성 보장.

### 1.2 처리 프로세스 (Process Flow)

1.  **Ingestion**: Kafka `raw_events` 수신.
2.  **Idempotency Check**: `processed_events` 조회. 중복 시 Skip.
3.  **Validation**: `aggregates`, `inventory`, `domain_rules` 참조하여 검증.
4.  **Transaction (Atomic)**:
    - Aggregate 업데이트 (`version` 확인).
    - `processed_events` Insert.
    - `outbox` Insert (발행할 이벤트).
5.  **Async Publication**: 별도 Polling 스레드가 `outbox`를 읽어 Kafka로 발행.

---

## 2. Server API 상세 명세

### 2.1 상태 조회 API

#### `GET /api/v1/aggregates/{id}`

- **역할**: Aggregate 상태 조회
- **영향받는 테이블**: `aggregates` (Read)
- **응답**:
  ```json
  { "aggregateId": "order_123", "version": 5, "state": { "status": "APPROVED", ... } }
  ```

### 2.2 재고 관리 API

#### `GET /api/v1/inventory/{productId}/{sellerId}`

- **역할**: 재고 조회
- **영향받는 테이블**: `inventory` (Read)
- **응답**:
  ```json
  { "currentStock": 100, "reservedStock": 10, "availableStock": 90 }
  ```

### 2.3 모니터링 API

#### `GET /api/v1/processed-events/rejected`

- **역할**: 도메인 검증 실패 이력 조회
- **영향받는 테이블**: `processed_events` (Read)
- **응답**:
  ```json
  [{ "eventId": "evt_1", "reason": "Inventory Shortage" }]
  ```

---

## 3. Kafka 토픽 상세 스펙 (Kafka Topic Specifications)

### 3.1 Input Topic: `raw_events`

- **Source**: Service A (Debezium CDC)
- **Format**: JSON (Debezium Envelope)
- **Key**: `event_id` (UUID)
- **Consumer Group**: `service-b-consumer`
- **처리 방식**: `payload` 필드를 파싱하여 `OrderPlaced` 등의 이벤트로 매핑.

### 3.2 Output Topic: `domain_events`

- **Source**: Service B (Outbox Publisher)
- **Purpose**: Service C(Query Service)를 위한 정제된 비즈니스 이벤트 스트림
- **파티션 수**: 3 (`aggregate_id` 기준 파티셔닝 필수)
- **Replication Factor**: 3
- **Key**: `aggregate_id` (예: `order_id`) -> **중요: 순서 보장**
- **Value Schema (JSON)**:
  ```json
  {
    "eventId": "uuid-...",
    "eventType": "OrderApproved",
    "aggregateId": "order_123",
    "occurredAt": "2026-01-24T10:00:00Z",
    "payload": {
      "status": "APPROVED",
      "approvedAt": "..."
    }
  }
  ```

---

## 4. 테이블 리스트 (Table Specification)

| 테이블명               | 역할               | 주요 컬럼                                    | 비고                     |
| :--------------------- | :----------------- | :------------------------------------------- | :----------------------- |
| **`aggregates`**       | 도메인 상태 저장   | `aggregate_id`, `state` (JSONB), `version`   | 낙관적 락 사용           |
| **`processed_events`** | 멱등성 보장        | `event_id`, `status`, `rejection_reason`     | 중복 방지용              |
| **`inventory`**        | 재고 원장          | `product_id`, `seller_id`, `available_stock` | 재고 검증 기준           |
| **`outbox`**           | 발행 대기열        | `outbox_id`, `payload`, `published`          | **Outbox 패턴 핵심**     |
| **`domain_rules`**     | 동적 비즈니스 규칙 | `rule_id`, `definition` (JSONB)              | 코드 수정 없이 규칙 변경 |

---

## 5. 기술 의사결정 및 설계 의도 (Technical Decisions)

### 5.1 왜 Transactional Outbox Pattern을 사용하는가?

- **이유**: **분산 트랜잭션의 원자성 보장**. "DB 업데이트"와 "Kafka 발행"은 서로 다른 시스템이라 동시에 원자적으로 처리할 수 없습니다. (2PC는 성능 저하)
- **결정**: 같은 DB 트랜잭션 안에서 `aggregates` 업데이트와 `outbox` 저장을 수행하여 원자성을 보장하고, Kafka 발행은 별도 프로세스가 `outbox`를 읽어 수행함으로써 데이터 유실을 100% 방지합니다.

### 5.2 왜 낙관적 락(Optimistic Lock)을 사용하는가?

- **이유**: **동시성 제어**. 여러 이벤트가 동시에 같은 주문(Aggregate)을 수정하려 할 때 데이터 덮어쓰기(Lost Update)를 방지해야 합니다.
- **결정**: `version` 컬럼을 사용하여 충돌 발생 시 예외를 발생시키고, 재시도하거나 DLQ로 보내 데이터 정합성을 지킵니다.

### 5.3 왜 JSONB(`state` 컬럼)를 사용하는가?

- **이유**: **유연한 스키마**. 도메인 모델이나 이벤트 구조가 변경될 때마다 테이블 스키마(DDL)를 변경하는 비용을 줄이고자 합니다.
- **결정**: PostgreSQL의 JSONB 타입을 활용하여 반정형 데이터를 저장하고 인덱싱 기능을 활용합니다.
