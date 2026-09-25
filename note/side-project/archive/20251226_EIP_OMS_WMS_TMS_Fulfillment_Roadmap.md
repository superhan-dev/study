
# 🚀 E-Commerce Intelligence Project (EIP)
## OMS / WMS / TMS Fulfillment Domain 기반 학습·구현 로드맵 (상세판)

> CSV(스냅샷)를 **Fulfillment 이벤트 스트림**으로 replay하여  
> OMS / WMS / TMS 분리 관점의 실무형 데이터 파이프라인을 구축하고,  
> Kafka(Event Log)와 Elasticsearch(Projection / Serving Index)를  
> **왜 그렇게 사용하는지 설명 가능한 수준까지** 체득한다.

---

## 1. 최종 비전 (North Star)

> **검색 · 벡터 서치 · 개인화 추천 · Ads CTR ·  
> Fulfillment(OMS/WMS/TMS) 품질 지표를  
> 이벤트 기반 MSA로 통합한 이커머스 인텔리전스 플랫폼**

이 프로젝트의 목표는 단순 기능 구현이 아니다.

- 왜 Fulfillment는 이벤트 기반이어야 하는가?
- 왜 검색 시스템은 진실의 원천(Source of Truth)이 아니어야 하는가?
- 왜 운영 데이터는 “조회”가 아니라 “판단”으로 이어져야 하는가?

이 질문들에 **설계 + 구현 경험으로 답할 수 있는 상태**가 최종 목표다.

---

## 2. 전체 구조 개요 (Fulfillment 중심)

```
[CSV Snapshot (Olist)]
        ↓  (Replay / Backfill)
[Kafka Event Log]          ← Write Side / Source of Truth
        ↓
[Indexer / Projection]     ← 해석 계층
        ↓
[Elasticsearch Read Model]← Serving 최적화
        ↓
[Ops Search / KPI / Ranking]
```

### 구조적 핵심 메시지
- Kafka는 **사실 기록(Log)** 이다
- Elasticsearch는 **보여주기 위한 결과(Projection)** 이다
- Ops / Ranking은 **의사결정 계층**이다

---

## 3. Stage 1 — Fulfillment Event Replay
### (시스템의 뼈대 / 사고방식 전환 단계)

### 🎯 목표
- 데이터를 **State(테이블)** 이 아니라 **Event(사건의 연속)** 으로 바라본다
- CSV 스냅샷을 **OMS/WMS/TMS 이벤트로 복원(replay)** 할 수 있음을 증명한다
- “이 이벤트의 주인은 누구인가?”를 명확히 설명할 수 있게 된다

---

### 🧠 학습 포인트
- Event vs State
- Event Ownership (OMS / WMS / TMS)
- Kafka는 Queue가 아니라 Append-only Log
- Replay / Backfill / Idempotency의 실무적 의미

---

### 🛠 구현 범위

#### 이벤트 소유권 정의

**OMS (주문 비즈니스 책임)**
- ORDER_PLACED
- ORDER_APPROVED
- ORDER_CANCELLED

**WMS (출고/물류 처리 책임)**
- WAREHOUSE_ASSIGNED  
  (Olist의 seller_id를 출고 창고로 해석)

**TMS (운송/SLA 판단 책임)**
- HANDED_TO_CARRIER
- DELIVERED
- DELIVERY_DELAYED  
  (지연 판단은 TMS 단독 책임)

---

#### Kafka 설계
- Topic: `fulfillment-events`
- Key: `orderId` (주문 단위 순서 보장)
- eventId: hash(orderId + eventType + eventAt)

---

### 📦 산출물
- Fulfillment 이벤트 스키마 문서
- OMS/WMS/TMS 이벤트 매핑 표
- CSV → Kafka Replay(Ingest) Service

---

### ✅ Stage 1 완료 기준
- 왜 CSV를 DB/ES에 바로 넣지 않는지 설명 가능
- Replay가 실무에서 왜 중요한지 설명 가능
- 각 이벤트가 왜 해당 도메인의 책임인지 설명 가능
- 동일 CSV replay 시 동일 결과 재현 가능(idempotent)

---

## 4. Stage 2 — Projection & Ops Search
### (서빙 시스템의 본질 이해)

### 🎯 목표
- Elasticsearch를 **Source of Truth가 아닌 Projection(Read Model)** 로 사용한다
- 운영자(Ops)가 **문제 상황을 즉시 찾을 수 있는 검색 시스템**을 구현한다

---

### 🧠 학습 포인트
- CQRS / Projection(Materialized View)
- Partial Update / Upsert
- 왜 운영 시스템은 JOIN을 하지 않는가
- 검색과 집계의 역할 분리

---

### 🛠 구현 범위

#### Elasticsearch 인덱스
- `shipments`
  - 의미: **Fulfillment Case Card**
  - 주문 1건의 출고/배송 상태 요약

- `shipment_events`
  - 의미: **Fulfillment Timeline**
  - 디버깅/감사용 이벤트 로그

---

#### Fulfillment 상태 흐름 모델
```
PLACED (OMS)
 → APPROVED (OMS)
   → ASSIGNED (WMS)
     → HANDED_OFF (TMS)
       → DELIVERED / DELAYED
```

---

#### 운영자 검색 시나리오
- SLA 위반 주문 검색
- 승인 → 인계 병목 탐색
- 인계 → 배송 병목 탐색
- 판매자/지역별 지연률 조회

---

### 📦 산출물
- ES 인덱스 매핑 문서
- 대표 Query DSL 모음
- Ops Dashboard (Kibana / Admin UI)

---

### ✅ Stage 2 완료 기준
- ES가 왜 진실의 원천이면 안 되는지 설명 가능
- 인덱스 삭제 후 replay로 복구 가능
- Projection 기반 조회의 장점 설명 가능

---

## 5. Stage 3 — Fulfillment Intelligence
### (운영 데이터 → 판단 지표)

### 🎯 목표
- Fulfillment 로그를 **의사결정 가능한 지표(Intelligence)** 로 승격
- 운영자의 “감”을 **수치 기반 판단**으로 대체

---

### 🧠 학습 포인트
- Lead Time / Late Rate 정의
- Time-window aggregation
- ES 집계 vs RDB 사전 계산 트레이드오프
- Feature Ownership (지표의 주인은 누구인가)

---

### 🛠 구현 범위

#### Fulfillment Lane 정의
- Lane = `seller_region → customer_region`
- 출고지 → 도착지 운송 경로

#### KPI
- avg_lead_time
- late_rate (⚠️ TMS 판정 결과만 사용)
- sample_count

#### 저장소
- PostgreSQL: `route_stats_daily`

---

### 📦 산출물
- Lane별 KPI 집계 로직
- 경로 성능 테이블
- 운영자 KPI 문서

---

### ✅ Stage 3 완료 기준
- “이 경로를 피해야 하는 이유”를 지표로 설명 가능
- ES 집계와 사전 계산의 차이를 설명 가능

---

## 6. Stage 4 — Search Ranking with Fulfillment Signals
### (비즈니스 품질이 반영된 검색)

### 🎯 목표
- 검색 결과를 **텍스트 관련성 + Fulfillment 품질 신호**로 랭킹

---

### 🧠 학습 포인트
- Ranking = Relevance + Business Signal
- Offline 계산 / Online 서빙 분리
- 동기 호출 최소화 설계

---

### 🛠 구현 범위
- `logistics_score` 계산
  - TMS: late_rate, p95_lead_time
  - (확장) WMS: handoff_delay
- Kafka → Indexer → ES 문서 업데이트
- function_score 또는 score 보정

---

### ✅ Stage 4 완료 기준
- Fulfillment 서비스를 검색 시 동기 호출하면 안 되는 이유 설명 가능
- Search는 “미리 계산된 신호를 소비”한다는 구조 설명 가능

---

## 7. Stage 5 — Vector Search & Recommendation
### (검색 품질 확장)

- BM25 + Vector Hybrid Search
- 상품 텍스트 임베딩
- Re-ranking 구조 이해

---

## 8. Stage 6 — Ads & CTR
### (돈이 걸린 시스템 이해)

- CTR × Bid × Relevance
- SLA / Latency Budget
- Fulfillment 품질은 Ads 필터/패널티로만 사용

---

## 9. 최종 요약 (포트폴리오 문장)

> Kaggle Olist 데이터를 OMS/WMS/TMS 관점으로 재해석해  
> Fulfillment 이벤트 스트림을 복원하고,  
> Kafka 기반 이벤트 로그와 Elasticsearch Projection을 통해  
> 운영자 검색·지표·의사결정 시스템을 단계적으로 구현했다.
