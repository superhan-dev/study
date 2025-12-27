# Ingest Service Design (Clean Architecture 기반, Adapter 추상화 강화)

## Replay Simulator / CSV → Canonical Events → Event Log 적재 (Message Broker 구현: Kafka)

본 문서는 EIP Stage 1의 **ingest-service(Replay Simulator)** 를
클린 아키텍처 기반으로 개발하기 위한 설계 문서다.  
또한 향후 메시지 브로커/입력 소스 교체를 쉽게 하기 위해 **Adapter를 역할 기반으로 추상화**한다.

목표:

- Olist CSV 스냅샷을 **Fulfillment 이벤트 스트림**으로 복원(replay)
- 이벤트 소유권(OMS/WMS/TMS)에 따라 **도메인별 Event Log(토픽)** 으로 발행
- Canonical Fulfillment Event v1 스키마로 통일
- replay/backfill/재실행 시에도 동일 결과(idempotent) 보장

> 주의: 본 문서에서 “Event Log”는 Kafka 같은 메시지 브로커를 추상화한 표현이다.

---

## 1. 역할 요약

ingest-service는 “실제 OMS/WMS/TMS가 존재한다고 가정”하고,
CSV를 읽어 해당 도메인 이벤트를 생성한 뒤 Event Log로 publish 한다.

- 입력: Olist CSV (orders/items/sellers/customers)
- 출력: Event Log streams (oms-events, wms-events, tms-events)

---

## 2. 책임 범위

- CSV 파싱/조인(orders ↔ customers ↔ items ↔ sellers)
- 이벤트 생성 규칙(도메인 소유권) 적용
- Canonical Event 스키마로 변환
- Event Log publish (stream routing)
- Replay 제어 (기간 범위, 속도, 모드)
- Idempotency 보장(eventId 결정적 생성)
- 실행 로그/통계(발행량, 소요시간) 기록

---

## 3. 전체 처리 흐름 (Data Flow)

CSV
→ Ingest(Replay Simulator)

- Parse + Join
- Event build (OMS/WMS/TMS)
- eventId 생성
- Stream route
  → Event Log
- oms-events
- wms-events
- tms-events

---

## 4. Adapter 추상화 전략

### 4.1 Inbound / Outbound 역할

- Inbound: 실행 트리거(CLI/HTTP/Scheduler)
- Outbound:
  - Import Source: CSV 같은 원천 데이터 소스
  - Event Log: Kafka 같은 메시지 브로커

### 4.2 구현 기술 노출 위치

- `adapters/outbound/import_source/**/*`
- `adapters/outbound/event_log/**/*`

---

## 5. Clean Architecture 적용 구조 (권장)

```
ingest-service/
  application/
    ReplayUseCase.java
    commands/
      ReplayCommand.java
    ports/
      import_source/
        FulfillmentSnapshotReaderPort.java     # CSV/DB 등 원천 데이터 읽기(추상)
      event_log/
        FulfillmentEventPublisherPort.java     # Event Log publish(추상)
      checkpoint/
        CheckpointStorePort.java               # 중단/재개(선택)
      clock/
        ClockPort.java

  domain/
    event/
      CanonicalFulfillmentEvent.java
      EventType.java
      EventSource.java                          # OMS/WMS/TMS
    policy/
      EventOwnershipPolicy.java                 # eventType → source
      EventIdPolicy.java                        # sha256 규칙
      StreamRoutingPolicy.java                  # source → stream(topic)
      ReplayPolicy.java                         # FAST/SCALED, speedFactor
    olist/
      OlistOrderRow.java
      OlistItemRow.java
      OlistCustomerRow.java
      OlistSellerRow.java
      OlistJoinModel.java                       # order + customer + seller(대표)

  adapters/
    inbound/
      cli/
        ReplayCliRunner.java                    # CommandLineRunner
      http/
        ReplayController.java (optional)

    outbound/
      import_source/
        olist_csv/
          OlistSnapshotReaderAdapter.java       # FulfillmentSnapshotReaderPort 구현(역할명)
            csv/
              OlistCsvReader.java               # 실제 CSV 파서/로더

      event_log/
        fulfillment_events/
          FulfillmentEventLogPublisherAdapter.java # FulfillmentEventPublisherPort 구현(역할명)
            kafka/
              KafkaEventProducer.java
              KafkaHeadersMapper.java

      checkpoint/
        ingest_checkpoint/
          CheckpointPersistenceAdapter.java (optional)
            jpa/
              CheckpointJpaEntity.java
              CheckpointJpaRepository.java

      clock/
        SystemClockAdapter.java

  config/
    InboundTriggerConfig.java
    ImportSourceConfig.java
    EventLogConfig.java                         # Kafka 구현 bean 선택
    PersistenceConfig.java (optional)
```

원칙:

- UseCase/Domain은 Kafka/CSV/JPA 타입을 import 하지 않는다.
- “CSV”는 import_source 구현, “Kafka”는 event_log 구현으로만 존재한다.

---

## 6. Canonical Fulfillment Event v1 (공통 스키마)

```json
{
  "schemaVersion": 1,
  "eventId": "sha256(orderId|eventType|eventAt|source)",
  "eventType": "ORDER_PLACED | ORDER_APPROVED | ORDER_CANCELLED | WAREHOUSE_ASSIGNED | HANDED_TO_CARRIER | DELIVERED | DELIVERY_DELAYED",
  "eventAt": "2020-01-01T10:00:00Z",
  "orderId": "string",
  "source": "OMS | WMS | TMS",
  "seller": {
    "id": "string|null",
    "state": "string|null",
    "city": "string|null"
  },
  "customer": {
    "id": "string|null",
    "state": "string|null",
    "city": "string|null",
    "zipPrefix": "string|null"
  },
  "payload": {
    "estimatedDeliveryAt": "datetime|null",
    "shippingLimitAt": "datetime|null",
    "orderStatus": "string|null",
    "cancelAtUnknown": "boolean|null"
  }
}
```

---

## 7. Stream(토픽) 설계 / 라우팅 규칙

### 7.1 Streams (현재 Kafka topics)

- `oms-events`
- `wms-events`
- `tms-events`

### 7.2 Key

- message key = `orderId`

### 7.3 강제 규칙

- oms stream → `source = OMS`
- wms stream → `source = WMS`
- tms stream → `source = TMS`

---

## 8. Import Source(CSV) → 이벤트 생성 규칙 (Simulator 핵심)

### 8.1 Join 규칙

- orders(customer_id) ↔ customers(customer_id)
- order_items(order_id) ↔ sellers(seller_id)
- 한 주문에 seller가 여러 명일 수 있으므로 “대표 seller” 규칙 필요

대표 seller 규칙(권장):

- A(단순): 첫 item의 seller
- B(개선): item_count가 가장 많은 seller

---

### 8.2 OMS 이벤트(oms-events)

| eventType       | 생성 조건               | eventAt            | 비고                      |
| --------------- | ----------------------- | ------------------ | ------------------------- |
| ORDER_PLACED    | purchase_timestamp 존재 | purchase_timestamp | payload.orderStatus 포함  |
| ORDER_APPROVED  | approved_at 존재        | approved_at        |                           |
| ORDER_CANCELLED | status == canceled      | 정책값             | cancelAtUnknown=true 권장 |

취소 시각 정책:

- 단순: purchase_timestamp
- 권장: coalesce(approved_at, purchase_timestamp)

---

### 8.3 WMS 이벤트(wms-events)

| eventType          | 생성 조건        | eventAt                  | 비고                         |
| ------------------ | ---------------- | ------------------------ | ---------------------------- |
| WAREHOUSE_ASSIGNED | order_items 존재 | min(shipping_limit_date) | payload.shippingLimitAt 설정 |

---

### 8.4 TMS 이벤트(tms-events)

| eventType         | 생성 조건             | eventAt        | 비고                        |
| ----------------- | --------------------- | -------------- | --------------------------- |
| HANDED_TO_CARRIER | carrier_date 존재     | carrier_date   | payload.estimatedDeliveryAt |
| DELIVERED         | delivered_date 존재   | delivered_date | payload.estimatedDeliveryAt |
| DELIVERY_DELAYED  | delivered > estimated | delivered_date | late 판단은 TMS만 수행      |

---

## 9. Replay 제어 기능 (운영/학습 핵심)

### 9.1 ReplayCommand 옵션

- inputPath: CSV directory
- dateFrom/dateTo: 주문 구매일 기준 필터(옵션)
- replayMode: FAST | SCALED
- speedFactor: (SCALED에서 시간 축 압축 배수)
- maxRate: 초당 발행 제한(옵션)

### 9.2 체크포인트(선택)

중단/재개가 필요하면 checkpoint 저장소를 둔다.

- `ingest_checkpoint` (job_id, last_cursor, updated_at)

학습 초반에는 생략 가능.

---

## 10. Idempotency 설계

- eventId 결정 규칙: sha256(orderId|eventType|eventAt|source)
- 동일 CSV replay 시 동일 eventId 생성
- 중복 발행 가능성(재실행/재시도)은 Indexer dedup이 최종 방어선

---

## 11. 완료 기준 (Definition of Done)

- Import Source(CSV) → Event Log(3 streams) 발행 end-to-end 성공
- 동일 CSV replay 시 eventId 동일(멱등)
- OMS/WMS/TMS 소유권이 이벤트/stream에 일관되게 반영
- Kafka UI에서 payload 검증 가능

---

## 12. 포트폴리오 요약 문장

> Olist 스냅샷을 Import Source로부터 읽어 OMS/WMS/TMS 이벤트로 복원하는 Replay Simulator(ingest-service)를 구현하고,  
> Canonical Fulfillment Event 스키마로 통일된 메시지를 도메인별 Event Log(stream)로 발행했다.
