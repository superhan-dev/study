
# 🧱 E-Commerce Intelligence Project (EIP)
## Stage 1~3 서비스 / 디렉터리 구조 설계 (OMS·WMS·TMS Fulfillment 기준)

본 문서는 **Stage 1~3을 실제 구현 관점**에서
- 어떤 서비스가 존재하는지
- 각 서비스의 책임은 무엇인지
- 디렉터리 구조는 어떻게 가져가야 하는지
를 명확히 설명한다.

목표는 **“바로 코드로 옮길 수 있는 수준”의 구조 가이드**다.

---

## 전체 서비스 구성 요약 (Stage 1~3)

```
apps/
├── ingest-service/          # Stage 1 (Replay / Event 생성)
├── indexer-service/         # Stage 2 (Projection 생성)
├── ops-search-service/      # Stage 2 (조회 / 집계 / API)
└── ops-batch-service/       # Stage 3 (KPI / Intelligence)
```

공통 인프라:
```
infra/
├── kafka/
├── elasticsearch/
├── postgres/
└── monitoring/
```

---

## Stage 1 — Ingest Service
### (CSV → Fulfillment Events → Kafka)

### 🎯 책임
- Olist CSV를 **이벤트 생성 재료**로 사용
- OMS / WMS / TMS Fulfillment 이벤트 생성
- Kafka Event Log로 발행
- Replay / Backfill 제어

---

### 서비스 이름
```
apps/ingest-service
```

---

### 디렉터리 구조

```
ingest-service/
├── src/
│   ├── application/
│   │   ├── ReplayCommand.java
│   │   └── ReplayUseCase.java
│   │
│   ├── domain/
│   │   ├── event/
│   │   │   ├── FulfillmentEvent.java
│   │   │   ├── EventType.java
│   │   │   └── EventSource.java   # OMS / WMS / TMS
│   │   └── policy/
│   │       └── EventOwnershipPolicy.java
│   │
│   ├── infrastructure/
│   │   ├── csv/
│   │   │   └── OlistCsvReader.java
│   │   ├── kafka/
│   │   │   └── KafkaEventProducer.java
│   │   └── clock/
│   │       └── SystemClock.java
│   │
│   └── presentation/
│       └── ReplayController.java
│
└── README.md
```

---

### 핵심 구현 포인트
- **CSV는 저장하지 않는다**
- 한 주문 → N개의 Fulfillment 이벤트 생성
- eventId = hash(orderId + eventType + eventAt)
- Replay는 언제든 재실행 가능해야 함

---

## Stage 2 — Indexer Service
### (Kafka → Elasticsearch Projection)

### 🎯 책임
- Kafka Event Log 소비
- Fulfillment Case Projection 생성
- Elasticsearch upsert / append
- Idempotency 보장

---

### 서비스 이름
```
apps/indexer-service
```

---

### 디렉터리 구조

```
indexer-service/
├── src/
│   ├── application/
│   │   ├── IndexEventUseCase.java
│   │   └── DeduplicationService.java
│   │
│   ├── domain/
│   │   ├── shipment/
│   │   │   ├── ShipmentProjection.java
│   │   │   └── ShipmentStatus.java
│   │   └── calculator/
│   │       └── LeadTimeCalculator.java
│   │
│   ├── infrastructure/
│   │   ├── kafka/
│   │   │   └── KafkaEventConsumer.java
│   │   ├── elasticsearch/
│   │   │   ├── ShipmentRepository.java
│   │   │   └── ShipmentEventRepository.java
│   │   └── postgres/
│   │       └── EventDedupRepository.java
│   │
│   └── config/
│       └── KafkaConsumerConfig.java
│
└── README.md
```

---

### 핵심 구현 포인트
- Indexer는 **상태를 소유하지 않는다**
- 동일 이벤트 재처리해도 결과 동일
- out-of-order 이벤트 방어
- ES는 언제든 삭제 가능

---

## Stage 2 — Ops Search Service
### (운영자 검색 / 집계 API)

### 🎯 책임
- Fulfillment Case 조회
- 운영자 검색/필터/집계
- Projection 기반 조회만 수행

---

### 서비스 이름
```
apps/ops-search-service
```

---

### 디렉터리 구조

```
ops-search-service/
├── src/
│   ├── application/
│   │   ├── SearchShipmentUseCase.java
│   │   └── GetKpiUseCase.java
│   │
│   ├── domain/
│   │   └── query/
│   │       └── ShipmentSearchCondition.java
│   │
│   ├── infrastructure/
│   │   ├── elasticsearch/
│   │   │   └── ShipmentSearchRepository.java
│   │   └── redis/
│   │       └── KpiCacheRepository.java
│   │
│   └── presentation/
│       └── OpsSearchController.java
│
└── README.md
```

---

### 핵심 구현 포인트
- DB JOIN ❌
- ES Filter + Aggregation 중심
- 응답 지연 최소화
- 캐시는 선택 사항

---

## Stage 3 — Ops Batch Service
### (Fulfillment Intelligence / KPI 집계)

### 🎯 책임
- Fulfillment Lane KPI 계산
- 사전 계산 지표 저장
- 추천/판단 근거 제공

---

### 서비스 이름
```
apps/ops-batch-service
```

---

### 디렉터리 구조

```
ops-batch-service/
├── src/
│   ├── application/
│   │   └── AggregateRouteStatsUseCase.java
│   │
│   ├── domain/
│   │   ├── route/
│   │   │   └── FulfillmentLane.java
│   │   └── metric/
│   │       └── RouteMetric.java
│   │
│   ├── infrastructure/
│   │   ├── elasticsearch/
│   │   │   └── ShipmentAggregationReader.java
│   │   ├── postgres/
│   │   │   └── RouteStatsRepository.java
│   │   └── scheduler/
│   │       └── BatchScheduler.java
│   │
│   └── config/
│       └── BatchConfig.java
│
└── README.md
```

---

### 핵심 구현 포인트
- 지표는 **사후 계산**
- ES는 읽기만 수행
- RDB는 결과 저장소
- 재계산 가능 구조

---

## 공통 설계 원칙 요약

- 이벤트는 도메인(OMS/WMS/TMS)이 소유
- Indexer는 해석 계층
- Search는 Projection 조회만 수행
- Batch는 판단 근거를 생성
- 모든 구조는 **Replay 가능성**을 전제로 설계

---

## 포트폴리오 요약 문장

> Fulfillment 이벤트 스트림을 중심으로  
> Ingest / Indexer / Search / Batch를 분리한 구조를 설계·구현하여  
> 실무형 OMS/WMS/TMS 기반 데이터 파이프라인을 구축했다.
