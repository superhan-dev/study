# 📌 기능정의서 (FRD) — Logistics Ops Search & Decision Support (EIP 학습 Slice)

> 목적: Olist CSV(스냅샷)를 이벤트 스트림으로 복원(replay)하여 Kafka 파이프라인을 구축하고,  
> Elasticsearch Projection 기반 운영자용 검색·집계·대시보드를 구현한 뒤,  
> 축적된 지연 통계를 기반으로 의사결정(추천) 기능을 제공한다.

---

## 0. 범위 및 원칙

### 0.1 범위(이번 기능정의서가 다루는 것)

- **Stage 1**: CSV → Event Replay → Kafka (`order-events`)
- **Stage 2**: Kafka → Elasticsearch Projection (`shipments`, `shipment_events`)
- **Stage 3(부분)**: 지연 통계 집계(`route_stats_daily`) + 추천 2종(경로 회피/출고지 추천)
- **관측(Observability)**: Kafka UI + Grafana/Prometheus 기반 모니터링 요구사항

### 0.2 비범위(이번 단계에서 제외)

- 실시간 CDC(Debezium) 연동
- 실시간 위치 추적(GPS/허브 스캔 로그)
- CTR/Ads/Reco 모델 학습(향후 Stage로 설계만 유지)
- 복잡한 최적화(OR-Tools 등)

### 0.3 설계 원칙

- Kafka는 **Queue가 아니라 Event Log**로 사용한다.
- Elasticsearch는 **Source of Truth가 아닌 Read Model(Projection)** 이다.
- Online Query Path는 짧게, 상태/지표 갱신은 **비동기 이벤트 기반**으로 처리한다.
- 재처리(replay) 가능한 구조를 1급 기능으로 둔다.

---

## 1. 사용자(Actor) 및 사용 시나리오

### 1.1 Actor

- **운영자(Ops)**: 지연/병목을 탐색하고 원인을 파악한다.
- **플랫폼 엔지니어(Dev/Ops)**: 파이프라인을 모니터링/재처리/재색인한다.

### 1.2 주요 시나리오

1. 운영자는 “지연 주문”을 필터링해 리스트로 확인한다.
2. 운영자는 지역/판매자별 지연률 및 평균 리드타임을 대시보드로 확인한다.
3. 운영자는 “지연이 잦은 경로 회피” 추천을 조회한다.
4. 플랫폼 엔지니어는 CSV 기반 replay를 실행해 인덱스를 재구성한다.
5. 플랫폼 엔지니어는 Kafka lag / ES 인덱싱 처리량을 모니터링한다.

---

## 2. 서비스 구성 및 책임 (라이트 MSA)

> 서비스 수는 학습 효율을 위해 최소 3개로 분리한다.

### 2.1 Ingest Service (Replay)

- Olist CSV를 읽어 주문 생애주기 이벤트를 생성
- Kafka `order-events`로 발행
- replay 속도/구간 제어
- 체크포인트 기록(선택: Postgres)

### 2.2 Ops-Index Service (Indexer)

- Kafka 이벤트 소비
- Elasticsearch Projection 갱신 (`shipments` upsert, `shipment_events` append)
- idempotency(중복 방지) 처리(권장: Postgres `event_dedup`)
- route 통계 계산 이벤트 발행 또는 RDB 집계 갱신

### 2.3 Ops-Search API Service (Serving)

- 운영자용 검색/집계 API 제공
- 추천 API(경로 회피/출고지 추천) 제공
- Redis 캐싱: 집계 결과/추천 결과

---

## 3. 데이터/이벤트 정의

### 3.1 Kafka Topic

- **Topic**: `order-events`
- **Key**: `orderId` (주문 단위 순서/파티셔닝)
- **Partition**: 초기 3~6 (로컬/학습 환경)

### 3.2 이벤트 타입

- `ORDER_PLACED`
- `ORDER_APPROVED`
- `HANDED_TO_CARRIER`
- `DELIVERED`
- `LATE_DETECTED`
- (옵션) `STUCK_DETECTED`

### 3.3 공통 이벤트 스키마(v1)

- `eventId` (string, unique) — 예: hash(orderId + eventType + eventAt)
- `eventType` (string)
- `eventAt` (datetime, 발생 시각)
- `orderId` (string)
- `sellerRegion` (object, optional): state/city/zipPrefix
- `customerRegion` (object, optional): state/city/zipPrefix
- `payload` (object): 필요한 최소 필드

**수용 기준**

- 동일 CSV를 replay해도 동일한 이벤트(eventId)가 생성되어야 한다(idempotent).

---

## 4. Elasticsearch Projection 정의

### 4.1 Index: `shipments` (주문 단위 Read Model)

**목적**

- 운영자 검색/필터/집계의 중심 인덱스

**필수 필드**

- `orderId` (keyword)
- `currentStatus` (keyword)
- `orderedAt`, `approvedAt`, `handoffAt`, `deliveredAt`, `estimatedDeliveryAt` (date)
- `durations` (object): 구간별/전체 소요시간(분/초 단위)
- `isLate` (boolean), `lateDays` (int)
- `sellerRegion.*`, `customerRegion.*` (keyword)
- `updatedAt` (date)

**수용 기준**

- 이벤트 순서가 뒤바뀌더라도 최종 상태가 일관되도록(최신 eventAt 기준) 처리한다.

### 4.2 Index: `shipment_events` (이벤트 로그 Read Model, 선택)

**목적**

- 주문 단위 타임라인 조회/디버깅

**필수 필드**

- `orderId` (keyword)
- `eventType` (keyword)
- `eventAt` (date)
- `stage` (keyword; PAYMENT/HANDOFF/LAST_MILE)
- `region` (keyword set)

---

## 5. RDBMS(PostgreSQL) 사용 범위 (Plan B)

> 원천 데이터를 전부 적재하지 않으며, **파이프라인 운영을 위한 보조 원장**으로만 사용한다.

### 5.1 테이블

1. `ingest_checkpoint`

- replay 진행 상태 저장

2. `event_dedup`

- 처리한 eventId 저장(중복 방지)

3. `route_stats_daily`

- 날짜/경로별 지표 집계 결과 저장(추천용)

---

## 6. 기능 요구사항 (Functional Requirements)

> 표기: FR-XX (제품 기능), OPS-XX (운영 제어), OBS-XX (관측/모니터링)

### 6.1 Stage 1 — Ingest/Replay

#### FR-01 CSV 기반 이벤트 생성

- **설명**: Olist CSV에서 주문 생애주기 이벤트를 생성한다.
- **입력**: CSV 파일 경로 또는 디렉토리
- **출력**: 이벤트 리스트(내부) → Kafka publish
- **완료 기준**
  - 주문 1건에서 1~N개의 이벤트가 생성됨
  - 필수 타임스탬프가 없는 경우 이벤트를 생성하지 않거나 null 처리 규칙이 문서화됨

#### FR-02 Kafka Publish

- **설명**: 생성한 이벤트를 `order-events`로 발행한다.
- **완료 기준**
  - Kafka UI에서 payload 확인 가능
  - key=orderId로 동일 주문 이벤트가 같은 파티션으로 라우팅됨

#### OPS-01 Replay 실행/중지

- **설명**: 특정 기간(start/end) 이벤트를 재생할 수 있다.
- **옵션**: replayMode(FAST/SCALED), speedFactor
- **완료 기준**
  - Replay 실행 로그/통계(발행량, 소요시간) 확인 가능
  - Replay 중지 후 재개 가능(Checkpoint 기반)

---

### 6.2 Stage 2 — Indexer(Projection)

#### FR-03 Kafka Consume & Projection Update

- **설명**: `order-events`를 소비하여 `shipments` 문서를 upsert 갱신한다.
- **완료 기준**
  - 특정 orderId에 대해 상태가 이벤트에 따라 정상 업데이트됨
  - replay로 인덱스가 재구성됨(인덱스 삭제 후 재생성)

#### FR-04 Event Log Index(선택)

- **설명**: `shipment_events` 인덱스에 이벤트 로그를 append한다.
- **완료 기준**
  - orderId로 타임라인 조회 가능

#### OPS-02 Idempotency(중복 처리)

- **설명**: 동일 eventId 중복 처리 시 projection이 깨지지 않는다.
- **완료 기준**
  - event_dedup 기반 중복 방지가 동작하거나, 동일 upsert 결과가 유지됨

---

### 6.3 Stage 2 — Ops Search API

#### FR-05 지연 주문 검색 API

- **설명**: 지연 주문을 필터링/페이징하여 조회한다.
- **입력**: dateRange, region, sellerRegion, status, isLate
- **완료 기준**
  - ES filter 기반으로 빠르게 동작
  - 대표 쿼리 DSL이 문서화됨

#### FR-06 병목 구간 탐색 API

- **설명**: 승인→인계, 인계→배송 등 구간별 지연이 큰 주문을 조회한다.
- **완료 기준**
  - durations 기반 range filter 가능

#### FR-07 KPI 집계 API

- **설명**: region/seller별 평균 리드타임, 지연률, 추이를 반환한다.
- **완료 기준**
  - terms/date_histogram 기반 집계 결과 반환
  - Redis 캐시(선택) 적용 시 hit ratio 측정 가능

---

### 6.4 Stage 3 — Decision Support(추천)

#### FR-08 경로 회피 추천

- **설명**: seller_region → customer_region 기준으로 지연이 잦은 경로를 회피하도록 추천한다.
- **입력**: customerRegion, 기간(예: 최근 30일)
- **출력**: 회피 경로 리스트 + 대체 경로 후보
- **완료 기준**
  - route_stats_daily 기반으로 Top-N 반환
  - 추천 근거(지연률/표본수)가 함께 제공됨

#### FR-09 출고지(seller) 추천

- **설명**: 목적지 region 기준으로 seller 후보를 랭킹하여 추천한다.
- **입력**: customerRegion
- **출력**: 추천 seller_region Top-N + 근거 지표
- **완료 기준**
  - score = w1*avg_lead_time + w2*late_rate (+w3\*sample_count) 등 공식 문서화

---

## 7. 관측/모니터링 요구사항 (Observability)

#### OBS-01 Kafka 이벤트 스트림 관측 UI

- **설명**: Kafka 토픽/메시지/consumer lag 확인 UI를 제공한다.
- **구현**: Redpanda Console(권장) 또는 AKHQ/Kafdrop 중 1개
- **완료 기준**
  - 토픽/파티션/최근 메시지 payload 조회 가능
  - consumer group lag 조회 가능

#### OBS-02 Metrics 대시보드 (Prometheus + Grafana)

- **설명**: 처리량/지연/오류를 시계열로 관측한다.
- **메트릭(최소)**
  - producer publish rate
  - consumer lag
  - consumer error rate
  - ES indexing throughput
  - API p95 latency
- **완료 기준**
  - Grafana 대시보드에서 지표가 갱신됨
  - replay 중 lag 변화/처리량 변화를 시각적으로 확인 가능

---

## 8. 비기능 요구사항 (NFR)

- **NFR-01 재처리 가능성**: 인덱스를 삭제해도 replay로 재구성 가능해야 한다.
- **NFR-02 확장성**: consumer group 확장으로 처리량 증가가 가능해야 한다.
- **NFR-03 장애 격리**: Search API 장애가 Indexer/Ingest에 직접 영향 주지 않아야 한다.
- **NFR-04 관측 가능성**: lag/throughput/error를 최소 지표로 확인 가능해야 한다.

---

## 9. 완료 정의(Definition of Done)

- Stage 1~2 파이프라인이 end-to-end로 동작
- 운영자 검색/집계 API 최소 3종 이상 동작
- Kafka UI + Grafana로 관측 가능
- replay로 인덱스를 재구성하는 데모 수행 가능
- 문서(이벤트 스키마, 인덱스 매핑, 대표 쿼리)가 저장소에 포함됨
