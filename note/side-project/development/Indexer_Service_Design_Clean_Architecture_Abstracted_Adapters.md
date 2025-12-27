# Indexer Service Design (Clean Architecture 기반, Adapter 추상화 강화)

## Fan-in Kafka → Dedup → Merge Policy → Projection Store 적재 (Search Engine 구현: Elasticsearch)

본 문서는 Stage 2의 **indexer-service** 설계를 클린 아키텍처 기준으로 정리한다.  
특히 “기술 교체 용이성(예: OpenSearch)”을 위해 **Adapter를 역할 기반으로 추상화**하고,
구현 기술은 adapter 하위의 *implementation folder*에서만 드러나도록 구성한다.

핵심 원칙:

- UseCase/Domain은 **Kafka/DB/Search Engine 기술 타입을 import 하지 않는다**
- 외부 연동은 Port(인터페이스)로 추상화하고 Adapter가 구현한다
- Search Engine 의존(DSL/Client/Bulk/Mapping)은 `projection_store/*/*` 안으로 격리한다

---

## 1. 역할 요약

indexer-service는 Kafka(oms-events, wms-events, tms-events)를 fan-in으로 소비하여,
중복 제거(dedup) 및 out-of-order merge policy를 적용하고,
운영 조회용 Read Model(Projection)을 **Projection Store**에 적재한다.

---

## 2. 책임 범위

- Kafka 이벤트 소비 (fan-in: 3 topics)
- Canonical Fulfillment Event 처리
- Dedup(eventId 기준, persistence 기록)
- Merge Policy 적용(순서 뒤섞임 흡수)
- Projection Store 저장
  - shipments (upsert: Fulfillment Case 카드)
  - shipment_events (append: Fulfillment 타임라인)

---

## 3. 전체 처리 흐름

Kafka (3 topics)
→ Indexer
→ Dedup Persistence (event_dedup)
→ Merge Policy
→ Projection Store

- shipments (upsert)
- shipment_events (append)

---

## 4. Adapter 추상화 전략

### 4.1 “무엇을” 추상화하나?

- **Inbound**: Kafka(메시지 브로커)는 입력 어댑터
- **Outbound**:
  - Dedup 저장소 = Persistence
  - Read Model 저장소 = Projection Store(검색엔진)

### 4.2 “어디에” 구현 기술을 노출하나?

- `adapters/outbound/persistence/**/*`
- `adapters/outbound/projection_store/**/*`

즉 “persistence / projection_store”는 역할(추상)이고,  
“elasticsearch” 같은 폴더에서만 기술이 드러난다.

---

## 5. Clean Architecture 패키지 구조 (권장)

```
indexer-service/
  application/
    IndexFulfillmentEventUseCase.java
    ports/
      projection_store/
        ShipmentProjectionWritePort.java     # shipments upsert (추상)
        ShipmentEventLogWritePort.java       # shipment_events append (추상)
      persistence/
        EventDedupPort.java                  # dedup 기록/조회 (추상)

  domain/
    shipment/
      ShipmentProjection.java
      ShipmentStatus.java
    policy/
      MergePolicy.java
      StatusResolver.java
      DurationCalculator.java
      LateCalculator.java

  adapters/
    inbound/
      message/
        FulfillmentEventListener.java        # 메시지 수신(현재 Kafka)
        MessageEnvelopeMapper.java           # record/envelope → canonical 변환
        MessageConsumerConfig.java           # (선택) 메시지 구독 설정

    outbound/
      projection_store/
        shipments/
          ShipmentProjectionWriterAdapter.java        # Port 구현(역할 이름)
            elasticsearch/
              ElasticsearchShipmentProjectionWriter.java
              EsBulkWriter.java
              EsDocumentMapper.java
        shipment_events/
          ShipmentEventLogWriterAdapter.java          # Port 구현(역할 이름)
            elasticsearch/
              ElasticsearchShipmentEventLogWriter.java
              EsEventLogMapper.java

      persistence/
        event_dedup/
          EventDedupPersistenceAdapter.java           # Port 구현(역할 이름)
            jpa/
              EventDedupJpaEntity.java
              EventDedupJpaRepository.java
              EventDedupMapper.java

  config/
    InboundMessagingConfig.java               # (현재 Kafka 설정)
    ProjectionStoreConfig.java                # Elasticsearch 구현 bean 선택
    PersistenceConfig.java                    # JPA 구현 bean 선택
```

원칙:

- UseCase는 Port 인터페이스만 의존
- Kafka/JPA/Elasticsearch 관련 코드는 adapter의 implementation 아래로 격리
- Port/UseCase/Domain에는 “eventId/orderId/condition” 같은 의미 모델만 존재

---

## 6. Application Layer (UseCase)

### 6.1 IndexFulfillmentEventUseCase 흐름

1. 입력: `CanonicalFulfillmentEvent`
2. Dedup: `EventDedupPort.tryMarkProcessed(eventId, meta)`
   - 이미 처리됨이면 즉시 return
3. Merge: `MergePolicy.apply(event, currentProjection?)`
4. Projection write:
   - `ShipmentProjectionWritePort.upsert(patch)`
   - `ShipmentEventLogWritePort.append(eventRow)`

> UseCase는 “어디에 저장되는지(Elasticsearch/다른 엔진)”를 모른다.

---

## 7. Domain Layer (Merge Policy 핵심 규칙)

- Out-of-order 이벤트 허용
- Timestamp 기반 병합 (필드별 min/max/존재 기반)
- Status 우선순위 계산(“마지막 이벤트” 금지)
- Cancel vs Delivered 충돌 규칙
- Late 계산 규칙 (deliveredAt vs estimatedDeliveryAt)

---

## 8. Dedup 전략 (Persistence)

- eventId = sha256(orderId|eventType|eventAt|source)
- event_dedup에 PK로 기록
- 이미 처리된 eventId면 스킵

---

## 9. Projection Store 저장 전략

### 9.1 shipments (upsert)

- 주문 1건 요약 카드(Read Model)
- 부분 업데이트(upsert)로 점진적 완성

### 9.2 shipment_events (append)

- 주문 이벤트 타임라인(Read Model)
- 디버깅/감사용

---

## 10. 완료 기준

- 이벤트 순서가 뒤섞여도 최종 `shipments`가 일관됨
- replay 재실행 시 결과 동일(dedup/멱등)
- 인덱스 삭제 후 재처리로 복구 가능(Projection rebuild)
- Search Engine 교체는 `projection_store/**/*` 교체로 국한됨

---

> 본 설계는 “CQRS Read Model Builder” 패턴을 Clean Architecture로 구현하면서,
> 검색엔진 교체를 adapter 구현 교체로 제한하는 것을 목표로 한다.
