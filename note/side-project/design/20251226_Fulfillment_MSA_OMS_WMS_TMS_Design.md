
# Fulfillment MSA Boundary Design (OMS / WMS / TMS)

## 1. 목적
이 문서는 Fulfillment 도메인을 **OMS / WMS / TMS** 관점에서 분리하고,
각 서비스의 **책임, 데이터 소유권, 이벤트 경계**를 명확히 정의한다.

본 설계의 목표는:
- 실제 이커머스/물류 시스템과 유사한 MSA 경계 이해
- Fulfillment 데이터를 운영자 관점에서 해석할 수 있는 구조 확립
- 이벤트 기반 아키텍처 사고 체득

---

## 2. 전체 구조 요약

```
[OMS]        [WMS]        [TMS]
  │            │            │
  └── events ──┴── events ──┘
             Kafka
               ↓
     Fulfillment Ops / Intelligence
       ├─ Elasticsearch (Projection)
       ├─ PostgreSQL (KPI / Stats)
       └─ Ops Search API
```

- 각 도메인 서비스는 **자기 책임 영역만 소유**
- 전체 Fulfillment 흐름은 Ops/Intelligence Layer에서 해석

---

## 3. OMS (Order Management Service)

### 3.1 책임
- 주문 생성 및 결제 승인
- 주문 취소 / 환불 처리
- 주문의 비즈니스 유효성 보장

### 3.2 소유 이벤트
- ORDER_PLACED
- ORDER_APPROVED
- ORDER_CANCELLED
- ORDER_REFUNDED

### 3.3 원칙
- 배송 상태, 출고 상태를 알지 않는다
- Fulfillment 시작 신호만 제공

---

## 4. WMS (Warehouse Management Service)

### 4.1 책임
- 출고 창고 결정
- 피킹 / 패킹
- 물리적 출고 수행

### 4.2 소유 이벤트
- WAREHOUSE_ASSIGNED
- PICKING_STARTED
- PACKED
- HANDED_TO_CARRIER

### 4.3 원칙
- 배송 완료 여부를 알지 않는다
- 지연률, SLA 계산 책임 없음

---

## 5. TMS (Transportation Management Service)

### 5.1 책임
- 운송 상태 관리
- 배송 완료 판단
- 배송 지연(SLA 위반) 판단

### 5.2 소유 이벤트
- IN_TRANSIT
- DELIVERED
- DELIVERY_DELAYED
- DELIVERY_FAILED

### 5.3 원칙
- 주문 금액, 결제 정보 모름
- 지연 판단의 단일 진실 원천

---

## 6. Fulfillment Ops / Intelligence Service

### 6.1 역할
- OMS / WMS / TMS 이벤트를 모두 소비
- 운영자 판단을 위한 Read Model 생성

### 6.2 특징
- 상태를 소유하지 않음
- 트랜잭션 없음
- 재처리(replay) 가능

---

## 7. Elasticsearch Projection

### 7.1 shipments 인덱스
주문 1건의 Fulfillment 요약 카드

```json
{
  "orderId": "string",
  "orderedAt": "datetime",
  "approvedAt": "datetime",
  "handoffAt": "datetime",
  "deliveredAt": "datetime",
  "leadTime": "number",
  "isLate": "boolean",
  "sellerRegion": "string",
  "customerRegion": "string"
}
```

---

## 8. KPI / 통계 (PostgreSQL)

### 8.1 route_stats_daily
- seller_region
- customer_region
- avg_lead_time
- late_rate
- sample_count
- date

용도:
- 경로 회피 추천
- 출고지 추천 근거 데이터

---

## 9. 설계 원칙 요약

- 각 서비스는 자신의 도메인 진실만 소유
- 전체 흐름 해석은 Ops Layer에서 수행
- 검색 시스템은 도메인이 아니라 파생 시스템
- 동기 호출 최소화, 이벤트 기반 비동기 연결

---

## 10. 한 줄 요약

> Fulfillment 시스템은 하나의 서비스가 아니라,
> 여러 도메인의 이벤트를 운영 관점에서 해석하는 구조다.
