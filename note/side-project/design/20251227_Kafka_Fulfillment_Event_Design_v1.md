# 📘 Kafka Fulfillment Event Architecture

## 도메인별 토픽 + Canonical 메시지 설계 문서

본 문서는 **EIP 프로젝트 Stage 1~3**에서 사용하는  
Kafka 토픽 설계, Canonical Event 스키마, CSV 시뮬레이터 규칙,  
그리고 fan-in Indexer의 merge policy를 하나의 **구현 기준 문서**로 정리한다.

---

## 1. Kafka 토픽 설계

### 1.1 토픽 목록

- `oms-events`
- `wms-events`
- `tms-events`

**역할**

- Producer(Replay Simulator): 도메인 규칙에 따라 해당 토픽에만 발행
- Consumer(Indexer): 3개 토픽을 fan-in 방식으로 소비

---

### 1.2 메시지 Key 전략

- **Key = `orderId` (고정)**

설명:

- 토픽별로는 `orderId` 기준 ordering 최대한 유지
- 토픽 간 ordering은 보장 불가
- Indexer에서 merge policy로 흡수

---

### 1.3 파티션 수 (학습/로컬 기준)

| Topic      | Partitions |
| ---------- | ---------- |
| oms-events | 3          |
| wms-events | 3          |
| tms-events | 3          |

이유:

- consumer group 확장 실험 가능
- lag / 분산 관측에 적합

---

### 1.4 Retention 정책

- 시간 기반: **7~14일**
- 크기 기반: 로컬 디스크 고려해 제한

> replay/backfill 학습 목적이므로 retention을 너무 짧게 두지 않는다.

---

### 1.5 Canonical Fulfillment Event v1 (모든 토픽 공통)

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
    "orderStatus": "string|null"
  }
}
```

**강제 규칙**

- `oms-events` → `source = OMS`
- `wms-events` → `source = WMS`
- `tms-events` → `source = TMS`

---

### 1.6 Kafka Header 권장 (옵션)

- `schemaVersion: 1`
- `source: OMS | WMS | TMS`
- `eventType: ...`

---

## 2. Olist CSV → 도메인별 이벤트 매핑 규칙

### 사용 CSV

- `olist_orders_dataset.csv`
- `olist_order_items_dataset.csv`
- `olist_sellers_dataset.csv`
- `olist_customers_dataset.csv`

---

### 2.1 OMS 토픽 (`oms-events`)

| eventType       | 생성 조건               | eventAt            | 필드                                            |
| --------------- | ----------------------- | ------------------ | ----------------------------------------------- |
| ORDER_PLACED    | purchase_timestamp 존재 | purchase_timestamp | orderId, customer, payload.orderStatus          |
| ORDER_APPROVED  | approved_at 존재        | approved_at        | orderId, customer                               |
| ORDER_CANCELLED | status == canceled      | 정책값             | orderId, customer, payload.orderStatus=canceled |

**취소 시각 정책**

- 단순: `eventAt = order_purchase_timestamp`
- 권장: `eventAt = coalesce(order_approved_at, order_purchase_timestamp)`

---

### 2.2 WMS 토픽 (`wms-events`)

| eventType          | 생성 조건        | eventAt                  | 필드                                 |
| ------------------ | ---------------- | ------------------------ | ------------------------------------ |
| WAREHOUSE_ASSIGNED | order_items 존재 | min(shipping_limit_date) | seller 정보, payload.shippingLimitAt |

**복수 seller 정책**

- 대표 seller 1명만 선택 (문서화 필수)

---

### 2.3 TMS 토픽 (`tms-events`)

| eventType         | 생성 조건             | eventAt        | 필드                        |
| ----------------- | --------------------- | -------------- | --------------------------- |
| HANDED_TO_CARRIER | carrier_date 존재     | carrier_date   | payload.estimatedDeliveryAt |
| DELIVERED         | delivered_date 존재   | delivered_date | payload.estimatedDeliveryAt |
| DELIVERY_DELAYED  | delivered > estimated | delivered_date | payload.estimatedDeliveryAt |

> late 판단은 **TMS 단계에서만 수행**

---

## 3. Indexer fan-in Merge Policy

### 3.1 shipments 문서 핵심 필드

- orderedAt, approvedAt, assignedAt, handoffAt, deliveredAt
- estimatedDeliveryAt
- currentStatus
- durations.\*
- isLate, lateDays
- sellerRegion._, customerRegion._

---

### 3.2 필드별 갱신 규칙

| 필드                | 정책   |
| ------------------- | ------ |
| orderedAt           | min    |
| approvedAt          | min    |
| assignedAt          | min    |
| handoffAt           | min    |
| deliveredAt         | min    |
| estimatedDeliveryAt | 최신값 |

---

### 3.3 currentStatus 우선순위

1. DELIVERED / DELAYED
2. HANDED_OFF
3. ASSIGNED
4. APPROVED
5. PLACED
6. CANCELLED (조건부)

---

### 3.4 CANCELLED 충돌 정책

- deliveredAt 존재 → DELIVERED 우선
- deliveredAt 없음 + cancel → CANCELLED
- cancel 이후 delivered → DELIVERED

---

### 3.5 isLate 계산

- deliveredAt & estimatedDeliveryAt 존재 시 계산
- `isLate = deliveredAt > estimatedDeliveryAt`
- `lateDays = ceil(diff / 1day)`

---

### 3.6 Dedup 전략 (De-Duplication 전량)

같은 데이터를 두번 처리하지 않도록 하는 전략을 의미

**event_dedup 테이블**

- event_id (PK)
- processed_at
- topic
- partition
- offset

---

## 4. 실행 체크리스트

- [ ] Kafka 토픽 3개 생성 (partition=3)
- [ ] Canonical Event v1 스키마 고정
- [ ] Simulator CSV → 이벤트 생성 구현
- [ ] Indexer merge policy 구현
- [ ] event_dedup 테이블 적용

---

> 이 문서는 **실무형 Kafka 기반 Fulfillment 이벤트 파이프라인의 기준 설계서**다.
