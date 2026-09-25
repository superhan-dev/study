# Service B - Domain Event Translator (Command Service) 상세 기획서

## 도메인 로직 실행 및 상태 관리 서비스

---

## 📋 문서 개요

### Domain Event Translator의 역할

**"Raw Event를 받아서 도메인 검증을 수행하고, Domain Event를 발행하는 중간 계층"**

```
Input:  Kafka raw_events (Service A의 CDC)
Process: 도메인 검증 + 상태 관리
Output: Kafka domain_events (Service C로 전달)
```

---

## 🎯 핵심 책임

1. **이벤트 소비** - Kafka `raw_events` 토픽 구독
2. **도메인 검증** - 비즈니스 규칙에 맞는지 확인
3. **상태 관리** - Aggregate 패턴으로 주문/재고 상태 유지
4. **이벤트 발행** - 검증된 Domain Event를 Kafka로 발행

---

## 🗄️ Database B 테이블 상세 설명

### 1. `aggregates` 테이블

#### 역할

**도메인 객체의 현재 상태를 저장**하는 핵심 테이블

#### 왜 필요한가?

- 이벤트를 검증하려면 "현재 주문이 어떤 상태인지" 알아야 함
- 예: "SHIPPED 상태인 주문을 다시 APPROVED로 바꿀 수 없다"

#### 저장 내용

```
- aggregate_id: 주문 ID 또는 재고 ID
- aggregate_type: "Order", "Inventory" 등
- state: 현재 상태 (JSONB - 유연한 구조)
- version: 동시성 제어용 (Optimistic Lock)
- last_event_id: 마지막 처리한 이벤트
```

#### 예시 데이터

```json
{
  "aggregate_id": "order_abc123",
  "aggregate_type": "Order",
  "state": {
    "orderId": "abc123",
    "status": "APPROVED",
    "customerId": "customer_456",
    "sellerId": "seller_789",
    "timeline": {
      "purchasedAt": "2017-05-13T14:23:11Z",
      "approvedAt": "2017-05-13T15:10:22Z"
    }
  },
  "version": 2
}
```

#### 언제 사용?

```java
// 1. 이벤트 처리 시 Aggregate 로딩
Aggregate order = aggregateRepository.findById("order_abc123");

// 2. 현재 상태 확인
if (order.getState().getStatus().equals("SHIPPED")) {
    throw new InvalidStateTransitionException();
}

// 3. 상태 업데이트
order.apply(new OrderShippedEvent());
aggregateRepository.save(order);  // version++
```

#### 동시성 제어

```sql
-- Optimistic Lock: version 체크
UPDATE aggregates
SET state = {...}, version = version + 1
WHERE aggregate_id = 'order_abc123'
  AND version = 2;  -- 현재 버전과 일치해야 성공

-- 다른 트랜잭션이 먼저 version을 3으로 올렸다면?
-- → 0 rows affected → 재시도 필요
```

---

### 2. `processed_events` 테이블

#### 역할

**이미 처리한 이벤트를 기록하여 중복 처리 방지 (멱등성 보장)**

#### 왜 필요한가?

- Kafka는 "At-least-once" 보장 → 같은 메시지를 여러 번 받을 수 있음
- CDC 재전송 시에도 중복 처리 방지

#### 저장 내용

```
- event_id: 처리한 이벤트 ID (Primary Key)
- aggregate_id: 어떤 주문/재고에 대한 이벤트인지
- processing_status: SUCCESS, REJECTED, FAILED
- rejection_reason: 왜 거부했는지 (도메인 검증 실패 이유)
```

#### 처리 흐름

```java
@Transactional
public void handleEvent(Event event) {
    // 1. 이미 처리했는지 확인
    if (processedEventRepository.existsById(event.getEventId())) {
        log.info("Event {} already processed, skipping", event.getEventId());
        return;  // 중복 → 스킵
    }

    // 2. 도메인 로직 실행
    try {
        Aggregate aggregate = loadAggregate(event.getAggregateId());
        aggregate.apply(event);
        aggregateRepository.save(aggregate);

        // 3. 성공 기록
        processedEventRepository.save(new ProcessedEvent(
            event.getEventId(),
            event.getAggregateId(),
            ProcessingStatus.SUCCESS
        ));

    } catch (DomainException e) {
        // 4. 실패 기록 (거부 이유 저장)
        processedEventRepository.save(new ProcessedEvent(
            event.getEventId(),
            event.getAggregateId(),
            ProcessingStatus.REJECTED,
            e.getMessage()  // "재고 부족" 등
        ));
    }
}
```

#### 예시 데이터

```sql
SELECT * FROM processed_events;

-- event_id                               | aggregate_id | processing_status | rejection_reason
-- uuid-001                               | order_abc    | SUCCESS           | NULL
-- uuid-002                               | order_abc    | REJECTED          | 상태 전이 불가: SHIPPED → APPROVED
-- uuid-003                               | order_xyz    | SUCCESS           | NULL
```

#### 쿼리 예시

```sql
-- 거부된 이벤트 분석
SELECT
    rejection_reason,
    COUNT(*) AS count
FROM processed_events
WHERE processing_status = 'REJECTED'
GROUP BY rejection_reason
ORDER BY count DESC;

-- 결과:
-- rejection_reason                | count
-- 재고 부족                       | 1,234
-- 상태 전이 불가                  | 567
-- 시간 역행                       | 89
```

---

### 3. `inventory` 테이블

#### 역할

**제품별, 셀러별 재고 수량을 실시간으로 관리**

#### 왜 필요한가?

- "이 셀러에게 이 상품 재고가 있는가?" 확인
- 주문 시 재고 예약 → 출고 시 재고 차감

#### 저장 내용

```
- product_id, seller_id: 복합 키
- current_stock: 실제 재고
- reserved_stock: 주문됐으나 아직 출고 안 됨
- available_stock: current - reserved (계산 컬럼)
- safety_stock: 안전 재고 (이 아래로 떨어지면 알림)
- version: 동시성 제어
```

#### 재고 상태 전이

```
1. 주문 승인 (OrderApproved)
   → reserved_stock += 1
   → available_stock 감소 (자동)

2. 출고 완료 (OrderShipped)
   → current_stock -= 1
   → reserved_stock -= 1
   → available_stock 변화 없음

3. 주문 취소 (OrderCancelled)
   → reserved_stock -= 1
   → available_stock 증가 (복구)
```

#### 예시 코드

```java
@Transactional
public void handleOrderApproved(OrderApprovedEvent event) {
    // 1. 재고 조회
    Inventory inventory = inventoryRepository.findByProductAndSeller(
        event.getProductId(),
        event.getSellerId()
    );

    // 2. 가용 재고 확인
    if (inventory.getAvailableStock() < event.getQuantity()) {
        throw new OutOfStockException("재고 부족");
    }

    // 3. 재고 예약 (Optimistic Lock)
    inventory.reserve(event.getQuantity());
    inventoryRepository.save(inventory);  // version++
}
```

#### 예시 데이터

```sql
SELECT * FROM inventory WHERE seller_id = 'seller_789';

-- product_id | seller_id   | current_stock | reserved_stock | available_stock | version
-- prod_001   | seller_789  | 100           | 20             | 80              | 45
-- prod_002   | seller_789  | 50            | 5              | 45              | 12
-- prod_003   | seller_789  | 10            | 10             | 0               | 8
```

#### 동시성 시나리오

```
상황: 같은 상품에 2개 주문이 거의 동시에 들어옴
현재 재고: available_stock = 1

Transaction A:
  1. SELECT available_stock = 1 (version=10)
  2. 재고 확인: 1 >= 1 ✅
  3. UPDATE reserved_stock = reserved_stock + 1
     WHERE version = 10
  → 성공 (version=11)

Transaction B:
  1. SELECT available_stock = 1 (version=10) - 동시 읽기
  2. 재고 확인: 1 >= 1 ✅
  3. UPDATE reserved_stock = reserved_stock + 1
     WHERE version = 10
  → 실패! (이미 version=11)
  → OptimisticLockException 발생
  → 재시도 → available_stock = 0 확인 → OutOfStockException
```

---

### 4. `outbox` 테이블

#### 역할

**Domain Event를 Kafka로 안전하게 발행하기 위한 중간 저장소**

#### 왜 필요한가?

**문제 상황**:

```java
// ❌ 이렇게 하면 안 됨!
@Transactional
public void handleEvent(Event event) {
    aggregateRepository.save(aggregate);  // DB 저장
    kafkaTemplate.send("domain_events", domainEvent);  // Kafka 발행

    // 만약 Kafka 발행은 성공했는데 DB 커밋이 실패하면?
    // 또는 DB는 성공했는데 Kafka 발행이 실패하면?
    // → 데이터 불일치!
}
```

**Outbox 패턴 해결책**:

```java
// ✅ 올바른 방법
@Transactional
public void handleEvent(Event event) {
    // 1. Aggregate 업데이트
    aggregateRepository.save(aggregate);

    // 2. Outbox에 발행할 이벤트 저장 (같은 트랜잭션)
    outboxRepository.save(new OutboxMessage(
        "OrderApproved",
        domainEvent.toJson(),
        "domain_events"
    ));

    // COMMIT: 둘 다 성공하거나 둘 다 실패 (원자성 보장)
}

// 별도 스레드에서 Outbox Publisher 실행
@Scheduled(fixedDelay = 1000)
public void publishOutboxMessages() {
    List<OutboxMessage> unpublished = outboxRepository.findByPublishedFalse();

    for (OutboxMessage msg : unpublished) {
        kafkaTemplate.send(msg.getTopic(), msg.getPayload());

        msg.setPublished(true);
        outboxRepository.save(msg);
    }
}
```

#### 저장 내용

```
- outbox_id: UUID
- event_type: "OrderApproved", "OrderShipped" 등
- event_payload: Domain Event 전체 데이터 (JSONB)
- destination_topic: "domain_events"
- published: false → true (발행 완료 시)
- retry_count: 재시도 횟수
```

#### 예시 데이터

```sql
SELECT * FROM outbox WHERE published = false;

-- outbox_id | event_type     | destination_topic | published | retry_count | created_at
-- uuid-001  | OrderApproved  | domain_events     | false     | 0           | 2026-01-24 10:30
-- uuid-002  | OrderShipped   | domain_events     | false     | 2           | 2026-01-24 10:32
```

#### Outbox Publisher 로직

```java
@Component
public class OutboxPublisher {

    @Scheduled(fixedDelay = 1000)  // 1초마다 실행
    public void publishPendingMessages() {
        List<OutboxMessage> messages = outboxRepository
            .findTop100ByPublishedFalseOrderByCreatedAtAsc();

        for (OutboxMessage msg : messages) {
            try {
                // Kafka 발행
                kafkaTemplate.send(
                    msg.getDestinationTopic(),
                    msg.getEventPayload()
                ).get(5, TimeUnit.SECONDS);  // 5초 타임아웃

                // 발행 성공
                msg.setPublished(true);
                msg.setPublishedAt(LocalDateTime.now());
                outboxRepository.save(msg);

            } catch (Exception e) {
                // 발행 실패
                msg.incrementRetryCount();
                msg.setLastError(e.getMessage());

                if (msg.getRetryCount() >= msg.getMaxRetries()) {
                    // DLQ(Dead Letter Queue)로 이동
                    dlqRepository.save(msg);
                    outboxRepository.delete(msg);
                }

                outboxRepository.save(msg);
            }
        }
    }
}
```

#### 장점

1. **원자성**: Aggregate 업데이트와 이벤트 발행이 항상 함께 성공/실패
2. **재시도**: 발행 실패 시 자동 재시도
3. **순서 보장**: created_at 순으로 발행
4. **모니터링**: 발행 실패 이벤트 추적 가능

---

### 5. `domain_rules` 테이블

#### 역할

**도메인 검증 규칙을 데이터베이스에 저장하여 동적으로 관리**

#### 왜 필요한가?

- 비즈니스 규칙이 자주 변경될 때 코드 수정 없이 DB만 수정
- 리플레이별로 다른 규칙 적용 가능

#### 저장 내용

```
- rule_id: 규칙 ID
- rule_type: STATE_TRANSITION, SLA_CHECK, INVENTORY_POLICY
- rule_definition: 규칙 내용 (JSONB)
- is_active: 활성화 여부
- priority: 우선순위
```

#### 예시 1: 상태 전이 규칙

```json
{
  "rule_id": "order_state_transition_001",
  "rule_type": "STATE_TRANSITION",
  "rule_definition": {
    "from": "APPROVED",
    "to": "SHIPPED",
    "conditions": [
      "inventory.available_stock > 0",
      "seller.status == 'ACTIVE'",
      "payment.status == 'CONFIRMED'"
    ],
    "actions": ["inventory.reserve_stock", "notify_customer", "log_shipment"]
  },
  "is_active": true
}
```

#### 예시 2: SLA 체크 규칙

```json
{
  "rule_id": "sla_check_001",
  "rule_type": "SLA_CHECK",
  "rule_definition": {
    "max_prep_hours": 48,
    "condition": "approved_at + 48 hours < NOW()",
    "action": "send_sla_violation_alert",
    "severity": "HIGH"
  },
  "is_active": true
}
```

#### 사용 예시

```java
@Service
public class DomainRuleEngine {

    public void validateStateTransition(
        String fromState,
        String toState,
        Aggregate aggregate
    ) {
        // 1. 적용 가능한 규칙 조회
        List<DomainRule> rules = domainRuleRepository
            .findByRuleTypeAndIsActive("STATE_TRANSITION", true);

        // 2. 규칙 필터링
        for (DomainRule rule : rules) {
            JsonNode def = rule.getDefinition();

            if (def.get("from").asText().equals(fromState) &&
                def.get("to").asText().equals(toState)) {

                // 3. 조건 검증
                for (JsonNode condition : def.get("conditions")) {
                    if (!evaluateCondition(condition.asText(), aggregate)) {
                        throw new RuleViolationException(
                            "Condition failed: " + condition.asText()
                        );
                    }
                }

                // 4. 액션 실행
                for (JsonNode action : def.get("actions")) {
                    executeAction(action.asText(), aggregate);
                }
            }
        }
    }

    private boolean evaluateCondition(String condition, Aggregate aggregate) {
        // "inventory.available_stock > 0" 파싱 및 평가
        // SpEL (Spring Expression Language) 활용 가능
        return true;
    }
}
```

#### 장점

1. **유연성**: 코드 배포 없이 규칙 변경
2. **A/B 테스트**: 리플레이별로 다른 규칙 적용
3. **감사**: 규칙 변경 이력 추적

---

## 🔄 Domain Event Translator의 전체 처리 흐름

### Step-by-Step 처리 과정

```
┌─────────────────────────────────────────────────────────────┐
│  1. Kafka Consumer: raw_events 토픽에서 이벤트 수신         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  2. 멱등성 체크: processed_events 테이블 확인                │
│     - 이미 처리했나? → YES: 스킵                            │
│                      → NO: 계속 진행                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Aggregate 로딩: aggregates 테이블에서 현재 상태 조회    │
│     - 없으면 신규 생성                                       │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  4. 도메인 검증 (domain_rules 활용)                         │
│     - 상태 전이 가능한가?                                    │
│     - 재고 충분한가? (inventory 테이블 확인)                 │
│     - 시간 역행 없는가?                                      │
│     - SLA 위반 아닌가?                                       │
└─────────────────┬───────────────────────────────────────────┘
                  │
            ┌─────┴─────┐
            │           │
       검증 실패    검증 성공
            │           │
            ▼           ▼
┌──────────────────┐  ┌──────────────────────────────────────┐
│  거부 처리        │  │  5. 단일 트랜잭션 실행                 │
│                  │  │                                       │
│  processed_events│  │  BEGIN TRANSACTION;                  │
│  에 REJECTED 기록│  │                                       │
│                  │  │  ① aggregates 업데이트 (상태 변경)   │
│  Outbox에        │  │  ② processed_events 기록 (SUCCESS)   │
│  RejectionEvent  │  │  ③ inventory 차감 (필요 시)          │
│  저장            │  │  ④ outbox 삽입 (Domain Event)        │
│                  │  │                                       │
└──────────────────┘  │  COMMIT;                              │
                      └──────────────┬────────────────────────┘
                                     │
                                     ▼
                      ┌──────────────────────────────────────┐
                      │  6. Outbox Publisher (별도 스레드)    │
                      │                                       │
                      │  - outbox 테이블 폴링                 │
                      │  - Kafka domain_events 발행           │
                      │  - published = true 업데이트          │
                      └──────────────┬────────────────────────┘
                                     │
                                     ▼
                                   Kafka
                            (domain_events 토픽)
                                     │
                                     ▼
                                 Service C
```

---

## 💻 핵심 구현 로직

### 1. Kafka Consumer 구현

```java
@Service
public class RawEventConsumer {

    private final EventProcessor eventProcessor;

    @KafkaListener(
        topics = "raw_events",
        groupId = "service-b-consumer",
        concurrency = "3"  // 병렬 처리
    )
    public void consumeRawEvent(
        @Payload String eventJson,
        @Header(KafkaHeaders.RECEIVED_MESSAGE_KEY) String key,
        @Header("correlation-id") String correlationId
    ) {
        // MDC에 correlation ID 설정 (로깅용)
        MDC.put("correlationId", correlationId);

        try {
            // 이벤트 파싱
            RawEvent event = objectMapper.readValue(eventJson, RawEvent.class);

            // 처리
            eventProcessor.process(event);

        } catch (Exception e) {
            log.error("Failed to process event", e);
            // DLQ로 전송
            dlqProducer.send(eventJson, e.getMessage());
        } finally {
            MDC.clear();
        }
    }
}
```

---

### 2. Event Processor 구현

```java
@Service
public class EventProcessor {

    private final ProcessedEventRepository processedEventRepository;
    private final AggregateRepository aggregateRepository;
    private final InventoryRepository inventoryRepository;
    private final OutboxRepository outboxRepository;
    private final DomainRuleEngine ruleEngine;

    @Transactional
    public void process(RawEvent rawEvent) {
        // 1. 멱등성 체크
        if (processedEventRepository.existsById(rawEvent.getEventId())) {
            log.info("Event {} already processed, skipping", rawEvent.getEventId());
            return;
        }

        // 2. Aggregate 로딩
        Aggregate aggregate = aggregateRepository
            .findById(rawEvent.getAggregateId())
            .orElseGet(() -> createNewAggregate(rawEvent));

        try {
            // 3. 도메인 검증
            validateEvent(rawEvent, aggregate);

            // 4. Aggregate 상태 업데이트
            DomainEvent domainEvent = aggregate.apply(rawEvent);

            // 5. Aggregate 저장 (version++)
            aggregateRepository.save(aggregate);

            // 6. 재고 처리 (필요 시)
            if (rawEvent.getEventType().equals("OrderApproved")) {
                reserveInventory(rawEvent);
            } else if (rawEvent.getEventType().equals("OrderShipped")) {
                decreaseInventory(rawEvent);
            }

            // 7. 처리 완료 기록
            processedEventRepository.save(new ProcessedEvent(
                rawEvent.getEventId(),
                rawEvent.getAggregateId(),
                ProcessingStatus.SUCCESS
            ));

            // 8. Outbox에 Domain Event 저장
            outboxRepository.save(new OutboxMessage(
                domainEvent.getEventType(),
                domainEvent.toJson(),
                "domain_events",
                rawEvent.getAggregateId(),
                UUID.fromString(rawEvent.getCorrelationId())
            ));

        } catch (DomainException e) {
            // 9. 검증 실패 시 거부 기록
            processedEventRepository.save(new ProcessedEvent(
                rawEvent.getEventId(),
                rawEvent.getAggregateId(),
                ProcessingStatus.REJECTED,
                e.getMessage()
            ));

            log.warn("Event rejected: {}", e.getMessage());
        }
    }

    private void validateEvent(RawEvent event, Aggregate aggregate) {
        // 상태 전이 검증
        ruleEngine.validateStateTransition(
            aggregate.getCurrentState(),
            event.getTargetState(),
            aggregate
        );

        // 시간 역행 검증
        if (event.getOccurredAt().isBefore(aggregate.getLastEventTime())) {
            throw new TimeRegressionException("Event occurred before last event");
        }

        // 재고 검증 (OrderApproved인 경우)
        if (event.getEventType().equals("OrderApproved")) {
            Inventory inventory = inventoryRepository.findByProductAndSeller(
                event.getProductId(),
                event.getSellerId()
            );

            if (inventory.getAvailableStock() < event.getQuantity()) {
                throw new OutOfStockException("재고 부족: 가용=" +
                    inventory.getAvailableStock() + ", 필요=" + event.getQuantity());
            }
        }
    }

    private void reserveInventory(RawEvent event) {
        Inventory inventory = inventoryRepository.findByProductAndSeller(
            event.getProductId(),
            event.getSellerId()
        );

        inventory.reserve(event.getQuantity());
        inventoryRepository.save(inventory);  // Optimistic Lock
    }
}
```

---

### 3. Outbox Publisher 구현

```java
@Component
public class OutboxPublisher {

    private final OutboxRepository outboxRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;

    @Scheduled(fixedDelay = 1000)  // 1초마다
    @Transactional
    public void publishPendingMessages() {
        List<OutboxMessage> messages = outboxRepository
            .findTop100ByPublishedFalseOrderByCreatedAtAsc();

        for (OutboxMessage msg : messages) {
            try {
                // Kafka 발행
                SendResult<String, String> result = kafkaTemplate.send(
                    msg.getDestinationTopic(),
                    msg.getAggregateId(),
                    msg.getEventPayload()
                ).get(5, TimeUnit.SECONDS);

                // 발행 성공
                msg.setPublished(true);
                msg.setPublishedAt(LocalDateTime.now());
                outboxRepository.save(msg);

                log.info("Published event {} to topic {}",
                    msg.getOutboxId(), msg.getDestinationTopic());

            } catch (Exception e) {
                // 발행 실패
                msg.incrementRetryCount();
                msg.setLastError(e.getMessage());

                if (msg.getRetryCount() >= msg.getMaxRetries()) {
                    log.error("Max retries exceeded for event {}, moving to DLQ",
                        msg.getOutboxId());
                    // DLQ 처리
                    moveToDeadLetterQueue(msg);
                } else {
                    log.warn("Failed to publish event {}, retry count: {}",
                        msg.getOutboxId(), msg.getRetryCount());
                    outboxRepository.save(msg);
                }
            }
        }
    }
}
```

---

## 📊 Domain Event Translator API 명세

### 1. 상태 조회 API (모니터링용)

```http
GET /api/v1/aggregates/{aggregateId}

Response:
{
  "aggregateId": "order_abc123",
  "aggregateType": "Order",
  "currentState": {
    "status": "APPROVED",
    "customerId": "customer_456",
    "sellerId": "seller_789"
  },
  "version": 5,
  "lastEventId": "uuid-12345",
  "lastUpdatedAt": "2026-01-24T10:30:45Z"
}
```

---

### 2. 재고 조회 API

```http
GET /api/v1/inventory/{productId}/{sellerId}

Response:
{
  "productId": "product_001",
  "sellerId": "seller_789",
  "currentStock": 100,
  "reservedStock": 20,
  "availableStock": 80,
  "safetyStock": 10,
  "version": 45
}
```

---

### 3. 처리 실패 이벤트 조회 API

```http
GET /api/v1/processed-events/rejected?limit=100

Response:
{
  "rejectedEvents": [
    {
      "eventId": "uuid-002",
      "aggregateId": "order_xyz",
      "eventType": "OrderShipped",
      "rejectionReason": "상태 전이 불가: SHIPPED → APPROVED",
      "processedAt": "2026-01-24T10:31:00Z"
    },
    {
      "eventId": "uuid-005",
      "aggregateId": "order_abc",
      "eventType": "OrderApproved",
      "rejectionReason": "재고 부족: 가용=0, 필요=1",
      "processedAt": "2026-01-24T10:32:15Z"
    }
  ],
  "totalCount": 1234
}
```

---

### 4. Outbox 상태 조회 API

```http
GET /api/v1/outbox/pending

Response:
{
  "pendingMessages": [
    {
      "outboxId": "uuid-outbox-001",
      "eventType": "OrderApproved",
      "destinationTopic": "domain_events",
      "retryCount": 2,
      "createdAt": "2026-01-24T10:30:00Z",
      "lastError": "Kafka broker not available"
    }
  ],
  "totalPending": 15
}
```

---

## 🧪 테스트 전략

### 1. 단위 테스트

```java
@Test
void testInventoryReservation() {
    // Given
    Inventory inventory = Inventory.builder()
        .productId("prod_001")
        .sellerId("seller_789")
        .currentStock(10)
        .reservedStock(0)
        .version(1)
        .build();

    // When
    inventory.reserve(5);

    // Then
    assertThat(inventory.getReservedStock()).isEqualTo(5);
    assertThat(inventory.getAvailableStock()).isEqualTo(5);
    assertThat(inventory.getVersion()).isEqualTo(2);
}

@Test
void testOutOfStockException() {
    // Given
    Inventory inventory = Inventory.builder()
        .currentStock(10)
        .reservedStock(8)
        .build();

    // When & Then
    assertThatThrownBy(() -> inventory.reserve(5))
        .isInstanceOf(OutOfStockException.class)
        .hasMessageContaining("재고 부족");
}
```

---

### 2. 통합 테스트 (Testcontainers)

```java
@SpringBootTest
@Testcontainers
class EventProcessorIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:14");

    @Container
    static KafkaContainer kafka = new KafkaContainer(
        DockerImageName.parse("confluentinc/cp-kafka:7.4.0")
    );

    @Autowired
    private EventProcessor eventProcessor;

    @Autowired
    private AggregateRepository aggregateRepository;

    @Test
    void testEventProcessing() {
        // Given
        RawEvent event = RawEvent.builder()
            .eventId(UUID.randomUUID())
            .eventType("OrderPlaced")
            .aggregateId("order_test_001")
            .payload("{...}")
            .build();

        // When
        eventProcessor.process(event);

        // Then
        Aggregate aggregate = aggregateRepository.findById("order_test_001").get();
        assertThat(aggregate.getCurrentState()).isEqualTo("PLACED");
        assertThat(aggregate.getVersion()).isEqualTo(1);
    }
}
```

---

## 📈 모니터링 메트릭

### 수집할 메트릭

```java
// 1. 처리 속도
@Timed(value = "service_b.event.processing.time",
       description = "Event processing time")
public void process(RawEvent event) { ... }

// 2. 검증 실패율
Counter.builder("service_b.validation.rejected")
    .tag("rejection_reason", reason)
    .register(meterRegistry)
    .increment();

// 3. Outbox 지연
Gauge.builder("service_b.outbox.pending.count", () ->
    outboxRepository.countByPublishedFalse()
).register(meterRegistry);

// 4. 재고 부족 발생 횟수
Counter.builder("service_b.inventory.out_of_stock")
    .tag("product_id", productId)
    .register(meterRegistry)
    .increment();
```

---

## ✅ Definition of Done

### Domain Event Translator 완료 조건

- [ ] **기능**:
  - [ ] Kafka Consumer 정상 작동
  - [ ] 도메인 검증 로직 구현
  - [ ] Outbox Publisher 정상 발행
  - [ ] 멱등성 보장

- [ ] **성능**:
  - [ ] 초당 1000+ 이벤트 처리
  - [ ] 평균 처리 시간 < 50ms
  - [ ] Outbox 발행 지연 < 5초

- [ ] **안정성**:
  - [ ] Optimistic Lock 동작 확인
  - [ ] 재시도 로직 검증
  - [ ] DLQ 처리 구현

- [ ] **테스트**:
  - [ ] 단위 테스트 커버리지 > 80%
  - [ ] 통합 테스트 통과
  - [ ] 동시성 테스트 통과

---

**이제 Domain Event Translator를 구현할 준비가 되었습니다!** 🚀
