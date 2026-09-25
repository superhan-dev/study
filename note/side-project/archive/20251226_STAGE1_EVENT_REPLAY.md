# Stage 1 — Event Replay & Kafka Pipeline

## 목적

CSV 스냅샷 데이터를 이벤트 스트림으로 복원(replay)하여,
Kafka 기반 데이터 파이프라인의 핵심 개념을 실습하고 체득한다.

본 단계의 목표는 **기능 구현이 아니라 사고방식과 구조 이해**이다.

---

## Stage 1 핵심 목표 (한 줄)

> 과거 데이터(CSV)를 이벤트로 복원해 Kafka 기반 파이프라인을 구축하고,
> replay·중복·순서·모니터링을 직접 경험한다.

---

## 1. 환경 준비 (Infrastructure)

### TODO

- [ ] Docker / Docker Compose 설치
- [ ] Kafka(KRaft) 실행
- [ ] Kafka UI (Redpanda Console) 실행
- [ ] Kafka 토픽 생성 테스트

### 체크리스트

- [ ] Kafka는 Queue가 아니라 **Log**임을 설명할 수 있다
- [ ] Partition의 역할을 설명할 수 있다
- [ ] Consumer Group의 의미를 설명할 수 있다

---

## 2. CSV 데이터 이해 (Olist Orders)

### TODO

- [ ] `olist_orders_dataset.csv` 컬럼 분석
- [ ] 주문 1건의 생애주기 타임라인 정리
  - purchase_timestamp
  - approved_at
  - carrier_delivered_at
  - delivered_customer_date
  - estimated_delivery_date
- [ ] 컬럼 → 이벤트 매핑 문서 작성

### 체크리스트

- [ ] State와 Event의 차이를 설명할 수 있다
- [ ] 주문 1건이 여러 이벤트로 나뉘는 이유를 설명할 수 있다

---

## 3. 이벤트 모델 설계 (가장 중요)

### TODO

- [ ] 이벤트 타입 정의
  - ORDER_PLACED
  - ORDER_APPROVED
  - HANDED_TO_CARRIER
  - DELIVERED
  - LATE_DETECTED
- [ ] 공통 이벤트 스키마 정의
  - eventId
  - eventType
  - eventAt
  - orderId
  - payload (region, seller, customer 등)

### 체크리스트

- [ ] 이벤트는 불변(immutable)이라는 개념을 설명할 수 있다
- [ ] 상태 전체를 보내지 않고 이벤트만 보내는 이유를 설명할 수 있다
- [ ] eventId가 왜 필요한지 설명할 수 있다

---

## 4. Kafka 토픽 설계

### TODO

- [ ] 토픽 생성: `order-events`
- [ ] Partition 수 결정 (예: 3~6)
- [ ] Message Key를 `orderId`로 설정

### 체크리스트

- [ ] key=orderId를 사용하는 이유를 설명할 수 있다
- [ ] 같은 주문의 이벤트 순서를 어떻게 보장하는지 설명할 수 있다
- [ ] Partition 수 증가의 장단점을 설명할 수 있다

---

## 5. Ingest Service 구현 (CSV → Kafka)

### TODO

- [ ] Spring Boot Ingest 프로젝트 생성
- [ ] CSV 스트리밍 파서 구현
- [ ] 주문 1건 → 여러 이벤트 생성 로직 구현
- [ ] Kafka Producer 연동
- [ ] 이벤트 발행 로그 확인

### 체크리스트

- [ ] CSV를 저장 대상이 아닌 이벤트 생성 재료로 보고 있다
- [ ] 한 주문이 여러 메시지로 분리되는 이유를 설명할 수 있다

---

## 6. Replay 전략 구현

### TODO

- [ ] Replay 모드 결정
  - Fast Replay (기본)
  - Scaled Time Replay (옵션)
- [ ] eventAt은 원본 timestamp 유지
- [ ] 발행 속도 제어 (가속 처리)
- [ ] Replay 시작/종료 로그 남기기

### 체크리스트

- [ ] 실시간 재생이 필요 없는 이유를 설명할 수 있다
- [ ] Replay와 실시간 스트리밍의 차이를 설명할 수 있다
- [ ] Replay가 실무에서 중요한 이유를 설명할 수 있다

---

## 7. Idempotency & 중복 처리

### TODO

- [ ] eventId 생성 규칙 정의
  - 예: hash(orderId + eventType + eventAt)
- [ ] 중복 이벤트 발생 시나리오 정리
- [ ] (옵션) 중복 체크 저장소 설계(Postgres/Redis)

### 체크리스트

- [ ] Kafka가 Exactly-once를 기본 제공하지 않는 이유를 설명할 수 있다
- [ ] 중복 이벤트가 발생하는 원인을 설명할 수 있다
- [ ] 중복 처리를 하지 않으면 생기는 문제를 설명할 수 있다

---

## 8. Consumer 최소 구현 (검증용)

### TODO

- [ ] Kafka Consumer 구현
- [ ] 이벤트 로그 출력
- [ ] eventType별 카운트 집계

### 체크리스트

- [ ] Producer와 Consumer가 느슨하게 결합되어 있음을 설명할 수 있다
- [ ] Consumer Group 확장 시 동작을 설명할 수 있다

---

## 9. 파이프라인 모니터링

### TODO

- [ ] Kafka UI에서 메시지 유입 확인
- [ ] Partition별 메시지 분포 확인
- [ ] Consumer Lag 확인
- [ ] Replay 중 Lag 변화 관찰

### 체크리스트

- [ ] Lag의 의미를 설명할 수 있다
- [ ] Lag이 증가할 때 시스템 상태를 설명할 수 있다

---

## 10. 실패 & 재처리 시나리오

### TODO

- [ ] Consumer 강제 종료
- [ ] 재기동 후 메시지 재처리 확인
- [ ] Replay 재실행
- [ ] 결과 동일성 확인

### 체크리스트

- [ ] 시스템이 어떻게 복구되는지 설명할 수 있다
- [ ] Replay 가능한 구조의 장점을 설명할 수 있다

---

## Stage 1 종료 조건

아래 질문에 모두 답할 수 있으면 Stage 1 완료:

- 왜 CSV를 DB/ES에 바로 넣지 않았는가?
- Kafka를 Queue가 아닌 Log로 쓰는 이유는?
- Event-first 설계의 장점은?
- Replay/Backfill은 실무에서 언제 쓰이는가?
- 중복/순서/재처리를 어떻게 다뤘는가?

---

## Stage 1 성취 문장

> 과거 데이터(CSV)를 이벤트로 복원해 Kafka 기반 파이프라인을 구축하고,
> replay·중복·순서·모니터링을 직접 경험했다.
