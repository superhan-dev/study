# Ops Search Service Design (Clean Architecture 기반, Search Engine 추상화)

## Fulfillment Ops Search API (Projection Store + KPI(Persistence) Serving, Elasticsearch 구현)

본 문서는 Stage 2(Serving)의 **ops-search-service**를 클린 아키텍처로 설계하되,
향후 검색엔진 교체(OpenSearch 등)를 쉽게 하기 위해 **Search Engine 의존을 추상화**하는 구조를 제시한다.

- 코어(application/domain)는 “Projection Store에서 조회한다”만 알며,
- Elasticsearch Query DSL/Client는 **outbound adapter 내부**에만 존재한다.

> 현재 구현 기준은 Elasticsearch이며, 교체 가능성을 위해 Port/Adapter 경계를 설계한다.

---

## 1. 역할 요약

ops-search-service는 운영자(Ops)가 사용하는 **서빙(Online Path)** API다.

- 입력: HTTP 요청(검색/필터/집계/KPI/타임라인)
- 조회: Projection Store(검색엔진) + Persistence(KPI) + Cache(옵션)
- 출력: JSON 응답

---

## 2. 책임 범위

- 지연 주문 검색/페이징
- 병목 구간 탐색(duration 기반)
- 주문 단위 타임라인 조회
- Lane KPI 조회(route_stats_daily)
- (선택) 추천 API (Stage 3 이후 확장)
- 캐시 전략(선택)

비범위:

- Projection 생성(Indexer) ❌
- KPI 계산(Batch) ❌
- 원본 트랜잭션 변경 ❌

---

## 3. 데이터 흐름

Client/Dashboard
→ ops-search-service

- Projection Store 조회 (shipments/shipment_events)
- Persistence 조회 (route_stats_daily)
- Cache (optional)
  → JSON Response

---

## 4. Search Engine 추상화 (Projection Store)

### 4.1 숨기는 것

- Elasticsearch/OpenSearch Client
- Query DSL(JSON)
- Aggregation 구현 세부

### 4.2 코어가 아는 것(Port)

- `ShipmentProjectionSearchPort.search(condition)`
- `ShipmentEventLogSearchPort.findByOrderId(orderId)`

코어는 **조건 객체(의미 기반)** 만 만든다:

- `ShipmentSearchCondition`
- `BottleneckQuery`

---

## 5. Clean Architecture 패키지 구조 (권장)

```
ops-search-service/
  application/
    usecases/
      SearchShipmentsUseCase.java
      GetShipmentTimelineUseCase.java
      GetLaneKpiUseCase.java
    ports/
      projection_store/
        ShipmentProjectionSearchPort.java    # 추상
        ShipmentEventLogSearchPort.java      # 추상
      persistence/
        LaneKpiReadPort.java                 # 추상
      cache/
        CachePort.java                       # 추상(옵션)

  domain/
    query/
      ShipmentSearchCondition.java
      BottleneckQuery.java
      LaneKpiQuery.java
    model/
      ShipmentView.java
      ShipmentEventView.java
      LaneKpiView.java
    policy/
      CacheKeyPolicy.java
      PaginationPolicy.java (optional)

  adapters/
    inbound/
      http/
        OpsSearchController.java
        RequestDtoMapper.java                # HTTP DTO → domain condition
        ResponseDtoMapper.java               # View → HTTP response DTO

    outbound/
      projection_store/
        elasticsearch/
          ElasticsearchShipmentProjectionSearchAdapter.java
          ElasticsearchShipmentEventLogSearchAdapter.java
          EsQueryBuilder.java
          EsHitMapper.java

      persistence/
        lane_kpi/
          LaneKpiPersistenceAdapter.java
          LaneKpiJpaRepository.java (예)
          LaneKpiMapper.java

      cache/
        redis/
          RedisCacheAdapter.java (optional)

  config/
    ProjectionStoreConfig.java               # Elasticsearch beans
    PersistenceConfig.java
    RedisConfig.java (optional)
    WebConfig.java
```

---

## 6. API 설계 (대표)

- `GET /ops/shipments` : 검색/필터/페이징
- `GET /ops/shipments/bottlenecks` : 병목 구간 탐색
- `GET /ops/shipments/{orderId}/events` : 타임라인
- `GET /ops/kpi/lanes` : Lane KPI 조회

---

## 7. Query 설계 원칙

- Projection Store 쿼리는 Filter 중심(ops 검색은 scoring 불필요)
- Pagination/Sort 제한(화이트리스트)
- 무거운 aggregation은 캐시 후보(옵션)

---

## 8. DTO(Command/Query) vs Mapper 가이드

- HTTP Request DTO → domain `Condition/Query`로 변환: inbound mapper
- Projection Store 결과(hit/doc) → `View`로 변환: outbound mapper
- Persistence row/entity → `LaneKpiView` 변환: outbound mapper

> 요약: 유스케이스 경계는 Condition/Query, 저장/조회 변환은 Mapper가 담당.

---

## 9. 완료 기준

- 지연/병목/타임라인/KPI 조회가 안정적으로 동작
- ops-search-service는 Projection Store/Persistence만 조회(쓰기 없음)
- 검색엔진 교체는 `projection_store/*` 구현체 교체로 국한

---

> 본 설계는 운영자 서빙 API를 Clean Architecture로 구성하면서,
> Elasticsearch 의존을 outbound adapter로 격리해 교체 가능성을 확보한다.
