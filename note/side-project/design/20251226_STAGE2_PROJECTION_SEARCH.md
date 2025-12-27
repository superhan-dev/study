# Stage 2 — Projection & Search (Kafka → Elasticsearch)

## 목적
Stage 1에서 구축한 **이벤트 스트림(Kafka)** 을 기반으로  
Elasticsearch에 **Read Model(Materialized View)** 을 생성하여  
운영자가 즉시 활용 가능한 **검색·집계·대시보드 시스템**을 구축한다.

본 단계의 핵심은 **Elasticsearch를 DB가 아닌 Projection으로 사용하는 감각을 체득**하는 것이다.

---

## Stage 2 핵심 목표 (한 줄)
> Kafka 이벤트를 Elasticsearch로 투영(Projection)하여  
> 운영자용 검색·집계·대시보드를 구축한다.

---

## 1. Stage 2의 위치 (전체 흐름)

```
[CSV Replay]
     ↓
[Kafka order-events]        ← Stage 1
     ↓
[Indexer Service]
     ↓
[Elasticsearch Index]       ← Stage 2
     ↓
[Search API / Dashboard]
```

- Kafka: **Write Side (Event Log)**
- Elasticsearch: **Read Side (CQRS Projection)**

---

## 2. 핵심 개념 정리 (반드시 이해)

### Projection (Materialized View)
- 이벤트 로그를 그대로 조회 ❌
- 검색/집계에 최적화된 형태로 **재구성된 결과 뷰** ⭕

### CQRS Read Model
- Write 모델: Kafka
- Read 모델: Elasticsearch
- Read 모델은 **언제든 버리고 다시 만들 수 있어야 한다**

---

## 3. Indexer Service 설계 (Kafka → ES)

### TODO
- [ ] Spring Boot Indexer Service 생성
- [ ] Kafka Consumer 설정
- [ ] eventType별 처리 로직 분기
- [ ] Elasticsearch Client 연동
- [ ] upsert 기반 문서 갱신 구현

### 체크리스트
- [ ] Consumer가 실패해도 재처리 가능함을 이해했다
- [ ] Indexer는 **상태를 소유하지 않는다**는 점을 설명할 수 있다
- [ ] Indexer 재기동 시 시스템이 복구됨을 설명할 수 있다

---

## 4. Elasticsearch 인덱스 설계

### 4.1 shipments 인덱스 (핵심)

#### 예시 필드
- order_id (keyword)
- current_status (keyword)
- seller_region (keyword)
- customer_region (keyword)
- lead_time (long)
- is_late (boolean)
- ordered_at (date)
- delivered_at (date)
- updated_at (date)

### TODO
- [ ] index mapping 정의
- [ ] keyword / date / numeric 타입 구분
- [ ] index lifecycle 전략 초안 작성

### 체크리스트
- [ ] 왜 정규화하지 않는지 설명할 수 있다
- [ ] ES 문서는 조회 최적화 구조임을 설명할 수 있다

---

## 5. 이벤트 → 문서 변환 규칙 정의

### TODO
- [ ] ORDER_PLACED → 문서 생성
- [ ] ORDER_APPROVED → 상태 업데이트
- [ ] HANDED_TO_CARRIER → 배송 시작 시간 기록
- [ ] DELIVERED → 배송 완료 및 lead_time 계산
- [ ] LATE_DETECTED → is_late=true 설정

### 체크리스트
- [ ] 여러 이벤트가 하나의 문서를 완성함을 설명할 수 있다
- [ ] 왜 이벤트 전체를 저장하지 않는지 설명할 수 있다

---

## 6. 운영자용 검색 쿼리 설계

### TODO
- [ ] 지연 주문 검색
- [ ] 배송 중 주문 조회
- [ ] 판매자별 지연 주문 검색
- [ ] 기간별 주문 필터링

### 예시
- `is_late = true AND current_status != DELIVERED`
- `seller_region = 'SP'`

### 체크리스트
- [ ] Filter vs Query 차이를 설명할 수 있다
- [ ] 검색 조건이 늘어날수록 ES가 유리한 이유를 설명할 수 있다

---

## 7. 집계(Aggregation) 설계

### TODO
- [ ] seller_region별 평균 lead_time
- [ ] customer_region별 지연률
- [ ] 일자별 배송 완료 수
- [ ] SLA 위반률 추이

### 체크리스트
- [ ] Aggregation이 DB GROUP BY와 어떻게 다른지 설명할 수 있다
- [ ] 실시간 집계의 한계를 이해했다

---

## 8. 대시보드 구성

### TODO
- [ ] Kibana 연결
- [ ] 핵심 KPI 시각화
  - 총 주문 수
  - 지연 주문 수
  - 평균 배송 시간
- [ ] 검색 결과 테이블 구성

### 체크리스트
- [ ] 운영자 관점 질문에 즉시 답할 수 있다
- [ ] 대시보드는 의사결정을 돕는 도구임을 설명할 수 있다

---

## 9. 재처리 & 인덱스 재빌드 실험

### TODO
- [ ] 인덱스 삭제
- [ ] Kafka replay 수행
- [ ] 인덱스 재생성 확인

### 체크리스트
- [ ] ES가 Source of Truth가 아님을 체감했다
- [ ] replay 기반 복구 흐름을 설명할 수 있다

---

## Stage 2 종료 조건

아래 질문에 답할 수 있으면 Stage 2 완료:

- 왜 Elasticsearch를 DB처럼 쓰면 안 되는가?
- Projection이란 무엇인가?
- Kafka 이벤트만으로 인덱스를 다시 만들 수 있는 이유는?
- 운영자 검색과 사용자 검색의 차이는?

---

## Stage 2 성취 문장

> Kafka 이벤트를 Elasticsearch로 투영하여  
> 운영자용 검색·집계·대시보드를 구축했다.
