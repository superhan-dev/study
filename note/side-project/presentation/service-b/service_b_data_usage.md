# Service B 데이터 사용 흐름
## Command Service의 데이터 처리 완전 가이드

---

## 🎯 Service B의 역할 요약

**"Kafka에서 Raw Event를 받아서 도메인 검증을 수행하고, 검증된 Domain Event를 다시 Kafka로 발행"**

```
INPUT:  Kafka raw_events (Service A의 CDC)
PROCESS: 도메인 검증 + 상태 관리 + 재고 처리
OUTPUT: Kafka domain_events (Service C로 전달)
```

---

## 📊 Service B가 사용하는 데이터 소스

### 1. **Kafka raw_events 토픽** (주 입력)
- Service A의 events 테이블에서 CDC로 발행된 이벤트
- Service B는 이 토픽을 구독(subscribe)

### 2. **PostgreSQL B (자체 DB)**
- `aggregates` - 현재 주문/재고 상태
- `processed_events` - 처리한 이벤트 기록
- `inventory` - 재고 정보
- `outbox` - 발행 대기 이벤트
- `domain_rules` - 비즈니스 규칙

### 3. **외부 참조 데이터** (필요 시)
- 고객 정보, 셀러 정보 등
- 현재 Phase에서는 미사용

---

## 🔄 Service B의 전체 데이터 흐름

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Kafka에서 이벤트 수신                               │
├─────────────────────────────────────────────────────────────┤
│  Kafka raw_events 토픽                                       │
│  {                                                           │
│    "op": "c",  // CDC operation (create)                    │
│    "after": {                                                │
│      "event_id": "uuid-001",                                 │
│      "event_type": "OrderPlaced",                            │
│      "aggregate_id": "order_abc123",                         │
│      "payload": {                                            │
│        "customerId": "customer_456",                         │
│        "sellerId": "seller_789",                             │
│        "productId": "product_001",                           │
│        "quantity": 2,                                        │
│        "price": 149.90                                       │
│      },                                                      │
│      "occurred_at": "2017-05-13T14:23:11Z",                 │
│      "replay_job_id": "replay_001"                          │
│    }                                                         │
│  }                                                           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: 멱등성 체크 (중복 처리 방지)                        │
├─────────────────────────────────────────────────────────────┤
│  SELECT * FROM processed_events                              │
│  WHERE event_id = 'uuid-001';                               │
│                                                              │
│  결과 있음 → 이미 처리함 → 스킵 ⏭️                          │
│  결과 없음 → 처음 처리 → 계속 진행 ▼                        │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: Aggregate 로딩 (현재 상태 조회)                     │
├─────────────────────────────────────────────────────────────┤
│  SELECT * FROM aggregates                                    │
│  WHERE aggregate_id = 'order_abc123';                       │
│                                                              │
│  결과 있음 → 기존 주문 (상태 전이)                          │
│  결과 없음 → 신규 주문 (초기 상태) ⭐                       │
│                                                              │
│  신규 주문 생성:                                             │
│  {                                                           │
│    "aggregate_id": "order_abc123",                          │
│    "aggregate_type": "Order",                               │
│    "state": {                                                │
│      "orderId": "order_abc123",                             │
│      "status": "PLACED",  // 초기 상태                      │
│      "customerId": "customer_456",                          │
│      "sellerId": "seller_789",                              │
│      "items": [                                              │
│        {                                                     │
│          "productId": "product_001",                        │
│          "quantity": 2,                                      │
│          "price": 149.90                                     │
│        }                                                     │
│      ],                                                      │
│      "timeline": {                                           │
│        "placedAt": "2017-05-13T14:23:11Z"                  │
│      }                                                       │
│    },                                                        │
│    "version": 1                                              │
│  }                                                           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 4: 도메인 검증                                         │
├─────────────────────────────────────────────────────────────┤
│  4-1. 상태 전이 검증 (domain_rules 참조)                    │
│       - PLACED → APPROVED? ✅ 가능                          │
│       - SHIPPED → PLACED? ❌ 불가능 (역행)                  │
│                                                              │
│  4-2. 재고 확인 (inventory 테이블 조회)                     │
│       SELECT * FROM inventory                                │
│       WHERE product_id = 'product_001'                       │
│         AND seller_id = 'seller_789';                        │
│                                                              │
│       available_stock >= 2? ✅ 충분                         │
│       available_stock < 2? ❌ 재고 부족                     │
│                                                              │
│  4-3. 시간 역행 검증                                         │
│       occurred_at > last_event_time? ✅ 정상                │
│       occurred_at <= last_event_time? ❌ 시간 역행          │
│                                                              │
│  검증 실패 → Step 8 (거부 처리)                              │
│  검증 성공 → Step 5 (처리 계속) ▼                           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 5: 단일 트랜잭션 실행 (원자성 보장)                    │
├─────────────────────────────────────────────────────────────┤
│  BEGIN TRANSACTION;                                          │
│                                                              │
│  ① aggregates 업데이트                                      │
│     UPDATE aggregates                                        │
│     SET                                                      │
│       state = jsonb_set(                                     │
│         state,                                               │
│         '{status}',                                          │
│         '"APPROVED"'                                         │
│       ),                                                     │
│       state = jsonb_set(                                     │
│         state,                                               │
│         '{timeline,approvedAt}',                             │
│         '"2017-05-13T15:10:22Z"'                            │
│       ),                                                     │
│       version = version + 1,                                 │
│       last_event_id = 'uuid-002',                           │
│       last_event_type = 'OrderApproved',                    │
│       last_updated_at = NOW()                                │
│     WHERE aggregate_id = 'order_abc123'                     │
│       AND version = 1;  -- Optimistic Lock                  │
│                                                              │
│  ② processed_events 기록                                    │
│     INSERT INTO processed_events (                           │
│       event_id,                                              │
│       aggregate_id,                                          │
│       event_type,                                            │
│       processing_status,                                     │
│       processed_at                                           │
│     ) VALUES (                                               │
│       'uuid-002',                                            │
│       'order_abc123',                                        │
│       'OrderApproved',                                       │
│       'SUCCESS',                                             │
│       NOW()                                                  │
│     );                                                       │
│                                                              │
│  ③ inventory 업데이트 (재고 예약)                            │
│     UPDATE inventory                                         │
│     SET                                                      │
│       reserved_stock = reserved_stock + 2,                   │
│       version = version + 1,                                 │
│       last_updated_at = NOW()                                │
│     WHERE product_id = 'product_001'                         │
│       AND seller_id = 'seller_789'                           │
│       AND version = 5;  -- Optimistic Lock                  │
│                                                              │
│  ④ outbox 삽입 (Domain Event 발행 준비)                     │
│     INSERT INTO outbox (                                     │
│       outbox_id,                                             │
│       event_type,                                            │
│       event_payload,                                         │
│       destination_topic,                                     │
│       aggregate_id,                                          │
│       correlation_id,                                        │
│       created_at                                             │
│     ) VALUES (                                               │
│       'outbox-uuid-001',                                     │
│       'OrderApproved',                                       │
│       '{                                                     │
│         "orderId": "order_abc123",                          │
│         "customerId": "customer_456",                       │
│         "sellerId": "seller_789",                           │
│         "approvedAt": "2017-05-13T15:10:22Z",              │
│         "items": [...]                                       │
│       }',                                                    │
│       'domain_events',                                       │
│       'order_abc123',                                        │
│       'correlation-uuid-001',                                │
│       NOW()                                                  │
│     );                                                       │
│                                                              │
│  COMMIT;  -- 모두 성공하거나 모두 롤백                       │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 6: Outbox Publisher (별도 스레드)                      │
├─────────────────────────────────────────────────────────────┤
│  1초마다 실행:                                               │
│                                                              │
│  SELECT * FROM outbox                                        │
│  WHERE published = false                                     │
│  ORDER BY created_at ASC                                     │
│  LIMIT 100;                                                  │
│                                                              │
│  각 메시지를 Kafka domain_events 토픽으로 발행:             │
│                                                              │
│  kafkaTemplate.send(                                         │
│    "domain_events",                                          │
│    "order_abc123",  // key                                   │
│    '{                                                        │
│      "eventType": "OrderApproved",                          │
│      "orderId": "order_abc123",                             │
│      "customerId": "customer_456",                          │
│      "sellerId": "seller_789",                              │
│      "approvedAt": "2017-05-13T15:10:22Z"                   │
│    }'                                                        │
│  );                                                          │
│                                                              │
│  발행 성공 시:                                               │
│  UPDATE outbox                                               │
│  SET published = true, published_at = NOW()                  │
│  WHERE outbox_id = 'outbox-uuid-001';                       │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 7: 완료 (Service C로 전달됨)                           │
├─────────────────────────────────────────────────────────────┤
│  Kafka domain_events 토픽에 이벤트 발행 완료                 │
│  → Service C가 구독하여 Projection 업데이트                  │
└─────────────────────────────────────────────────────────────┘


                  OR


┌─────────────────────────────────────────────────────────────┐
│  Step 8: 검증 실패 (거부 처리)                               │
├─────────────────────────────────────────────────────────────┤
│  BEGIN TRANSACTION;                                          │
│                                                              │
│  ① processed_events 기록 (REJECTED)                         │
│     INSERT INTO processed_events (                           │
│       event_id,                                              │
│       aggregate_id,                                          │
│       event_type,                                            │
│       processing_status,                                     │
│       rejection_reason,                                      │
│       processed_at                                           │
│     ) VALUES (                                               │
│       'uuid-003',                                            │
│       'order_abc123',                                        │
│       'OrderShipped',                                        │
│       'REJECTED',                                            │
│       '재고 부족: 가용=0, 필요=2',                            │
│       NOW()                                                  │
│     );                                                       │
│                                                              │
│  ② outbox 삽입 (거부 이벤트 발행)                            │
│     INSERT INTO outbox (                                     │
│       outbox_id,                                             │
│       event_type,                                            │
│       event_payload,                                         │
│       destination_topic,                                     │
│       aggregate_id,                                          │
│       created_at                                             │
│     ) VALUES (                                               │
│       'outbox-uuid-002',                                     │
│       'OrderRejected',                                       │
│       '{                                                     │
│         "orderId": "order_abc123",                          │
│         "reason": "재고 부족",                               │
│         "rejectedAt": "2017-05-13T15:15:00Z"                │
│       }',                                                    │
│       'domain_events',                                       │
│       'order_abc123',                                        │
│       NOW()                                                  │
│     );                                                       │
│                                                              │
│  COMMIT;                                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 💾 Service B의 데이터 변화 예시

### 시나리오: 주문 생성 → 승인 → 출고

#### 이벤트 1: OrderPlaced

**Kafka raw_events 수신**:
```json
{
  "event_id": "uuid-001",
  "event_type": "OrderPlaced",
  "aggregate_id": "order_abc123",
  "payload": {
    "customerId": "customer_456",
    "sellerId": "seller_789",
    "productId": "product_001",
    "quantity": 2
  }
}
```

**Service B 처리 후 DB 상태**:

**aggregates 테이블**:
```sql
aggregate_id  | aggregate_type | state                                      | version
order_abc123  | Order          | {"status":"PLACED","items":[...]}          | 1
```

**processed_events 테이블**:
```sql
event_id | aggregate_id | processing_status | rejection_reason
uuid-001 | order_abc123 | SUCCESS           | NULL
```

**inventory 테이블**: (변화 없음, 승인 시에만 예약)
```sql
product_id   | seller_id   | current_stock | reserved_stock | available_stock
product_001  | seller_789  | 100           | 0              | 100
```

**outbox 테이블**:
```sql
outbox_id       | event_type   | event_payload                   | published
outbox-uuid-001 | OrderPlaced  | {"orderId":"order_abc123",...}  | false
```

---

#### 이벤트 2: OrderApproved

**Kafka raw_events 수신**:
```json
{
  "event_id": "uuid-002",
  "event_type": "OrderApproved",
  "aggregate_id": "order_abc123"
}
```

**Service B 처리 후 DB 상태**:

**aggregates 테이블** (상태 변경):
```sql
aggregate_id  | state                                                      | version
order_abc123  | {"status":"APPROVED","timeline":{"approvedAt":"..."}}      | 2 ⬆️
```

**processed_events 테이블** (이벤트 추가):
```sql
event_id | aggregate_id | processing_status | rejection_reason
uuid-001 | order_abc123 | SUCCESS           | NULL
uuid-002 | order_abc123 | SUCCESS           | NULL ⬅️ 추가
```

**inventory 테이블** (재고 예약):
```sql
product_id   | seller_id   | current_stock | reserved_stock | available_stock | version
product_001  | seller_789  | 100           | 2 ⬆️           | 98 ⬇️           | 6 ⬆️
```

**outbox 테이블** (Domain Event 추가):
```sql
outbox_id       | event_type      | event_payload                      | published
outbox-uuid-001 | OrderPlaced     | {"orderId":"order_abc123",...}     | true ✅
outbox-uuid-002 | OrderApproved   | {"orderId":"order_abc123",...}     | false ⬅️ 추가
```

---

#### 이벤트 3: OrderShipped

**Kafka raw_events 수신**:
```json
{
  "event_id": "uuid-003",
  "event_type": "OrderShipped",
  "aggregate_id": "order_abc123",
  "payload": {
    "shippedAt": "2017-05-15T09:30:45Z"
  }
}
```

**Service B 처리 후 DB 상태**:

**aggregates 테이블** (상태 변경):
```sql
aggregate_id  | state                                                         | version
order_abc123  | {"status":"SHIPPED","timeline":{"shippedAt":"..."}}           | 3 ⬆️
```

**processed_events 테이블** (이벤트 추가):
```sql
event_id | aggregate_id | processing_status
uuid-001 | order_abc123 | SUCCESS
uuid-002 | order_abc123 | SUCCESS
uuid-003 | order_abc123 | SUCCESS ⬅️ 추가
```

**inventory 테이블** (실제 재고 차감):
```sql
product_id   | seller_id   | current_stock | reserved_stock | available_stock | version
product_001  | seller_789  | 98 ⬇️          | 0 ⬇️           | 98              | 7 ⬆️
```

**outbox 테이블** (Domain Event 추가):
```sql
outbox_id       | event_type      | published
outbox-uuid-001 | OrderPlaced     | true
outbox-uuid-002 | OrderApproved   | true ✅
outbox-uuid-003 | OrderShipped    | false ⬅️ 추가
```

---

## 🔍 Service B가 데이터를 "어떻게" 사용하는지

### 1. Kafka raw_events (읽기 전용)

**사용 방법**: Kafka Consumer
```java
@KafkaListener(topics = "raw_events", groupId = "service-b-consumer")
public void consumeRawEvent(String message) {
    RawEvent event = parseEvent(message);
    eventProcessor.process(event);
}
```

**데이터 예시**:
```json
{
  "event_id": "uuid-001",
  "event_type": "OrderPlaced",
  "aggregate_id": "order_abc123",
  "payload": {...},
  "occurred_at": "2017-05-13T14:23:11Z"
}
```

**용도**:
- 이벤트 수신의 유일한 입구
- Service B는 이 토픽만 구독
- Service A의 events 테이블과 동기화됨 (CDC)

---

### 2. aggregates 테이블 (읽기 + 쓰기)

**사용 방법**: JPA/Hibernate
```java
// 조회
Optional<Aggregate> aggregate = aggregateRepository
    .findById("order_abc123");

// 업데이트
aggregate.apply(event);
aggregateRepository.save(aggregate);  // version++
```

**데이터 예시**:
```json
{
  "aggregate_id": "order_abc123",
  "aggregate_type": "Order",
  "state": {
    "orderId": "order_abc123",
    "status": "APPROVED",
    "customerId": "customer_456",
    "sellerId": "seller_789",
    "items": [...]
  },
  "version": 2
}
```

**용도**:
- 현재 주문 상태 저장
- 상태 전이 검증 ("지금 SHIPPED인데 APPROVED로 바꿀 수 있나?")
- Optimistic Lock (동시성 제어)

---

### 3. processed_events 테이블 (읽기 + 쓰기)

**사용 방법**: 중복 체크
```java
// 조회 (이미 처리했는지 확인)
boolean isProcessed = processedEventRepository
    .existsById(event.getEventId());

if (isProcessed) {
    log.info("Event already processed, skipping");
    return;
}

// 삽입 (처리 완료 기록)
processedEventRepository.save(
    new ProcessedEvent(event.getEventId(), "SUCCESS")
);
```

**데이터 예시**:
```sql
event_id | aggregate_id | processing_status | rejection_reason
uuid-001 | order_abc123 | SUCCESS           | NULL
uuid-002 | order_abc123 | REJECTED          | 재고 부족
```

**용도**:
- 멱등성 보장 (같은 이벤트 두 번 처리 안 함)
- Kafka 재전송 대응
- 거부된 이벤트 분석

---

### 4. inventory 테이블 (읽기 + 쓰기)

**사용 방법**: 재고 확인 및 예약
```java
// 조회
Inventory inventory = inventoryRepository
    .findByProductAndSeller(productId, sellerId);

// 재고 확인
if (inventory.getAvailableStock() < quantity) {
    throw new OutOfStockException();
}

// 예약
inventory.reserve(quantity);
inventoryRepository.save(inventory);  // version++
```

**데이터 예시**:
```sql
product_id   | seller_id   | current_stock | reserved_stock | available_stock
product_001  | seller_789  | 100           | 2              | 98
```

**용도**:
- 재고 가용성 확인
- 주문 승인 시 재고 예약
- 출고 시 실제 재고 차감
- Optimistic Lock (재고 경합 방지)

---

### 5. outbox 테이블 (쓰기 + 읽기)

**사용 방법**: 이벤트 발행 준비
```java
// 삽입 (트랜잭션 내)
OutboxMessage message = OutboxMessage.builder()
    .eventType("OrderApproved")
    .eventPayload(domainEvent.toJson())
    .destinationTopic("domain_events")
    .build();

outboxRepository.save(message);

// Outbox Publisher가 조회
List<OutboxMessage> unpublished = outboxRepository
    .findTop100ByPublishedFalse();

// 발행 후 업데이트
message.setPublished(true);
outboxRepository.save(message);
```

**데이터 예시**:
```sql
outbox_id       | event_type    | event_payload           | published
outbox-uuid-001 | OrderApproved | {"orderId":"...",...}   | false
```

**용도**:
- Domain Event 발행 대기열
- Kafka 발행과 DB 트랜잭션 분리
- At-least-once 보장

---

### 6. domain_rules 테이블 (읽기 전용)

**사용 방법**: 비즈니스 규칙 조회
```java
// 상태 전이 규칙 조회
List<DomainRule> rules = domainRuleRepository
    .findByRuleTypeAndIsActive("STATE_TRANSITION", true);

// 규칙 적용
for (DomainRule rule : rules) {
    if (rule.matches(fromState, toState)) {
        rule.validate(aggregate);
    }
}
```

**데이터 예시**:
```json
{
  "rule_id": "state_transition_001",
  "rule_type": "STATE_TRANSITION",
  "rule_definition": {
    "from": "APPROVED",
    "to": "SHIPPED",
    "conditions": [
      "inventory.available_stock > 0"
    ]
  },
  "is_active": true
}
```

**용도**:
- 동적 비즈니스 규칙 관리
- 상태 전이 검증
- 코드 수정 없이 규칙 변경

---

## 📈 데이터 흐름 타임라인

### T=0: 이벤트 수신
```
Kafka raw_events → Service B Consumer
```

### T=10ms: 멱등성 체크
```
processed_events 테이블 조회
→ 없음 (처음 처리)
```

### T=20ms: Aggregate 로딩
```
aggregates 테이블 조회
→ 있음 (version=1, status=PLACED)
```

### T=30ms: 재고 확인
```
inventory 테이블 조회
→ available_stock=98 ✅
```

### T=40ms: 도메인 검증
```
domain_rules 테이블 조회
→ PLACED → APPROVED 허용 ✅
```

### T=50ms: 트랜잭션 시작
```
BEGIN TRANSACTION;
```

### T=60ms: Aggregate 업데이트
```
aggregates UPDATE (version=2, status=APPROVED)
```

### T=70ms: 이벤트 기록
```
processed_events INSERT (SUCCESS)
```

### T=80ms: 재고 예약
```
inventory UPDATE (reserved_stock=2)
```

### T=90ms: Outbox 삽입
```
outbox INSERT (OrderApproved)
```

### T=100ms: 트랜잭션 커밋
```
COMMIT;
```

### T=110ms: 처리 완료
```
Kafka Consumer ACK
```

### T=1000ms: Outbox Publisher (별도 스레드)
```
outbox 조회 → Kafka domain_events 발행
```

---

## 🔄 Service B 핵심 로직 (Java 코드)

```java
@Service
public class EventProcessor {
    
    @Transactional
    public void process(RawEvent rawEvent) {
        // 1. 멱등성 체크
        if (processedEventRepository.existsById(rawEvent.getEventId())) {
            return;  // 이미 처리함
        }
        
        // 2. Aggregate 로딩
        Aggregate aggregate = aggregateRepository
            .findById(rawEvent.getAggregateId())
            .orElseGet(() -> createNewAggregate(rawEvent));
        
        try {
            // 3. 도메인 검증
            validateStateTransition(aggregate, rawEvent);
            validateInventory(rawEvent);
            
            // 4. Aggregate 업데이트
            DomainEvent domainEvent = aggregate.apply(rawEvent);
            aggregateRepository.save(aggregate);
            
            // 5. 재고 처리
            if (rawEvent.getEventType().equals("OrderApproved")) {
                reserveInventory(rawEvent);
            }
            
            // 6. 처리 완료 기록
            processedEventRepository.save(
                new ProcessedEvent(rawEvent.getEventId(), "SUCCESS")
            );
            
            // 7. Outbox 삽입
            outboxRepository.save(
                new OutboxMessage(
                    domainEvent.getEventType(),
                    domainEvent.toJson(),
                    "domain_events"
                )
            );
            
        } catch (DomainException e) {
            // 8. 검증 실패 시 거부 기록
            processedEventRepository.save(
                new ProcessedEvent(
                    rawEvent.getEventId(),
                    "REJECTED",
                    e.getMessage()
                )
            );
        }
    }
}
```

---

## ✅ 요약

### Service B가 사용하는 데이터

| 데이터 소스 | 용도 | 읽기/쓰기 |
|------------|------|----------|
| Kafka raw_events | 이벤트 수신 | 읽기 |
| aggregates | 주문 상태 관리 | 읽기 + 쓰기 |
| processed_events | 멱등성 보장 | 읽기 + 쓰기 |
| inventory | 재고 관리 | 읽기 + 쓰기 |
| outbox | 이벤트 발행 | 쓰기 + 읽기 |
| domain_rules | 비즈니스 규칙 | 읽기 |

### 처리 흐름
```
1. Kafka 수신
2. 중복 체크 (processed_events)
3. 상태 조회 (aggregates)
4. 도메인 검증 (inventory, domain_rules)
5. 트랜잭션 실행 (aggregates, processed_events, inventory, outbox)
6. Outbox 발행 (Kafka domain_events)
```

### 핵심 원칙
- **멱등성**: 같은 이벤트 두 번 처리 안 함
- **원자성**: 단일 트랜잭션으로 모든 변경
- **격리성**: Optimistic Lock으로 동시성 제어
- **발행 보장**: Outbox Pattern으로 At-least-once

---

**Service B는 Kafka에서 받은 이벤트를 검증하고, 자체 DB에서 상태를 관리하며, 다시 Kafka로 발행합니다!** 🎯
