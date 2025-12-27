
# Ingest Service Design (Clean Architecture 기반)
## Replay Simulator / CSV → Canonical Events → Kafka (OMS/WMS/TMS 토픽 분리)

본 문서는 EIP Stage 1의 **ingest-service(Replay Simulator)** 를
클린 아키텍처 기반으로 개발하기 위한 설계 문서다.

목표:
- Olist CSV 스냅샷을 **Fulfillment 이벤트 스트림**으로 복원(replay)
- 이벤트 소유권(OMS/WMS/TMS)에 따라 **도메인별 토픽**으로 발행
- Canonical Fulfillment Event v1 스키마로 통일
- replay/backfill/재실행 시에도 동일 결과(idempotent) 보장

---

## 1. 역할 요약
ingest-service는 “실제 OMS/WMS/TMS가 존재한다고 가정”하고,
CSV를 읽어 해당 도메인 이벤트를 생성한 뒤 Kafka에 publish 한다.

- 입력: Olist CSV (orders/items/sellers/customers)
- 출력: Kafka topics (oms-events, wms-events, tms-events)

---

## 2. 책임 범위
- CSV 파싱/조인(orders ↔ customers ↔ items ↔ sellers)
- 이벤트 생성 규칙(도메인 소유권) 적용
- Canonical Event 스키마로 변환
- Kafka publish (topic routing)
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
  - Topic route
→ Kafka
  - oms-events
  - wms-events
  - tms-events

---

## 4. Clean Architecture 적용 구조

### 4.1 패키지 구조 예시
```
ingest-service/
  application/
    ReplayUseCase.java
    commands/
      ReplayCommand.java
    ports/
      KafkaEventPublisherPort.java
      CheckpointStorePort.java      # 선택(중단/재개)
      ClockPort.java

  domain/
    event/
      CanonicalFulfillmentEvent.java
      EventType.java
      EventSource.java              # OMS/WMS/TMS
    policy/
      EventOwnershipPolicy.java     # eventType → source
      EventIdPolicy.java            # sha256 규칙
      TopicRoutingPolicy.java       # source → topic
      ReplayPolicy.java             # FAST/SCALED, speedFactor
    olist/
      OlistOrderRow.java
      OlistItemRow.java
      OlistCustomerRow.java
      OlistSellerRow.java
      OlistJoinModel.java           # order + customer + seller(대표) 결합

  adapters/
    inbound/
      cli/
        ReplayCliRunner.java        # CommandLineRunner
      http/
        ReplayController.java       # (선택) REST로 replay 트리거
    outbound/
      csv/
        OlistCsvReaderAdapter.java
      kafka/
        KafkaEventPublisherAdapter.java
      postgres/
        PgCheckpointStoreAdapter.java  # (선택)
      clock/
        SystemClockAdapter.java

  config/
    KafkaProducerConfig.java
    CsvConfig.java
    DataSourceConfig.java           # (선택)
```

> 핵심: UseCase/Domain은 Kafka/CSV 라이브러리를 직접 import 하지 않는다.
> 구체 구현은 adapters(outbound/inbound)에서 처리한다.

---

## 5. Canonical Fulfillment Event v1 (공통 스키마)

```json
{
  "schemaVersion": 1,
  "eventId": "sha256(orderId|eventType|eventAt|source)",
  "eventType": "ORDER_PLACED | ORDER_APPROVED | ORDER_CANCELLED | WAREHOUSE_ASSIGNED | HANDED_TO_CARRIER | DELIVERED | DELIVERY_DELAYED",
  "eventAt": "2020-01-01T10:00:00Z",
  "orderId": "string",
  "source": "OMS | WMS | TMS",
  "seller": { "id": "string|null", "state": "string|null", "city": "string|null" },
  "customer": { "id": "string|null", "state": "string|null", "city": "string|null", "zipPrefix": "string|null" },
  "payload": {
    "estimatedDeliveryAt": "datetime|null",
    "shippingLimitAt": "datetime|null",
    "orderStatus": "string|null",
    "cancelAtUnknown": "boolean|null"
  }
}
```

---

## 6. 토픽 설계 / 라우팅 규칙

### 6.1 토픽
- `oms-events`
- `wms-events`
- `tms-events`

### 6.2 Key
- Kafka message key = `orderId`

### 6.3 강제 규칙
- `oms-events`로 publish 되는 이벤트는 `source=OMS`
- `wms-events` → `source=WMS`
- `tms-events` → `source=TMS`

---

## 7. CSV → 이벤트 생성 규칙 (Simulator 핵심)

### 7.1 입력 데이터 조합(Join) 규칙
- orders(customer_id) ↔ customers(customer_id)
- order_items(order_id) ↔ sellers(seller_id)
- 한 주문에 seller가 여러 명일 수 있으므로 “대표 seller” 규칙 필요

**대표 seller 규칙(권장)**
- A(단순): 첫 item의 seller
- B(개선): item_count가 가장 많은 seller

Stage 1~3에서는 대표 seller 1명만 채택하고 문서화한다.

---

### 7.2 OMS 이벤트(oms-events)

| eventType | 생성 조건 | eventAt | 비고 |
|---|---|---|---|
| ORDER_PLACED | purchase_timestamp 존재 | purchase_timestamp | payload.orderStatus 포함 |
| ORDER_APPROVED | approved_at 존재 | approved_at |  |
| ORDER_CANCELLED | status == canceled | 정책값 | cancelAtUnknown=true 권장 |

**취소 시각 정책**
- 단순: purchase_timestamp
- 권장: coalesce(approved_at, purchase_timestamp)

---

### 7.3 WMS 이벤트(wms-events)

| eventType | 생성 조건 | eventAt | 비고 |
|---|---|---|---|
| WAREHOUSE_ASSIGNED | order_items 존재 | min(shipping_limit_date) | payload.shippingLimitAt 설정 |

---

### 7.4 TMS 이벤트(tms-events)

| eventType | 생성 조건 | eventAt | 비고 |
|---|---|---|---|
| HANDED_TO_CARRIER | carrier_date 존재 | carrier_date | payload.estimatedDeliveryAt |
| DELIVERED | delivered_date 존재 | delivered_date | payload.estimatedDeliveryAt |
| DELIVERY_DELAYED | delivered > estimated | delivered_date | late 판단은 TMS만 수행 |

---

## 8. Replay 제어 기능 (운영/학습 핵심)

### 8.1 Replay 옵션(ReplayCommand)
- inputPath: CSV directory
- dateFrom/dateTo: 주문 구매일 기준 필터(옵션)
- replayMode: FAST | SCALED (선택)
- speedFactor: (SCALED 모드에서 시간 축 압축 배수)
- maxRate: 초당 발행 제한(옵션)

### 8.2 체크포인트(선택)
중단/재개가 필요하면 아래 저장소를 둔다.
- Postgres `ingest_checkpoint`
  - job_id, last_order_id(or offset), updated_at

학습 초반에는 생략 가능(FAST replay만)

---

## 9. Idempotency 설계

### 9.1 eventId 결정 규칙
- `eventId = sha256(orderId|eventType|eventAt|source)`
- 동일 CSV를 replay해도 동일 eventId 생성되어야 한다.

### 9.2 중복 발행 가능성
- replay 재실행
- producer retry
- 여러 번 수행한 backfill

=> Indexer에서 dedup 처리하므로, Ingest는 “결정적 eventId 생성”을 1차 목표로 한다.

---

## 10. 관측(Observability) 최소 요구사항
- replay 시작/종료 로그
- 발행 이벤트 수(토픽별/타입별) 카운트
- 처리 소요시간
- 실패 레코드 샘플(파싱 실패 등)

---

## 11. 완료 기준 (Definition of Done)
- CSV → Kafka 3토픽으로 이벤트 발행 end-to-end 성공
- 동일 CSV replay 시 eventId가 동일(멱등)함을 확인
- OMS/WMS/TMS 소유권이 이벤트/토픽에 일관되게 반영
- Kafka UI에서 payload 검증 가능

---

## 12. 포트폴리오 요약 문장
> Olist CSV 스냅샷을 OMS/WMS/TMS 도메인 이벤트로 복원하는 Replay Simulator(ingest-service)를 구현하고,  
> Canonical Fulfillment Event 스키마로 통일된 메시지를 도메인별 Kafka 토픽으로 발행했다.
