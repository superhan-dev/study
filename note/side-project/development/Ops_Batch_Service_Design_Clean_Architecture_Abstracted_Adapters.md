# Ops Batch Service Design (Clean Architecture 기반, Adapter 추상화 강화)

## KPI Batch / Fulfillment Intelligence (Projection Store → KPI 계산 → Persistence 적재)

### (Search Engine 구현: Elasticsearch)

본 문서는 EIP Stage 3에서 사용하는 **ops-batch-service(KPI Batch)** 를
클린 아키텍처 기반으로 개발하기 위한 설계 문서다.  
또한 향후 검색엔진 교체(OpenSearch 등)를 쉽게 하기 위해 **Adapter를 역할 기반으로 추상화**한다.

목표:

- 운영 조회용 Read Model(Projection)을 **Projection Store**에서 읽어
- Fulfillment Lane KPI를 **시간 윈도우(일/주)** 단위로 집계하고
- **Persistence 계층**을 통해 `route_stats_daily`에 스냅샷으로 저장한다.

> 주의: 본 문서에서 “Projection Store”는 Elasticsearch/OpenSearch 등의 검색엔진을 추상화한 표현이다.  
> 또한 “Persistence”는 PostgreSQL/JPA/JdbcTemplate 등 저장 기술을 숨기는 표현이다.

---

## 1. 역할 요약

ops-batch-service는 “운영 판단용 지표(Intelligence)”를 생성하는 배치 서비스다.

- 입력: Projection Store의 `shipments` (Read Model)
- 처리: lane(출고지→도착지) 기준 KPI 집계
- 출력: Persistence 저장소의 `route_stats_daily` (스냅샷)

---

## 2. 책임 범위

- 집계 대상 기간 선정(예: 하루/최근 30일)
- Fulfillment Lane 정의: seller_region → customer_region (기본은 state)
- KPI 계산:
  - sample_count
  - avg_lead_time_sec
  - late_rate
  - (선택) p95_lead_time_sec
- Persistence upsert(스냅샷 저장)
- 재계산/리빌드 지원(rebuild mode)
- 배치 스케줄링(cron) 또는 수동 실행

비범위:

- 실시간 Projection 생성(Indexer) ❌
- 운영자 조회 API(Serving) ❌
- 원본 주문/배송 상태 변경 ❌

---

## 3. 데이터 흐름 (Batch Data Flow)

Projection Store (shipments)
→ Ops Batch Service

- read (aggregation/scan)
- compute KPI
  → Persistence (route_stats_daily upsert)

---

## 4. 입력/출력 데이터 모델

### 4.1 Input: shipments (필수 필드)

- sellerRegion.state
- customerRegion.state
- durations.orderToDeliverySec (또는 orderedAt/deliveredAt로 계산)
- isLate (또는 deliveredAt vs estimatedDeliveryAt로 재판단 가능)
- deliveredAt (배송 완료된 주문만 샘플로 사용)

### 4.2 Output: route_stats_daily (KPI Snapshot)

- stat_date (date)
- seller_state (text)
- customer_state (text)
- sample_count (int)
- avg_lead_time_sec (bigint)
- late_rate (numeric)
- p95_lead_time_sec (bigint, optional)

---

## 5. 저장 스키마 (DDL 예시)

```sql
CREATE TABLE IF NOT EXISTS route_stats_daily (
  stat_date date NOT NULL,
  seller_state text NOT NULL,
  customer_state text NOT NULL,
  sample_count int NOT NULL,
  avg_lead_time_sec bigint NOT NULL,
  late_rate numeric(7,6) NOT NULL,
  p95_lead_time_sec bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stat_date, seller_state, customer_state)
);
```

---

## 6. 집계 정의 (KPI 공식)

### 6.1 샘플 선정

- deliveredAt이 존재하는 주문만 집계 대상
- (선택) 특정 기간 내 deliveredAt 기준 필터

### 6.2 Lane 정의

- lane = (seller_state, customer_state)

### 6.3 KPI

- sample_count = COUNT(\*)
- avg_lead_time_sec = AVG(orderToDeliverySec)
- late_rate = SUM(isLate=true) / COUNT(\*)
- p95_lead_time_sec = PERCENTILE(0.95)

---

## 7. 구현 방식 옵션 (Aggregation vs Scan)

### 옵션 A — Projection Store Aggregation 기반 (빠르고 간단)

- date_histogram(stat_date) + terms(seller_state, customer_state)
- avg + sum + bucket_script(late_rate)
- percentiles(p95) (선택)

장점: 간단, 검색엔진에서 대부분 처리  
단점: 복잡한 정합성/필터 로직은 제한될 수 있음

### 옵션 B — Scan/Scroll 기반 (정합성/확장에 유리)

- 기간 범위 shipments를 scroll로 읽음
- 서비스 내부에서 그룹핑/통계 계산
- 결과를 Persistence에 upsert

장점: 로직 자유도 높음, 확장 쉬움  
단점: 구현/리소스 비용 증가

> 학습/실무 감각 목적이면 **옵션 A로 시작**하고 필요 시 B로 확장 추천.

---

## 8. Clean Architecture 적용 구조 (Adapter 추상화)

```
ops-batch-service/
  application/
    usecases/
      AggregateRouteStatsUseCase.java
      RebuildRouteStatsUseCase.java (optional)
    ports/
      projection_store/
        ShipmentAggregationReadPort.java     # shipments 집계/읽기(추상)
      persistence/
        RouteStatsWritePort.java             # route_stats_daily upsert(추상)
      lock/
        BatchLockPort.java                   # 중복 실행 방지(선택)
      clock/
        ClockPort.java

  domain/
    lane/
      FulfillmentLane.java
    metric/
      RouteKpi.java
    policy/
      WindowPolicy.java
      LatePolicy.java (optional)
      PercentilePolicy.java

  adapters/
    inbound/
      scheduler/
        DailyBatchScheduler.java             # @Scheduled
      http/
        BatchAdminController.java (optional) # 수동 실행/리빌드
      cli/
        BatchCliRunner.java (optional)

    outbound/
      projection_store/
        shipments/
          ShipmentAggregationReaderAdapter.java
            elasticsearch/
              ElasticsearchShipmentAggregationReader.java
              EsAggregationQueryBuilder.java
              EsAggResultMapper.java

      persistence/
        route_stats/
          RouteStatsPersistenceAdapter.java
            jpa/
              RouteStatsJpaEntity.java
              RouteStatsId.java
              RouteStatsJpaRepository.java
              RouteStatsMapper.java

      lock/
        distributed/
          BatchLockAdapter.java
            redis/
              RedisBatchLock.java

  config/
    ProjectionStoreConfig.java
    PersistenceConfig.java
    SchedulerConfig.java
    LockConfig.java
```

원칙:

- UseCase는 Port만 의존
- 검색엔진/DB 구현 디테일은 `*` 안에만 존재
- 스케줄러/HTTP/CLI는 inbound adapter로 분리

---

## 9. DTO(Command/Query) vs Mapper 적용 가이드

- Command/Query는 **UseCase 호출 경계**(스케줄러/HTTP/CLI → UseCase)에서 사용
- Mapper는 **Port ↔ Adapter 경계**에서 저장/조회 형식 변환을 담당
- 본 설계는 **완전 매핑(Full Mapping) + 단방향 매핑** 성격이 강함(코어 → persistence)

---

## 10. 스케줄링 / 실행 모델

- 기본: 매일 02:00 전일 KPI 산출 (예: `0 0 2 * * *`)
- rebuild: 날짜 범위 재계산 후 upsert 덮어쓰기
- 중복 실행 방지(선택): 분산락/DB락

---

## 11. 완료 기준 (Definition of Done)

- 지정 날짜(stat_date)의 KPI가 `route_stats_daily`에 저장
- 배치 재실행 시 같은 결과 재현(결정적 집계)
- Projection Store 교체는 `projection_store/**/*` 변경으로 국한

---

## 12. 포트폴리오 요약 문장

> Projection Store(shipments)를 입력으로 Fulfillment Lane KPI를 집계하고  
> Persistence 계층을 통해 `route_stats_daily`에 스냅샷으로 적재하는 KPI Batch(ops-batch-service)를  
> Clean Architecture 기반으로 설계·구현했다.
