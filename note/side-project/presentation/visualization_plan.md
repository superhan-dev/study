# 프로젝트 시각화 계획
## Grafana 대시보드 및 모니터링 전략

---

## 🎯 시각화 목적

### 1. **이벤트 흐름 확인**
- Service A → Kafka → Service B → Kafka → Service C 전체 파이프라인 모니터링
- 병목 구간 식별
- 데이터 동기화 상태 확인

### 2. **성능 측정**
- 각 서비스별 처리 속도
- 이벤트 처리 지연 시간
- Throughput (초당 이벤트 처리량)

### 3. **장애 감지**
- 이벤트 손실 여부
- 서비스 다운 감지
- 재시도/실패 추적

### 4. **비즈니스 인사이트**
- 배송 시간 67% 단축 검증
- 지역별 배송 성능
- 실시간 주문 현황

---

## 📊 대시보드 구성 (총 5개)

```
┌─────────────────────────────────────────────────────┐
│  1. Overview Dashboard (전체 현황)                   │
│     - 시스템 전체 상태 한눈에 보기                   │
│     - 경영진/PM용                                    │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  2. Event Flow Dashboard (이벤트 흐름)               │
│     - Service A → B → C 파이프라인                  │
│     - 개발자/엔지니어용                              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  3. Performance Dashboard (성능)                     │
│     - 처리 속도, 지연 시간, Throughput               │
│     - 성능 튜닝용                                    │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  4. Error & Retry Dashboard (에러/재시도)            │
│     - 실패한 이벤트, 재시도 현황                     │
│     - 장애 대응용                                    │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  5. Business Dashboard (비즈니스 지표)               │
│     - 배송 시간, 지역별 성능, 주문 현황              │
│     - 비즈니스 분석용                                │
└─────────────────────────────────────────────────────┘
```

---

## 1️⃣ Overview Dashboard (전체 현황)

### 목적
**"시스템이 정상인가? 문제 없나?"를 5초 안에 파악**

### 레이아웃
```
┌────────────────────────────────────────────────────────┐
│  Overview Dashboard                      [Last 1 hour] │
├────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Service A    │  │ Service B    │  │ Service C    │ │
│  │              │  │              │  │              │ │
│  │   ✅ UP      │  │   ✅ UP      │  │   ✅ UP      │ │
│  │   99,441     │  │   99,441     │  │   99,441     │ │
│  │   events     │  │   processed  │  │   projections│ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │  Event Pipeline (실시간)                           ││
│  │                                                     ││
│  │  Service A ──────▶ Kafka ──────▶ Service B ────┐  ││
│  │     99,441         raw_events      99,441      │  ││
│  │                                                 │  ││
│  │                                                 ▼  ││
│  │  Service C ◀───── Kafka ◀──────────────────────┘  ││
│  │     99,441       domain_events                     ││
│  └────────────────────────────────────────────────────┘│
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Total Events │  │ Success Rate │  │ Avg Latency  │ │
│  │              │  │              │  │              │ │
│  │   99,441     │  │   99.8%      │  │   234 ms     │ │
│  │   ⬆ +2.3%   │  │   ✅ Good    │  │   ✅ Good    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │  Events per Second (시계열)                        ││
│  │  1000 ┤                        ╭─╮                ││
│  │   800 ┤                    ╭───╯ ╰─╮              ││
│  │   600 ┤                ╭───╯       ╰─╮            ││
│  │   400 ┤            ╭───╯             ╰─╮          ││
│  │   200 ┤        ╭───╯                   ╰─╮        ││
│  │     0 ┴────────┴────────────────────────────────   ││
│  │       10:00   10:15   10:30   10:45   11:00       ││
│  └────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────┘
```

### 패널 목록

#### Panel 1-3: 서비스 상태 카드 (Stat)
```sql
-- Service A 상태
SELECT 
    COUNT(*) as total_events,
    CASE 
        WHEN MAX(ingested_at) > NOW() - INTERVAL '1 minute' 
        THEN 'UP' 
        ELSE 'DOWN' 
    END as status
FROM events
WHERE ingested_at > NOW() - INTERVAL '1 hour';
```

#### Panel 4: 이벤트 파이프라인 (Node Graph)
```sql
-- Service A → Kafka
SELECT 'Service A' as source, 'raw_events' as target, COUNT(*) as value
FROM events WHERE ingested_at > NOW() - INTERVAL '1 hour'

UNION ALL

-- Kafka → Service B
SELECT 'raw_events' as source, 'Service B' as target, COUNT(*) as value
FROM processed_events WHERE processed_at > NOW() - INTERVAL '1 hour'

UNION ALL

-- Service B → Service C
SELECT 'Service B' as source, 'Service C' as target, COUNT(*) as value
FROM order_projections WHERE updated_at > NOW() - INTERVAL '1 hour';
```

#### Panel 5: 총 이벤트 수 (Stat)
```sql
SELECT COUNT(*) FROM events 
WHERE ingested_at > NOW() - INTERVAL '1 hour';
```

#### Panel 6: 성공률 (Gauge)
```sql
SELECT 
    (COUNT(CASE WHEN processing_status = 'SUCCESS' THEN 1 END) * 100.0 / 
     COUNT(*)) as success_rate
FROM processed_events
WHERE processed_at > NOW() - INTERVAL '1 hour';
```

#### Panel 7: 평균 지연 시간 (Stat)
```sql
SELECT 
    AVG(EXTRACT(EPOCH FROM (processed_at - occurred_at))) as avg_latency_seconds
FROM processed_events pe
JOIN events e ON pe.event_id = e.event_id
WHERE pe.processed_at > NOW() - INTERVAL '1 hour';
```

#### Panel 8: 초당 이벤트 (Time Series)
```sql
SELECT 
    DATE_TRUNC('minute', ingested_at) as time,
    COUNT(*) / 60.0 as events_per_second
FROM events
WHERE ingested_at > NOW() - INTERVAL '1 hour'
GROUP BY time
ORDER BY time;
```

---

## 2️⃣ Event Flow Dashboard (이벤트 흐름)

### 목적
**"각 단계별로 몇 개씩 처리되고 있나? 어디서 막히나?"**

### 레이아웃
```
┌────────────────────────────────────────────────────────┐
│  Event Flow Dashboard                    [Last 5 min]  │
├────────────────────────────────────────────────────────┤
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │  Service A: Event Ingestion                        ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐││
│  │  │ Total Events │  │ Events/sec   │  │ Last Event│││
│  │  │   1,234      │  │   245        │  │ 2s ago    │││
│  │  └──────────────┘  └──────────────┘  │           │││
│  │                                       └───────────┘││
│  └────────────────────────────────────────────────────┘│
│                            ▼                            │
│  ┌────────────────────────────────────────────────────┐│
│  │  Kafka: raw_events Topic                           ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐││
│  │  │ Total Msg    │  │ Lag          │  │ Partitions│││
│  │  │   1,234      │  │   0          │  │ 3         │││
│  │  └──────────────┘  └──────────────┘  └───────────┘││
│  └────────────────────────────────────────────────────┘│
│                            ▼                            │
│  ┌────────────────────────────────────────────────────┐│
│  │  Service B: Event Processing                       ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐││
│  │  │ Processed    │  │ Success      │  │ Rejected  │││
│  │  │   1,230      │  │   1,225      │  │ 5         │││
│  │  └──────────────┘  └──────────────┘  └───────────┘││
│  │                                                     ││
│  │  ┌────────────────────────────────────────────────┐││
│  │  │ Processing Status (Pie Chart)                  │││
│  │  │                                                 │││
│  │  │     ██████ SUCCESS (99.6%)                     │││
│  │  │     ██ REJECTED (0.4%)                         │││
│  │  └────────────────────────────────────────────────┘││
│  └────────────────────────────────────────────────────┘│
│                            ▼                            │
│  ┌────────────────────────────────────────────────────┐│
│  │  Outbox: Pending Messages                          ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐││
│  │  │ Pending      │  │ Published    │  │ Failed    │││
│  │  │   12         │  │   1,218      │  │ 0         │││
│  │  └──────────────┘  └──────────────┘  └───────────┘││
│  └────────────────────────────────────────────────────┘│
│                            ▼                            │
│  ┌────────────────────────────────────────────────────┐│
│  │  Kafka: domain_events Topic                        ││
│  │  ┌──────────────┐  ┌──────────────┐               ││
│  │  │ Total Msg    │  │ Lag          │               ││
│  │  │   1,230      │  │   0          │               ││
│  │  └──────────────┘  └──────────────┘               ││
│  └────────────────────────────────────────────────────┘│
│                            ▼                            │
│  ┌────────────────────────────────────────────────────┐│
│  │  Service C: Projection Updates                     ││
│  │  ┌──────────────┐  ┌──────────────┐               ││
│  │  │ Projections  │  │ Updates/sec  │               ││
│  │  │   1,230      │  │   243        │               ││
│  │  └──────────────┘  └──────────────┘               ││
│  └────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────┘
```

### 주요 쿼리

#### Service A 이벤트 수집
```sql
-- 총 이벤트 수
SELECT COUNT(*) FROM events 
WHERE ingested_at > NOW() - INTERVAL '5 minutes';

-- 초당 이벤트
SELECT COUNT(*) / 300.0 as events_per_sec FROM events 
WHERE ingested_at > NOW() - INTERVAL '5 minutes';

-- 마지막 이벤트
SELECT EXTRACT(EPOCH FROM (NOW() - MAX(ingested_at))) as seconds_ago
FROM events;
```

#### Service B 처리 현황
```sql
-- 처리 상태별 개수
SELECT 
    processing_status,
    COUNT(*) as count,
    COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as percentage
FROM processed_events
WHERE processed_at > NOW() - INTERVAL '5 minutes'
GROUP BY processing_status;
```

#### Outbox 상태
```sql
-- Pending
SELECT COUNT(*) FROM outbox WHERE published = false;

-- Published
SELECT COUNT(*) FROM outbox 
WHERE published = true 
  AND published_at > NOW() - INTERVAL '5 minutes';

-- Failed
SELECT COUNT(*) FROM outbox 
WHERE published = false 
  AND retry_count >= max_retries;
```

---

## 3️⃣ Performance Dashboard (성능)

### 목적
**"얼마나 빠른가? 병목은 어디인가?"**

### 레이아웃
```
┌────────────────────────────────────────────────────────┐
│  Performance Dashboard                   [Last 1 hour] │
├────────────────────────────────────────────────────────┤
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │  End-to-End Latency (시계열)                       ││
│  │  500ms┤                                            ││
│  │  400ms┤           ╭──╮                             ││
│  │  300ms┤       ╭───╯  ╰───╮                         ││
│  │  200ms┤   ╭───╯          ╰───╮                     ││
│  │  100ms┤───╯                  ╰───                  ││
│  │     0ms┴────────────────────────────────────────   ││
│  │         10:00  10:15  10:30  10:45  11:00          ││
│  │                                                     ││
│  │  P50: 234ms  P90: 456ms  P99: 789ms               ││
│  └────────────────────────────────────────────────────┘│
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ Throughput  │  │ Service A   │  │ Service B   │   │
│  │             │  │ Latency     │  │ Latency     │   │
│  │ 245 evt/s   │  │ 12 ms       │  │ 145 ms      │   │
│  │ ⬆ +15%     │  │ ✅ Good     │  │ ⚠️ High     │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │  Processing Time Breakdown (Stacked Bar)           ││
│  │                                                     ││
│  │  Service A ████ 12ms (5%)                          ││
│  │  Service B ████████████████████ 145ms (62%)        ││
│  │  Service C ████████ 77ms (33%)                     ││
│  │                                                     ││
│  │  Total: 234ms                                      ││
│  └────────────────────────────────────────────────────┘│
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │  Outbox Publish Delay (히스토그램)                  ││
│  │  1000┤                                             ││
│  │   800┤    █                                        ││
│  │   600┤    █                                        ││
│  │   400┤    █  █                                     ││
│  │   200┤    █  █  █                                  ││
│  │     0┴────┴──┴──┴────────────────────────────     ││
│  │       <1s  1s  2s  3s  >3s                         ││
│  └────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────┘
```

### 주요 쿼리

#### End-to-End Latency
```sql
SELECT 
    DATE_TRUNC('minute', c.updated_at) as time,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY 
        EXTRACT(EPOCH FROM (c.updated_at - e.occurred_at))
    ) as p50_latency,
    PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY 
        EXTRACT(EPOCH FROM (c.updated_at - e.occurred_at))
    ) as p90_latency,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY 
        EXTRACT(EPOCH FROM (c.updated_at - e.occurred_at))
    ) as p99_latency
FROM order_projections c
JOIN events e ON c.order_id = e.aggregate_id
WHERE c.updated_at > NOW() - INTERVAL '1 hour'
GROUP BY time
ORDER BY time;
```

#### Throughput
```sql
SELECT 
    COUNT(*) / EXTRACT(EPOCH FROM (MAX(ingested_at) - MIN(ingested_at))) 
    as events_per_second
FROM events
WHERE ingested_at > NOW() - INTERVAL '5 minutes';
```

#### Service별 Latency
```sql
-- Service A (저장 시간)
SELECT AVG(EXTRACT(EPOCH FROM (ingested_at - occurred_at))) as latency_ms
FROM events
WHERE ingested_at > NOW() - INTERVAL '1 hour';

-- Service B (처리 시간)
SELECT 
    AVG(EXTRACT(EPOCH FROM (pe.processed_at - e.ingested_at))) as latency_ms
FROM processed_events pe
JOIN events e ON pe.event_id = e.event_id
WHERE pe.processed_at > NOW() - INTERVAL '1 hour';

-- Service C (프로젝션 업데이트 시간)
SELECT 
    AVG(EXTRACT(EPOCH FROM (c.updated_at - e.ingested_at))) as latency_ms
FROM order_projections c
JOIN events e ON c.order_id = e.aggregate_id
WHERE c.updated_at > NOW() - INTERVAL '1 hour';
```

#### Outbox Publish Delay
```sql
SELECT 
    CASE 
        WHEN EXTRACT(EPOCH FROM (published_at - created_at)) < 1 THEN '<1s'
        WHEN EXTRACT(EPOCH FROM (published_at - created_at)) < 2 THEN '1s'
        WHEN EXTRACT(EPOCH FROM (published_at - created_at)) < 3 THEN '2s'
        ELSE '>3s'
    END as delay_bucket,
    COUNT(*) as count
FROM outbox
WHERE published = true
  AND published_at > NOW() - INTERVAL '1 hour'
GROUP BY delay_bucket
ORDER BY delay_bucket;
```

---

## 4️⃣ Error & Retry Dashboard (에러/재시도)

### 목적
**"무엇이 실패했나? 왜 실패했나? 재시도는?"**

### 레이아웃
```
┌────────────────────────────────────────────────────────┐
│  Error & Retry Dashboard                 [Last 1 hour] │
├────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Total Errors │  │ Rejection    │  │ Outbox       │ │
│  │              │  │ Rate         │  │ Failures     │ │
│  │   15         │  │   0.4%       │  │   2          │ │
│  │   ⚠️ Low    │  │   ✅ Good    │  │   ✅ Low     │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │  Rejected Events by Reason (Table)                 ││
│  │  ┌──────────────────┬────────┬───────────────────┐ ││
│  │  │ Reason           │ Count  │ Last Occurrence   │ ││
│  │  ├──────────────────┼────────┼───────────────────┤ ││
│  │  │ 재고 부족        │   8    │ 2 min ago         │ ││
│  │  │ 상태 전이 불가   │   5    │ 5 min ago         │ ││
│  │  │ 시간 역행        │   2    │ 15 min ago        │ ││
│  │  └──────────────────┴────────┴───────────────────┘ ││
│  └────────────────────────────────────────────────────┘│
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │  Outbox Retry Status (Gauge)                       ││
│  │                                                     ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ ││
│  │  │ Retry 0     │  │ Retry 1-2   │  │ Retry 3+  │ ││
│  │  │   12        │  │   3         │  │   2       │ ││
│  │  │   (70%)     │  │   (18%)     │  │   (12%)   │ ││
│  │  └─────────────┘  └─────────────┘  └────────────┘ ││
│  └────────────────────────────────────────────────────┘│
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │  Error Timeline (시계열)                            ││
│  │  20 ┤                                              ││
│  │  15 ┤                    ╭─╮                       ││
│  │  10 ┤                ╭───╯ ╰─╮                     ││
│  │   5 ┤            ╭───╯       ╰─╮                   ││
│  │   0 ┴────────────┴────────────────────────────     ││
│  │     10:00   10:15   10:30   10:45   11:00         ││
│  │                                                     ││
│  │  ──── Rejected Events                              ││
│  │  ──── Outbox Failures                              ││
│  └────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────┘
```

### 주요 쿼리

#### Rejected Events
```sql
-- 총 거부된 이벤트
SELECT COUNT(*) FROM processed_events 
WHERE processing_status = 'REJECTED'
  AND processed_at > NOW() - INTERVAL '1 hour';

-- 거부 사유별
SELECT 
    rejection_reason,
    COUNT(*) as count,
    MAX(processed_at) as last_occurrence
FROM processed_events
WHERE processing_status = 'REJECTED'
  AND processed_at > NOW() - INTERVAL '1 hour'
GROUP BY rejection_reason
ORDER BY count DESC;
```

#### Outbox Retry Status
```sql
SELECT 
    CASE 
        WHEN retry_count = 0 THEN 'Retry 0'
        WHEN retry_count BETWEEN 1 AND 2 THEN 'Retry 1-2'
        ELSE 'Retry 3+'
    END as retry_bucket,
    COUNT(*) as count
FROM outbox
WHERE published = false
GROUP BY retry_bucket;
```

#### Error Timeline
```sql
SELECT 
    DATE_TRUNC('minute', processed_at) as time,
    COUNT(CASE WHEN processing_status = 'REJECTED' THEN 1 END) as rejected_count,
    0 as outbox_failures  -- Outbox는 별도 쿼리
FROM processed_events
WHERE processed_at > NOW() - INTERVAL '1 hour'
GROUP BY time

UNION ALL

SELECT 
    DATE_TRUNC('minute', last_retry_at) as time,
    0 as rejected_count,
    COUNT(*) as outbox_failures
FROM outbox
WHERE retry_count >= max_retries
  AND last_retry_at > NOW() - INTERVAL '1 hour'
GROUP BY time
ORDER BY time;
```

---

## 5️⃣ Business Dashboard (비즈니스 지표)

### 목적
**"배송 시간 67% 단축 달성했나? 비즈니스 성과는?"**

### 레이아웃
```
┌────────────────────────────────────────────────────────┐
│  Business Dashboard                      [Last 7 days] │
├────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Avg Delivery │  │ Improvement  │  │ Total Orders │ │
│  │ Time         │  │              │  │              │ │
│  │   7.5 days   │  │   67.2% ✅   │  │   99,441     │ │
│  │   ⬇ -67.2%  │  │   Target 67% │  │   ⬆ +2.3%   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │  Delivery Time Trend (시계열)                      ││
│  │  25 days┤                                          ││
│  │  20 days┤  ●─────────                              ││
│  │  15 days┤         ●────────                        ││
│  │  10 days┤                ●──────                   ││
│  │   5 days┤                       ●──────●──────●   ││
│  │   0 days┴────────────────────────────────────────  ││
│  │          Week1  Week2  Week3  Week4  (Current)     ││
│  │                                                     ││
│  │  ──── Before Optimization (22.8 days)              ││
│  │  ──── After Optimization (7.5 days)                ││
│  └────────────────────────────────────────────────────┘│
│                                                         │
│  ┌────────────────────────────────────────────────────┐│
│  │  Delivery Performance by State (Map)               ││
│  │                                                     ││
│  │      ┌─────────────┐                               ││
│  │      │ SP: 6.2d ✅ │                               ││
│  │      │ RJ: 7.8d ✅ │                               ││
│  │      │ MG: 8.5d ⚠️ │                               ││
│  │      │ RS: 9.2d ⚠️ │                               ││
│  │      │ BA: 12.3d ❌│                               ││
│  │      └─────────────┘                               ││
│  └────────────────────────────────────────────────────┘│
│                                                         │
│  ┌──────────────────────┐  ┌──────────────────────┐   │
│  │ Order Status         │  │ Top Categories       │   │
│  │ (Pie Chart)          │  │ (Bar Chart)          │   │
│  │                      │  │                      │   │
│  │ ██ Delivered (65%)   │  │ Electronics ████████ │   │
│  │ ██ Shipped (20%)     │  │ Furniture   ██████   │   │
│  │ ██ Approved (10%)    │  │ Home        ████     │   │
│  │ ██ Pending (5%)      │  │ Sports      ███      │   │
│  └──────────────────────┘  └──────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

### 주요 쿼리

#### 평균 배송 시간
```sql
SELECT 
    AVG(EXTRACT(DAY FROM (
        order_delivered_customer_date - order_purchase_timestamp
    ))) as avg_delivery_days
FROM order_projections
WHERE order_delivered_customer_date IS NOT NULL
  AND order_purchase_timestamp > NOW() - INTERVAL '7 days';
```

#### 개선율 계산
```sql
WITH baseline AS (
    SELECT 22.8 as before_optimization_days  -- 기준값
),
current AS (
    SELECT 
        AVG(EXTRACT(DAY FROM (
            order_delivered_customer_date - order_purchase_timestamp
        ))) as current_days
    FROM order_projections
    WHERE order_delivered_customer_date IS NOT NULL
      AND order_purchase_timestamp > NOW() - INTERVAL '7 days'
)
SELECT 
    ((b.before_optimization_days - c.current_days) / b.before_optimization_days) * 100 
    as improvement_percentage
FROM baseline b, current c;
```

#### 지역별 배송 성능
```sql
SELECT 
    customer_state,
    AVG(EXTRACT(DAY FROM (
        order_delivered_customer_date - order_purchase_timestamp
    ))) as avg_delivery_days,
    COUNT(*) as order_count
FROM order_projections
WHERE order_delivered_customer_date IS NOT NULL
  AND order_purchase_timestamp > NOW() - INTERVAL '7 days'
GROUP BY customer_state
ORDER BY avg_delivery_days ASC;
```

#### 주문 상태별 분포
```sql
SELECT 
    order_status,
    COUNT(*) as count,
    COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as percentage
FROM order_projections
WHERE order_purchase_timestamp > NOW() - INTERVAL '7 days'
GROUP BY order_status;
```

---

## 🔧 기술 스택

### Grafana
```yaml
version: '3.8'
services:
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-storage:/var/lib/grafana
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./grafana/datasources:/etc/grafana/provisioning/datasources
```

### Prometheus (선택사항)
```yaml
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-storage:/prometheus
```

### 데이터 소스
1. **PostgreSQL** (Service A, B, C 데이터베이스)
2. **Kafka JMX** (Kafka 메트릭)
3. **Prometheus** (애플리케이션 메트릭)

---

## 📱 알림 설정 (Alerting)

### Alert 1: 높은 거부율
```yaml
name: High Rejection Rate
condition: rejection_rate > 5%
for: 5m
actions:
  - send: slack
    channel: "#service-b-alerts"
    message: "⚠️ Rejection rate is {{ $value }}% (threshold: 5%)"
```

### Alert 2: Outbox 적체
```yaml
name: Outbox Backlog
condition: pending_outbox_count > 1000
for: 5m
actions:
  - send: slack
    channel: "#service-b-alerts"
    message: "🚨 Outbox backlog: {{ $value }} messages pending"
```

### Alert 3: 서비스 다운
```yaml
name: Service Down
condition: service_last_heartbeat > 60s
for: 1m
actions:
  - send: pagerduty
    severity: critical
    message: "🔴 {{ $labels.service }} is down"
```

### Alert 4: 높은 지연 시간
```yaml
name: High Latency
condition: p99_latency > 5000ms
for: 10m
actions:
  - send: slack
    channel: "#performance"
    message: "⏱️ P99 latency is {{ $value }}ms (threshold: 5000ms)"
```

---

## 📋 구현 우선순위

### Phase 1: 필수 (Week 1)
```
✅ Overview Dashboard
✅ Event Flow Dashboard
✅ 기본 알림 (서비스 다운, 높은 에러율)
```

### Phase 2: 성능 (Week 2)
```
✅ Performance Dashboard
✅ Error & Retry Dashboard
✅ 세부 알림 (지연 시간, Outbox 적체)
```

### Phase 3: 비즈니스 (Week 3)
```
✅ Business Dashboard
✅ 배송 시간 추적
✅ 주간 리포트 자동화
```

---

## ✅ 요약

### 5개 대시보드
1. **Overview** - 시스템 전체 상태 한눈에
2. **Event Flow** - 각 단계별 이벤트 흐름
3. **Performance** - 성능 지표 및 병목 분석
4. **Error & Retry** - 실패/재시도 모니터링
5. **Business** - 비즈니스 성과 측정

### 핵심 지표
- **이벤트 처리량**: 초당 245개
- **End-to-End 지연**: P99 < 1초
- **성공률**: > 99%
- **배송 시간 단축**: 67% 달성

### 알림 체계
- Slack (일반 알림)
- PagerDuty (긴급 알림)
- Email (일일 리포트)

---

**이제 전체 시스템의 건강 상태를 실시간으로 모니터링하고, 비즈니스 목표 달성 여부를 확인할 수 있습니다!** 📊🎯
