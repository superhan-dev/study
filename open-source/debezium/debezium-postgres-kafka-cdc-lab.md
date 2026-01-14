# 📘 Debezium + PostgreSQL + Kafka CDC 실습 가이드 (WAL 기반)

## 1. 실습 목적

이 문서는 PostgreSQL의 데이터 변경 사항을 **WAL(Logical Replication)** 기반으로 캡처하여  
**Debezium → Kafka → Consumer** 흐름으로 전달되는 **CDC(Change Data Capture)** 파이프라인을  
로컬 환경에서 직접 검증한 실습 과정을 정리한다.

> 핵심 개념  
> **DB가 Source of Truth이고 Kafka는 DB 변경의 스트림 표현이다.**

---

## 2. 전체 아키텍처 개요

```
PostgreSQL
  └─ WAL (Logical Replication)
        ↓
Debezium Postgres Connector (Kafka Connect)
        ↓
Kafka Topic (dbserver1.inventory.customers)
        ↓
Kafka Consumer
```

---

## 3. 사전 준비

- Docker / Docker Compose
- curl
- 로컬 터미널(macOS 기준)

---

## 4. Docker Compose로 실습 환경 구성

### 4.1 Debezium 예제 compose 다운로드

```bash
mkdir debezium-lab && cd debezium-lab
curl -L -o docker-compose-postgres.yaml   https://raw.githubusercontent.com/debezium/debezium-examples/main/tutorial/docker-compose-postgres.yaml
```

### 4.2 Debezium 버전 지정

```bash
echo "DEBEZIUM_VERSION=3.1" > .env
```

### 4.3 컨테이너 실행

```bash
docker compose -f docker-compose-postgres.yaml up -d
```

---

## 5. Debezium Postgres Connector 등록

```bash
cat > register-postgres.json <<'JSON'
{
  "name": "inventory-connector",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "tasks.max": "1",
    "database.hostname": "postgres",
    "database.port": "5432",
    "database.user": "postgres",
    "database.password": "postgres",
    "database.dbname": "postgres",
    "topic.prefix": "dbserver1",
    "schema.include.list": "inventory",
    "plugin.name": "pgoutput"
  }
}
JSON
```

---

## 6. PostgreSQL 데이터 변경 실습

```sql
INSERT INTO inventory.customers(first_name, last_name, email)
VALUES ('Liam', 'Han', 'liam@example.com');

UPDATE inventory.customers
SET email = 'liam2@example.com'
WHERE first_name = 'Liam' AND last_name = 'Han';

DELETE FROM inventory.customers
WHERE first_name = 'Liam' AND last_name = 'Han';
```

---

## 7. Kafka CDC 이벤트 Consume

```bash

kafka-console-consumer.sh \
  --bootstrap-server kafka:9092 \
  --topic dbserver1.inventory.customers \
  --from-beginning
```

이와 같이 실행하고 데이터를 변경하면 실시간으로 다음과 같은 로그를 확인할 수 있다.

```bash
{"schema":{"type":"struct","fields":[{"type":"struct","fields":[{"type":"int32","optional":false,"default":0,"field":"id"},{"type":"string","optional":false,"field":"first_name"},{"type":"string","optional":false,"field":"last_name"},{"type":"string","optional":false,"field":"email"}],"optional":true,"name":"dbserver1.inventory.customers.Value","field":"before"},{"type":"struct","fields":[{"type":"int32","optional":false,"default":0,"field":"id"},{"type":"string","optional":false,"field":"first_name"},{"type":"string","optional":false,"field":"last_name"},{"type":"string","optional":false,"field":"email"}],"optional":true,"name":"dbserver1.inventory.customers.Value","field":"after"},{"type":"struct","fields":[{"type":"string","optional":false,"field":"version"},{"type":"string","optional":false,"field":"connector"},{"type":"string","optional":false,"field":"name"},{"type":"int64","optional":false,"field":"ts_ms"},{"type":"string","optional":true,"name":"io.debezium.data.Enum","version":1,"parameters":{"allowed":"true,first,first_in_data_collection,last_in_data_collection,last,false,incremental"},"default":"false","field":"snapshot"},{"type":"string","optional":false,"field":"db"},{"type":"string","optional":true,"field":"sequence"},{"type":"int64","optional":true,"field":"ts_us"},{"type":"int64","optional":true,"field":"ts_ns"},{"type":"string","optional":false,"field":"schema"},{"type":"string","optional":false,"field":"table"},{"type":"int64","optional":true,"field":"txId"},{"type":"int64","optional":true,"field":"lsn"},{"type":"int64","optional":true,"field":"xmin"}],"optional":false,"name":"io.debezium.connector.postgresql.Source","version":1,"field":"source"},{"type":"struct","fields":[{"type":"string","optional":false,"field":"id"},{"type":"int64","optional":false,"field":"total_order"},{"type":"int64","optional":false,"field":"data_collection_order"}],"optional":true,"name":"event.block","version":1,"field":"transaction"},{"type":"string","optional":false,"field":"op"},{"type":"int64","optional":true,"field":"ts_ms"},{"type":"int64","optional":true,"field":"ts_us"},{"type":"int64","optional":true,"field":"ts_ns"}],"optional":false,"name":"dbserver1.inventory.customers.Envelope","version":2},"payload":{"before":{"id":1006,"first_name":"Liam","last_name":"Han","email":"liam2@example.com"},"after":{"id":1006,"first_name":"Liam","last_name":"Han","email":"liam3@example.com"},"source":{"version":"3.1.3.Final","connector":"postgresql","name":"dbserver1","ts_ms":1766925059528,"snapshot":"false","db":"postgres","sequence":"[\"34389280\",\"34389336\"]","ts_us":1766925059528750,"ts_ns":1766925059528750000,"schema":"inventory","table":"customers","txId":779,"lsn":34389336,"xmin":null},"transaction":null,"op":"u","ts_ms":1766925059873,"ts_us":1766925059873428,"ts_ns":1766925059873428925}}
```

---

## 8. Debezium 이벤트 해석

| op  | 의미     |
| --- | -------- |
| r   | snapshot |
| c   | insert   |
| u   | update   |
| d   | delete   |

---

## 9. 요약

환경을 구성하여 실제로 PostgreSQL을 실행하여 데이터를 조작함으로써
PostgreSQL WAL 기반 CDC를 Debezium으로 캡처하여 Kafka 토픽으로 발행하고,
Consumer를 통해 실시간으로 consuming하는 전체 흐름을 검증하였다.
