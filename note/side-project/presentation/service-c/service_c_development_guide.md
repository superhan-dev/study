# Service C (Query & Analytics Service) 개발 가이드

이 문서는 **Service C (Insight Projection Service)**의 역할, 책임, 그리고 상세 구현 명세를 정의합니다. 개발팀은 이 문서를 기준으로 구현을 진행합니다.

---

## 1. 도메인 로직 및 아키텍처 (Domain Logic & Architecture) 

Service C는 **Domain Event를 소비하여 조회용 데이터(Projection)를 생성하고, 실시간 통계 및 분석 데이터를 제공하는 읽기 전용 서비스**입니다. CQRS 패턴의 Query Side를 담당하며, 복잡한 조인 없이 빠른 조회를 위해 비정규화된 데이터 모델을 유지합니다.

### 1.1 핵심 역할 및 책임

- **이벤트 소비 (Consumer)**: Kafka `domain_events` 토픽 (Service B가 발행) 구독
- **Projection 업데이트 (Materialization)**: 이벤트를 기반으로 비정규화된 조회용 테이블(`order_projections`) 갱신
- **실시간 통계 (Analytics)**: 주문 완료 시 셀러 성과(`seller_performance`) 및 경로 통계(`route_statistics`) 재계산
- **조회 API 제공 (Query API)**: 클라이언트 및 대시보드용 고성능 조회 API 제공

### 1.2 처리 프로세스 (Process Flow)

1.  **Ingestion**: Kafka `domain_events` 토픽에서 메시지 수신
2.  **Routing**: 이벤트 타입(`OrderPlaced`, `OrderShipped` 등)에 따라 처리 로직 분기
3.  **Projection Update**: `order_projections` 테이블에 데이터 반영 (Insert/Update)
4.  **Analytics Trigger**: `OrderDelivered` 이벤트 발생 시 통계 재계산 로직 실행
    - 셀러 등급(Tier) 산정
    - 경로 위험도(Risk) 평가
    - 실시간 메트릭(Grafana용) 기록
5.  **Data Serving**: REST API를 통해 클라이언트에 데이터 제공

---

## 2. Server API (Query Service) 상세 명세

Service C는 데이터 변경 기능은 제공하지 않으며, 오직 조회 및 분석 결과 제공에 집중합니다.

### 2.1 개요

- **Base URL**: `/api/v1`
- **역할**:
  - 주문 상세 및 목록 조회
  - 셀러 랭킹 및 성과 분석
  - 경로 통계 및 리스크 분석
  - 리플레이 시뮬레이션 비교 결과 조회

### 2.2 API 목록 및 상세

| 기능 영역 | Method | Endpoint | 역할 및 설명 | Request Body/Param | Response (핵심) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **주문 조회** | **GET** | `/orders/{orderId}` | **주문 상세 조회**<br>주문의 전체 이력과 상태를 단건 조회합니다. | (Path Param) | `orderId`, `status`, `timeline` |
| | **GET** | `/orders` | **주문 목록 조회**<br>필터 조건에 맞는 주문 목록을 페이징하여 반환합니다. | `status`, `replayJobId`, `page` | `orders` (List), `totalCount` |
| **셀러 분석** | **GET** | `/sellers/ranking` | **셀러 랭킹 조회**<br>성과 지표 기반의 상위 셀러 목록을 조회합니다. | `tier`, `limit` | `sellers` (List), `tierScore` |
| | **GET** | `/sellers/{sellerId}/performance` | **셀러 상세 성과**<br>특정 셀러의 배송 시간, 지연율 등 상세 지표를 조회합니다. | (Path Param) | `avgPrepHours`, `onTimeRate`, `reviewDistribution` |
| **경로 분석** | **GET** | `/routes/statistics` | **경로 통계 조회**<br>위험 수준별 경로 통계를 조회합니다. | `riskLevel` | `routes` (List), `avgShippingDays` |
| **시뮬레이션** | **POST** | `/simulations/compare` | **리플레이 비교**<br>두 리플레이 결과(As-Is vs To-Be)를 비교 분석합니다. | `replayIdA`, `replayIdB` | `improvement` (Pct), `totalTimeSaved` |

### 2.3 상태 코드 정의

- `200 OK`: 요청 성공
- `404 Not Found`: 존재하지 않는 리소스
- `500 Internal Server Error`: 서버 내부 오류

### 2.4 CRUD 매트릭스 (주요 테이블 대상)

| API / Process | order_projections | seller_performance | route_statistics | simulation_comparisons | real_time_metrics |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Event Consumer** | **C/U** | **U** | **U** | - | **C** |
| **Get Order** | **R** | - | - | - | - |
| **Get Seller** | - | **R** | - | - | - |
| **Get Route** | - | - | **R** | - | - |
| **Compare Sim** | **R** | - | - | **C/R** | - |

---

## 3. Kafka 토픽 상세 스펙 (Kafka Topic Specifications)

### 3.1 Input Topic: `domain_events`
*   **Source**: Service B (Outbox Publisher)
*   **Purpose**: Service C의 Projection 및 분석 로직 트리거
*   **파티션 수**: 3 (Service B와 동일)
*   **Key**: `aggregate_id` (예: `order_id`) -> **중요: 순서 보장**
*   **Value Schema (JSON)**: 
    ```json
    {
      "eventId": "uuid-…",
      "eventType": "OrderApproved",
      "aggregateId": "order_123",
      "occurredAt": "2026-01-24T10:00:00Z",
      "payload": {
        "status": "APPROVED",
        "approvedAt": "..."
      }
    }
    ```

### 3.2 Output Topic: `delivery.risk` (Analysis Generated)
*   **Source**: Service C (Risk Module)
*   **Purpose**: 분석 결과 지연이 확정적이거나 위험도가 높은 주문에 대해 알림 발송 및 재배정 트리거
*   **Key**: `order_id`
*   **Value Schema (JSON)**:
    ```json
    {
      "riskId": "uuid-…",
      "orderId": "order_123",
      "riskLevel": "HIGH",
      "reason": "Predicted delay > 48h",
      "detectedAt": "2026-01-24T12:00:00Z"
    }
    ```

### 3.3 Output Topic: `stats.feedback` (Analysis Generated)
*   **Source**: Service C (Feedback Module)
*   **Purpose**: 구간별 지연 가중치 보정값 전파 (Feedback Loop)
*   **Key**: `route_id` (예: "SP-RJ")
*   **Value Schema (JSON)**:
    ```json
    {
      "routeId": "SP-RJ",
      "delayFactor": 1.2, // 평소보다 1.2배 소요됨
      "validUntil": "2026-01-25T12:00:00Z"
    }
    ```

---

## 4. 테이블 리스트 (Table Specification)

Service C의 데이터베이스 스키마에 포함된 주요 테이블 목록입니다. 읽기 성능을 위해 비정규화된 구조를 가집니다.

### 4.1 `order_projections` (주문 조회 모델)
- **설명**: 주문, 고객, 셀러, 상품 정보를 모두 포함하는 비정규화된 테이블입니다.
- **역할**: 조인 없는 고속 조회 지원, 복잡한 통계 쿼리의 기반 데이터
- **주요 컬럼**: `order_id`, `order_status`, `customer_state`, `seller_state`, `prep_hours`, `shipping_hours`, `is_delayed`

### 4.2 `seller_performance` (셀러 성과 지표)
- **설명**: 셀러별 누적 배송 성과와 등급을 저장하는 테이블입니다.
- **역할**: 셀러 랭킹 산정, 우수 셀러 식별, 라우팅 가중치 제공
- **주요 컬럼**: `seller_id`, `avg_prep_hours`, `on_time_rate`, `seller_tier`, `tier_score`

### 4.3 `route_statistics` (경로 통계)
- **설명**: 출발지(Seller State)와 도착지(Customer State) 쌍에 대한 배송 통계를 저장합니다.
- **역할**: 구간별 예상 소요 시간(ETA) 산출 기초 데이터, 병목 구간 식별
- **주요 컬럼**: `route_id` ("SP-RJ"), `avg_shipping_days`, `delay_rate`, `risk_level`

### 4.4 `simulation_comparisons` (시뮬레이션 비교)
- **설명**: 두 개의 리플레이(Scenario A vs B) 결과를 비교 분석한 데이터를 저장합니다.
- **역할**: 프로세스 개선(예: WMS 도입) 효과의 정량적 증명
- **주요 컬럼**: `comparison_id`, `time_improvement_pct`, `delay_reduction_pct`, `total_time_saved_hours`

### 4.5 `real_time_metrics` (시계열 메트릭)
- **설명**: Grafana 대시보드 시각화를 위한 시계열 데이터를 저장합니다.
- **역할**: 실시간 모니터링, 시간대별 트렌드 분석
- **주요 컬럼**: `metric_name`, `metric_value`, `dimensions` (JSONB), `measured_at`

---

## 5. 분석 알고리즘 및 수식 (Analytics Logic)

Service C에서 수행하는 핵심 분석 로직과 수식에 대한 명세입니다.

### 5.1 셀러 등급 산정 (Seller Tier Scoring)

셀러의 성과를 종합 점수(0~100점)로 환산하여 등급을 매깁니다.

$$ 
Score_{total} = Score_{speed} + Score_{reliability} + Score_{satisfaction} 
$$ 

1.  **속도 점수 ($Score_{speed}$, 40점 만점)**: 평균 배송 준비 시간($H_{prep}$) 기준
    $$ 
    Score_{speed} = \max(0, 40 - (\frac{H_{prep}}{24}) \times 10) 
    $$ 
    *   24시간 이내 출고 시 만점, 늦어질수록 차감.

2.  **신뢰도 점수 ($Score_{reliability}$, 35점 만점)**: 정시 배송률($R_{on\_time}$) 기준
    $$ 
    Score_{reliability} = R_{on\_time} \times 0.35 
    $$ 
    *   정시 배송률(%) * 0.35 가중치.

3.  **만족도 점수 ($Score_{satisfaction}$, 25점 만점)**: 평균 리뷰 점수($S_{review}$, 5점 만점) 기준
    $$ 
    Score_{satisfaction} = S_{review} \times 5 
    $$ 

**등급 기준**:
- **PLATINUM**: 80점 이상
- **GOLD**: 70점 이상
- **SILVER**: 60점 이상
- **BRONZE**: 60점 미만

### 5.2 경로 위험도 평가 (Route Risk Assessment)

특정 배송 경로의 위험 수준을 수치화합니다.

$$ 
RiskScore = (R_{delay} \times 0.5) + (D_{avg\_delay} \times 5) + (V_{time} \times 2) 
$$ 

- $R_{delay}$: 지연율 (%)
- $D_{avg\_delay}$: 평균 지연 일수
- $V_{time}$: 배송 시간 변동성 (최대값 - 최소값)

**위험 등급**:
- **HIGH_RISK**: 60점 이상
- **MEDIUM_RISK**: 30점 이상
- **NORMAL**: 30점 미만

### 5.3 시뮬레이션 개선율 (Improvement Calculation)

두 시나리오(A: As-Is, B: To-Be) 간의 성능 개선을 측정합니다.

$$ 
Improvement_{time}(\%) = \frac{Time_A - Time_B}{Time_A} \times 100 
$$ 

- $Time_A$: 시나리오 A의 평균 배송 시간
- $Time_B$: 시나리오 B의 평균 배송 시간 (개선 후)

---

## 6. 데이터 흐름 및 활용 (Data Flow Summary)

Service C를 중심으로 한 데이터의 입력과 출력 흐름 요약입니다.

### 6.1 입력 (Input)
- **Source**: Kafka `domain_events` Topic
- **Origin**: Service B (Command Service)
- **Content**: 검증된 도메인 이벤트 (예: `OrderShipped`, `OrderDelivered`)
- **Mechanism**: Kafka Consumer Group (`service-c-consumer`)

### 6.2 내부 처리 (Internal Processing)
- **Materialization**: 이벤트를 수신하여 `order_projections` 테이블을 최신 상태로 갱신 (Insert/Update).
- **Calculation**: 배송 완료 등 특정 이벤트 시점에 통계(셀러, 경로) 재계산 수행.
- **Aggregation**: 리플레이 단위별로 데이터를 격리하여 통계 집계.

### 6.3 출력 (Output)
- **API Response**: 클라이언트(Admin UI) 요청에 대한 JSON 응답.
- **Dashboard**: Grafana가 `real_time_metrics` 및 통계 테이블을 쿼리하여 시각화.
- **Kafka Feedback**: 분석된 위험 정보와 피드백 데이터를 `delivery.risk`, `stats.feedback` 토픽으로 발행.

---

## 7. 기술 의사결정 및 설계 의도 (Technical Decisions)

### 7.1 왜 CQRS를 사용하는가?
*   **이유**: **조회 성능 최적화와 복잡한 쿼리 처리**. Service B(Command)는 트랜잭션 처리에 최적화된 정규화된 모델을 사용하지만, 복잡한 통계나 조인 쿼리에는 부적합합니다.
*   **결정**: 별도의 Query Service를 두어 조회 패턴에 맞게 미리 계산되고 비정규화된 테이블(`order_projections`)을 유지함으로써 실시간 대시보드와 리포트의 응답 속도를 극대화합니다.

### 7.2 왜 비정규화(Denormalization)된 테이블을 사용하는가?
*   **이유**: **조인 비용 제거**. 주문, 고객, 셀러 정보를 조회할 때마다 여러 테이블을 조인하는 것은 대량 데이터 조회 시 심각한 성능 저하를 유발합니다.
*   **결정**: `order_projections`에 필요한 모든 정보를 플랫하게 저장하여, 단순 `SELECT` 쿼리만으로 데이터를 조회할 수 있게 합니다.

### 7.3 왜 Kafka Topic을 통한 Feedback Loop를 구성하는가?
*   **이유**: **시스템의 자가 보정(Self-Correction)**. Service C에서 분석된 실제 지연 데이터(Fact)를 Service B의 의사결정 로직에 반영해야 합니다.
*   **결정**: API 호출 대신 `stats.feedback` 토픽을 발행하여, Service B(또는 다른 의사결정 서비스)가 이를 비동기적으로 구독하고 가중치를 업데이트하도록 하여 결합도를 낮춥니다.