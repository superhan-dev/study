# Airflow와 Service A(Data Replay Service) 역할 비교 요약

## 🎯 핵심 개념

### "CSV를 누가 읽는가?"

**❌ 잘못된 이해**: Service A가 CSV를 읽고 파싱하고 이벤트 생성

**✅ 올바른 이해**: **Airflow**가 CSV를 읽고, Service A는 단순히 **API로 받은 이벤트를 저장만**

---

## 📊 역할 분담

```
┌─────────────────────────────────────────┐
│          Airflow (외부 클라이언트)        │
│                                          │
│  책임:                                   │
│  1. CSV 파일 읽기 (Pandas)               │
│  2. 각 행을 이벤트로 변환                │
│  3. 속도 제어 (time.sleep)               │
│  4. Service A API 호출 (HTTP)            │
│  5. 체크포인트 저장 (재시작용)           │
│  6. 에러 처리 및 재시도                  │
└─────────────┬───────────────────────────┘
              │
              │ HTTP POST /api/v1/events
              │
              ▼
┌─────────────────────────────────────────┐
│         Service A (Spring Boot)          │
│                                          │
│  책임:                                   │
│  1. Event API 제공 (REST)                │
│  2. 이벤트 검증 (필수 필드 체크)         │
│  3. events 테이블 INSERT                 │
│  4. Replay Job 상태 관리                 │
│  5. 체크포인트 조회 API 제공             │
└─────────────┬───────────────────────────┘
              │
              ▼
     PostgreSQL (events 테이블)
              │
              ▼
          Debezium CDC
              │
              ▼
            Kafka
```

---

## 🔄 데이터 흐름 (Step-by-Step)

### Step 1: Airflow DAG 시작

```python
# Airflow Task
def replay_csv():
    # 1. CSV 파일 읽기
    df = pd.read_csv("/data/olist_orders.csv")

    # 2. Replay Job 생성
    replay_id = "replay_001"
    requests.post("http://service-a:8080/api/v1/replay-jobs", json={
        "replayJobId": replay_id,
        "totalEvents": len(df)
    })

    # 3. 각 행을 순회하며 이벤트 전송
    for index, row in df.iterrows():
        # ...
```

### Step 2: Service A가 이벤트 수신 및 저장

```java
@PostMapping("/api/v1/events")
public ResponseEntity<EventResponse> saveEvent(@RequestBody EventRequest request) {
    // 1. 검증
    validateEvent(request);

    // 2. Entity 생성
    Event event = Event.builder()
        .eventId(UUID.randomUUID())
        .eventType(request.getEventType())
        .payload(request.getPayload())
        .occurredAt(request.getOccurredAt())
        .replayJobId(request.getReplayJobId())
        .build();

    // 3. DB 저장 (트랜잭션)
    eventRepository.save(event);

    return ResponseEntity.status(201).build();
}
```

### Step 3: CDC가 자동으로 Kafka 발행

```
PostgreSQL events 테이블 INSERT
        ↓
Debezium이 WAL 로그 감지
        ↓
Kafka raw_events 토픽 발행
        ↓
Service B가 소비
```

---

## 🆚 비교표

| 항목            | Airflow            | Service A               |
| --------------- | ------------------ | ----------------------- |
| **CSV 읽기**    | ✅ Pandas          | ❌ 안 함                |
| **이벤트 변환** | ✅ Dict → JSON     | ❌ 안 함                |
| **속도 제어**   | ✅ time.sleep()    | ❌ 안 함                |
| **API 호출**    | ✅ requests.post() | ❌ API 제공만           |
| **DB 저장**     | ❌ 직접 안 함      | ✅ events 테이블 INSERT |
| **CDC**         | ❌ 모름            | ✅ 트리거됨 (자동)      |
| **체크포인트**  | ✅ 주기적 저장     | ✅ 저장 API 제공        |
| **재시작**      | ✅ Task 재실행     | ❌ 상태 제공만          |

---

## 💡 왜 이렇게 분리하나?

### 1. **관심사의 분리 (Separation of Concerns)**

```
Airflow: "데이터를 어떻게 읽고 언제 보낼까?" (Orchestration)
Service A: "이벤트를 어떻게 저장하고 관리할까?" (Domain)
```

### 2. **확장성 (Scalability)**

```
Airflow: 여러 CSV를 병렬로 처리 (Multi-task)
Service A: HTTP 요청만 받으면 됨 (Stateless)
```

### 3. **재사용성 (Reusability)**

```
Service A의 Event API는:
- Airflow에서 호출
- 다른 시스템(예: Admin UI)에서도 호출 가능
- Postman으로 수동 테스트 가능
```

### 4. **에러 처리 (Error Handling)**

```
Airflow: 재시도, 알림, 에러 로깅 (강력한 기능)
Service A: 단순 검증 및 저장 (심플)
```

---

## 🔧 실전 예시

### Airflow DAG (완전한 예시)

```python
from airflow import DAG
from airflow.operators.python import PythonOperator
import pandas as pd
import requests
import time
from datetime import datetime

def replay_orders_csv(**context):
    replay_id = f"replay_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    # 1. Replay Job 생성
    requests.post("http://service-a:8080/api/v1/replay-jobs", json={
        "replayJobId": replay_id,
        "status": "RUNNING"
    })

    # 2. CSV 읽기
    df = pd.read_csv("/data/olist_orders.csv")
    df = df.sort_values("order_purchase_timestamp")

    total = len(df)
    processed = 0

    # 3. 체크포인트 조회 (재시작 시)
    checkpoint_response = requests.get(
        f"http://service-a:8080/api/v1/replay-jobs/{replay_id}/checkpoint"
    )

    if checkpoint_response.status_code == 200:
        last_line = checkpoint_response.json().get("lastLineNumber", 0)
        df = df.iloc[last_line:]  # 마지막 위치부터

    # 4. 각 행 처리
    for index, row in df.iterrows():
        event = {
            "eventType": "OrderPlaced",
            "aggregateId": row["order_id"],
            "payload": {
                "customerId": row["customer_id"],
                "sellerId": row["seller_id"],
                "productId": row["product_id"]
            },
            "occurredAt": row["order_purchase_timestamp"],
            "replayJobId": replay_id
        }

        # 5. Service A로 전송
        try:
            response = requests.post(
                "http://service-a:8080/api/v1/events",
                json=event,
                timeout=5
            )
            response.raise_for_status()
        except Exception as e:
            print(f"Error sending event: {e}")
            raise

        processed += 1

        # 6. 속도 제어 (10배속 = 0.1초 대기)
        time.sleep(0.1)

        # 7. 체크포인트 저장 (100개마다)
        if processed % 100 == 0:
            requests.put(
                f"http://service-a:8080/api/v1/replay-jobs/{replay_id}",
                json={
                    "processedEvents": processed,
                    "lastLineNumber": index
                }
            )

    # 8. 완료
    requests.put(
        f"http://service-a:8080/api/v1/replay-jobs/{replay_id}",
        json={"status": "COMPLETED", "processedEvents": total}
    )

dag = DAG(
    "olist_replay",
    schedule_interval=None,
    start_date=datetime(2026, 1, 1),
)

replay_task = PythonOperator(
    task_id="replay_csv",
    python_callable=replay_orders_csv,
    dag=dag,
)
```

---

### Service A API (완전한 예시)

```java
@RestController
@RequestMapping("/api/v1/events")
public class EventController {

    private final EventRepository eventRepository;
    private final ReplayJobRepository replayJobRepository;

    @PostMapping
    public ResponseEntity<EventResponse> saveEvent(
        @RequestBody @Valid EventRequest request
    ) {
        // 1. 검증
        if (request.getEventType() == null) {
            return ResponseEntity.badRequest().build();
        }

        // 2. Event Entity 생성
        Event event = Event.builder()
            .eventId(UUID.randomUUID())
            .eventType(request.getEventType())
            .aggregateId(request.getAggregateId())
            .payload(request.getPayload())
            .occurredAt(request.getOccurredAt())
            .replayJobId(request.getReplayJobId())
            .ingestedAt(LocalDateTime.now())
            .build();

        // 3. DB 저장 (트랜잭션)
        eventRepository.save(event);

        // 4. Replay Job 진행 상황 업데이트 (비동기)
        if (request.getReplayJobId() != null) {
            replayJobRepository.incrementProcessedEvents(
                request.getReplayJobId()
            );
        }

        return ResponseEntity.status(201).body(
            new EventResponse(event.getEventId(), "SAVED")
        );
    }
}

@RestController
@RequestMapping("/api/v1/replay-jobs")
public class ReplayJobController {

    @PostMapping
    public ResponseEntity<ReplayJobResponse> createReplayJob(
        @RequestBody ReplayJobRequest request
    ) {
        ReplayJob job = ReplayJob.builder()
            .replayJobId(request.getReplayJobId())
            .totalEvents(request.getTotalEvents())
            .status(ReplayStatus.RUNNING)
            .createdAt(LocalDateTime.now())
            .build();

        replayJobRepository.save(job);

        return ResponseEntity.status(201).body(
            new ReplayJobResponse(job.getReplayJobId(), "CREATED")
        );
    }

    @PutMapping("/{replayJobId}")
    public ResponseEntity<Void> updateProgress(
        @PathVariable String replayJobId,
        @RequestBody ProgressUpdate update
    ) {
        ReplayJob job = replayJobRepository.findById(replayJobId)
            .orElseThrow(() -> new NotFoundException("Replay job not found"));

        job.setProcessedEvents(update.getProcessedEvents());
        job.setLastProcessedAt(LocalDateTime.now());

        if (update.getStatus() != null) {
            job.setStatus(update.getStatus());
        }

        replayJobRepository.save(job);

        return ResponseEntity.ok().build();
    }

    @GetMapping("/{replayJobId}/checkpoint")
    public ResponseEntity<CheckpointResponse> getCheckpoint(
        @PathVariable String replayJobId
    ) {
        CsvOffset offset = csvOffsetRepository.findByReplayJobId(replayJobId)
            .orElse(new CsvOffset(replayJobId, 0));

        return ResponseEntity.ok(
            new CheckpointResponse(offset.getLastLineNumber())
        );
    }
}
```

---

## ✅ 요약

### Airflow의 책임

1. ✅ CSV 파일 읽기
2. ✅ 데이터 변환
3. ✅ 속도 제어
4. ✅ Service A API 호출
5. ✅ 에러 처리 및 재시도

### Service A의 책임

1. ✅ Event API 제공
2. ✅ 이벤트 저장 (DB)
3. ✅ Replay Job 상태 관리
4. ✅ 체크포인트 API 제공
5. ✅ CDC 트리거 (자동)

### 서로 통신하는 방법

- **Airflow → Service A**: HTTP REST API
- **Service A → Kafka**: Debezium CDC (자동)

---

**이제 명확하게 이해되셨나요?** 🎯

Airflow는 "CSV 읽는 클라이언트"이고,
Service A는 "이벤트 받아서 저장하는 서버"입니다!
