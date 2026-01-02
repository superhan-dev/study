# CDC의 기본 개념

Change Data Capture라는 개념으로 DB의 이벤트를 로그기반으로 감지해서 Kafka 토픽으로 발행할 때 사용되는 도구로 검색/분석/인덱싱 등 DB의 변화를 바로 감지한 뒤 데이터를 처리할 때 사용할 수 있는 기능이며, 이때 직접 DB를 조회하지 않고 로그를 기반으로 발행된 이벤트를 통해 데이터를 처리하므로 실제 서비스에는 사이드 이펙트를 주지않고 데이터를 처리할 수 있다는 장점이 있다.

# CDC로 무엇을 할 수 있을까?

> “DB에서 일어난 모든 ‘사실’을 시간 순서의 이벤트 스트림으로 얻는다.”

1. DB 변경을 실시간 이벤트로 전파

이벤트가 발생하면 다른 시스템으로 반응형 파이프라인을 구축할때 API 호출 없이도 시스템 간 동기화가 가능해진다.

```
INSERT / UPDATE / DELETE
↓
이벤트 스트림
↓
다른 시스템들이 즉시 반응
```

2. Read Model / Search Index 자동 생성

CDC + Consumer 조합으로 다음과 같은 조합들을 만들어낼 수 있게되며, CQRS에 적극적으로 반영할 수 있게 된다.

- Kafka → Elasticsearch
- Kafka → Redis
- Kafka → ClickHouse / BigQuery

```
OLTP DB (쓰기 최적화)
   ↓ CDC
Read DB / Search / Analytics (읽기 최적화)
```

3. DB를 Single Source of Truth로 유지

CDC가 없다면 “Kafka에 먼저 쓸까?” 또는 “DB에 먼저 쓸까?” 와 같은 고민들이 발생한다. 하지만 CDC 도입을 통해 Write를 한곳에서 처리하게되고 event는 DB 변경시 트리거가 되어 Kafka로 들어가게 되므로 일관적인 데이터 파이프라인을 구축하는데 용이하게 사용할 수 있다.

4. Backfill / Replay / Time-travel

CDC 이벤트는 로그이므로 특정 시점부터 다시 처리하고 장애가 난 Consumer만 재처리를 하거나 장애가 난 시점부터 재구성 할 수 있게 된다.

5. 감사 / 이력 / 추적

CDC 이벤트에는 항상 다음 로그가 남는다.

- before / after
- txId
- WAL 위치 (LSN)
- timestamp

따라서 누가/언제/어떻게 바꿨는지 자동으로 기록된다.

# Debezium

> Debezium은 “Kafka Connect 플러그인이다.” 더 정확히 말하면 Kafka Connect 위에서 동작하는 CDC Source Connector들의 집합이다.

Debezium은 다음과 같은 특징을 갖는다.

1. WAL / Binlog를 직접 읽는다

- PostgreSQL → WAL (Logical Replication)
- MySQL → binlog

2. 애플리케이션 코드 수정이 거의 없음
3. 트랜잭션 정합성 보장
4. 표준화된 이벤트 포맷 (Envelope)
5. Kafka Connect 기반 → 운영 친화적

# 언제 CDC + Debezium을 쓸까?

## 쓰면 좋은 경우

- 마이크로서비스
- CQRS
- 검색 / 통계 / 추천
- 레거시 연동
- 데이터 파이프라인

## 안 써도 되는 경우

- 단일 서비스 + 단일 DB
- 이벤트 필요 없음
- 트래픽 작고 단순한 CRUD
