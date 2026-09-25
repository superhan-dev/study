# Service C - Insight Projection Service (Query Service) 상세 기획서

## 조회 최적화 및 분석 서비스

---

## 📋 문서 개요

### Service C의 역할

**"Domain Event를 받아서 조회용 데이터(Projection)를 생성하고, 실시간 통계/분석 데이터를 제공하는 읽기 전용 서비스"**

```
Input:  Kafka domain_events (Service B의 검증된 이벤트)
Process: Projection 업데이트 + 통계 계산
Output: REST API (조회), Grafana 대시보드 데이터
```

---

## 🎯 핵심 책임

1. **이벤트 소비** - Kafka `domain_events` 토픽 구독
2. **Projection 업데이트** - 비정규화된 조회용 테이블 생성/갱신
3. **통계 계산** - 실시간 집계 및 메트릭 생성
4. **API 제공** - 조회 전용 REST API
5. **대시보드 연동** - Grafana/BI 도구용 데이터 제공

---

## 🗄️ Database C 테이블 상세 설명

### 1. `order_projections` 테이블

#### 역할

**조회 성능을 위해 주문 데이터를 비정규화하여 저장**

#### 왜 필요한가?

**❌ Projection 없으면**:

```sql
-- 주문 조회할 때마다 5개 테이블 JOIN
SELECT
  o.order_id,
  c.customer_state,
  s.seller_state,
  p.product_category,
  r.review_score,
  -- 계산 필드
  EXTRACT(EPOCH FROM (o.carrier_date - o.approved_at))/3600 AS prep_hours
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
JOIN sellers s ON oi.seller_id = s.seller_id
JOIN products p ON oi.product_id = p.product_id
JOIN reviews r ON o.order_id = r.order_id;

-- 문제: 느림, 복잡, 부하 증가
```

**✅ Projection 있으면**:

```sql
-- 한 테이블에서 바로 조회
SELECT * FROM order_projections
WHERE order_id = 'abc123';

-- 장점: 빠름, 단순, 인덱스 최적화
```

#### 테이블 구조

```sql
CREATE TABLE order_projections (
    order_id VARCHAR(32) PRIMARY KEY,

    -- 기본 정보 (비정규화)
    customer_id VARCHAR(32),
    customer_state CHAR(2),
    customer_city VARCHAR(50),
    customer_zip INT,

    -- 셀러 정보 (비정규화)
    seller_id VARCHAR(32),
    seller_state CHAR(2),
    seller_city VARCHAR(50),
    seller_zip INT,

    -- 상품 정보 (비정규화)
    product_id VARCHAR(32),
    product_category VARCHAR(50),
    product_weight_g INT,

    -- 주문 상태
    order_status VARCHAR(20),

    -- 타임라인 (모두 저장)
    purchased_at TIMESTAMP,
    approved_at TIMESTAMP,
    carrier_date TIMESTAMP,
    customer_date TIMESTAMP,
    estimated_date TIMESTAMP,

    -- 계산 필드 (미리 계산해서 저장)
    prep_hours DECIMAL(10, 2),              -- carrier_date - approved_at
    shipping_hours DECIMAL(10, 2),          -- customer_date - carrier_date
    total_hours DECIMAL(10, 2),             -- customer_date - purchased_at
    is_delayed BOOLEAN,                     -- customer_date > estimated_date
    delay_hours DECIMAL(10, 2),             -- 지연 시간

    -- 금액
    price DECIMAL(10, 2),
    freight DECIMAL(10, 2),
    total_amount DECIMAL(10, 2),

    -- 리뷰
    review_score INT,
    review_comment TEXT,

    -- 리플레이 정보
    replay_job_id VARCHAR(50),
    is_simulated BOOLEAN DEFAULT FALSE,

    -- 메타데이터
    projection_version INT DEFAULT 1,       -- Projection 스키마 버전
    projection_updated_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스 (조회 패턴에 맞춰 설계)
CREATE INDEX idx_order_proj_status ON order_projections(order_status);
CREATE INDEX idx_order_proj_seller ON order_projections(seller_id);
CREATE INDEX idx_order_proj_customer_state ON order_projections(customer_state);
CREATE INDEX idx_order_proj_seller_state ON order_projections(seller_state);
CREATE INDEX idx_order_proj_purchased ON order_projections(purchased_at);
CREATE INDEX idx_order_proj_replay ON order_projections(replay_job_id);
CREATE INDEX idx_order_proj_delayed ON order_projections(is_delayed) WHERE is_delayed = true;
CREATE INDEX idx_order_proj_category ON order_projections(product_category);
```

#### 업데이트 로직

```java
@Service
public class OrderProjectionService {

    @KafkaListener(topics = "domain_events")
    public void handleDomainEvent(DomainEvent event) {
        switch (event.getEventType()) {
            case "OrderPlaced":
                createProjection(event);
                break;
            case "OrderApproved":
                updateProjectionApproved(event);
                break;
            case "OrderShipped":
                updateProjectionShipped(event);
                break;
            case "OrderDelivered":
                updateProjectionDelivered(event);
                break;
            case "OrderReviewed":
                updateProjectionReviewed(event);
                break;
        }
    }

    private void createProjection(DomainEvent event) {
        OrderProjection projection = OrderProjection.builder()
            .orderId(event.getOrderId())
            .customerId(event.getCustomerId())
            .sellerId(event.getSellerId())
            .productId(event.getProductId())
            .orderStatus("PLACED")
            .purchasedAt(event.getPurchasedAt())
            .replayJobId(event.getReplayJobId())
            .build();

        // 고객/셀러/상품 정보 조회해서 채우기
        enrichWithCustomerInfo(projection, event.getCustomerId());
        enrichWithSellerInfo(projection, event.getSellerId());
        enrichWithProductInfo(projection, event.getProductId());

        orderProjectionRepository.save(projection);
    }

    private void updateProjectionShipped(DomainEvent event) {
        OrderProjection projection = orderProjectionRepository
            .findById(event.getOrderId())
            .orElseThrow();

        projection.setOrderStatus("SHIPPED");
        projection.setCarrierDate(event.getShippedAt());

        // 계산 필드 업데이트
        if (projection.getApprovedAt() != null) {
            long prepHours = ChronoUnit.HOURS.between(
                projection.getApprovedAt(),
                event.getShippedAt()
            );
            projection.setPrepHours(BigDecimal.valueOf(prepHours));
        }

        orderProjectionRepository.save(projection);
    }

    private void updateProjectionDelivered(DomainEvent event) {
        OrderProjection projection = orderProjectionRepository
            .findById(event.getOrderId())
            .orElseThrow();

        projection.setOrderStatus("DELIVERED");
        projection.setCustomerDate(event.getDeliveredAt());

        // 배송 시간 계산
        if (projection.getCarrierDate() != null) {
            long shippingHours = ChronoUnit.HOURS.between(
                projection.getCarrierDate(),
                event.getDeliveredAt()
            );
            projection.setShippingHours(BigDecimal.valueOf(shippingHours));
        }

        // 전체 시간 계산
        long totalHours = ChronoUnit.HOURS.between(
            projection.getPurchasedAt(),
            event.getDeliveredAt()
        );
        projection.setTotalHours(BigDecimal.valueOf(totalHours));

        // 지연 여부 확인
        if (event.getDeliveredAt().isAfter(projection.getEstimatedDate())) {
            projection.setIsDelayed(true);
            long delayHours = ChronoUnit.HOURS.between(
                projection.getEstimatedDate(),
                event.getDeliveredAt()
            );
            projection.setDelayHours(BigDecimal.valueOf(delayHours));
        }

        orderProjectionRepository.save(projection);

        // 통계 업데이트 트리거
        updateSellerPerformance(projection.getSellerId());
        updateRouteStatistics(projection.getSellerState(), projection.getCustomerState());
    }
}
```

#### 예시 데이터

```json
{
  "orderId": "abc123",
  "customerId": "customer_456",
  "customerState": "SP",
  "customerCity": "São Paulo",
  "customerZip": 1000,
  "sellerId": "seller_789",
  "sellerState": "RJ",
  "sellerCity": "Rio de Janeiro",
  "sellerZip": 20000,
  "productId": "product_001",
  "productCategory": "electronics",
  "orderStatus": "DELIVERED",
  "purchasedAt": "2017-05-13T14:23:11Z",
  "approvedAt": "2017-05-13T15:10:22Z",
  "carrierDate": "2017-05-15T09:30:45Z",
  "customerDate": "2017-05-18T16:45:30Z",
  "estimatedDate": "2017-05-20T23:59:59Z",
  "prepHours": 42.33,
  "shippingHours": 79.25,
  "totalHours": 122.37,
  "isDelayed": false,
  "delayHours": 0,
  "price": 149.9,
  "reviewScore": 5,
  "replayJobId": "replay_001"
}
```

---

### 2. `seller_performance` 테이블

#### 역할

**셀러별 성과 지표를 실시간으로 집계하여 저장**

#### 왜 필요한가?

- 셀러 랭킹 시스템
- 성과 대시보드
- 라우팅 추천 시 활용

#### 테이블 구조

```sql
CREATE TABLE seller_performance (
    seller_id VARCHAR(32) PRIMARY KEY,

    -- 셀러 기본 정보
    seller_state CHAR(2),
    seller_city VARCHAR(50),
    seller_zip INT,

    -- 주문 통계
    total_orders BIGINT DEFAULT 0,
    completed_orders BIGINT DEFAULT 0,
    cancelled_orders BIGINT DEFAULT 0,

    -- 출고 시간 통계
    avg_prep_hours DECIMAL(10, 2),
    min_prep_hours DECIMAL(10, 2),
    max_prep_hours DECIMAL(10, 2),
    p50_prep_hours DECIMAL(10, 2),          -- 중앙값
    p90_prep_hours DECIMAL(10, 2),          -- 90 백분위수
    p95_prep_hours DECIMAL(10, 2),
    stddev_prep_hours DECIMAL(10, 2),       -- 표준편차 (일관성 지표)

    -- 배송 성과
    on_time_deliveries BIGINT DEFAULT 0,
    delayed_deliveries BIGINT DEFAULT 0,
    on_time_rate DECIMAL(5, 2),             -- (on_time / total) * 100

    -- 고객 만족도
    total_reviews BIGINT DEFAULT 0,
    avg_review_score DECIMAL(3, 2),
    review_score_1 BIGINT DEFAULT 0,
    review_score_2 BIGINT DEFAULT 0,
    review_score_3 BIGINT DEFAULT 0,
    review_score_4 BIGINT DEFAULT 0,
    review_score_5 BIGINT DEFAULT 0,

    -- 셀러 등급 (계산된 값)
    seller_tier VARCHAR(20),                -- PLATINUM, GOLD, SILVER, BRONZE
    tier_score DECIMAL(5, 2),               -- 종합 점수 (0-100)
    tier_updated_at TIMESTAMP,

    -- 리플레이별 성과 (JSONB)
    replay_performance JSONB,

    -- 타임스탬프
    last_calculated_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_seller_perf_tier ON seller_performance(seller_tier);
CREATE INDEX idx_seller_perf_state ON seller_performance(seller_state);
CREATE INDEX idx_seller_perf_score ON seller_performance(tier_score DESC);
CREATE INDEX idx_seller_perf_on_time_rate ON seller_performance(on_time_rate DESC);
```

#### 업데이트 로직

```java
@Service
public class SellerPerformanceService {

    @Transactional
    public void updatePerformance(String sellerId) {
        // 1. 해당 셀러의 모든 완료된 주문 조회
        List<OrderProjection> orders = orderProjectionRepository
            .findBySellerIdAndOrderStatus(sellerId, "DELIVERED");

        if (orders.isEmpty()) {
            return;
        }

        // 2. 통계 계산
        SellerPerformance performance = sellerPerformanceRepository
            .findById(sellerId)
            .orElse(new SellerPerformance(sellerId));

        performance.setTotalOrders(orders.size());
        performance.setCompletedOrders(orders.size());

        // 출고 시간 통계
        List<BigDecimal> prepHours = orders.stream()
            .map(OrderProjection::getPrepHours)
            .filter(Objects::nonNull)
            .sorted()
            .collect(Collectors.toList());

        if (!prepHours.isEmpty()) {
            performance.setAvgPrepHours(calculateAverage(prepHours));
            performance.setMinPrepHours(prepHours.get(0));
            performance.setMaxPrepHours(prepHours.get(prepHours.size() - 1));
            performance.setP50PrepHours(calculatePercentile(prepHours, 0.5));
            performance.setP90PrepHours(calculatePercentile(prepHours, 0.9));
            performance.setP95PrepHours(calculatePercentile(prepHours, 0.95));
            performance.setStddevPrepHours(calculateStdDev(prepHours));
        }

        // 배송 성과
        long onTimeCount = orders.stream()
            .filter(o -> !o.getIsDelayed())
            .count();
        performance.setOnTimeDeliveries(onTimeCount);
        performance.setDelayedDeliveries(orders.size() - onTimeCount);
        performance.setOnTimeRate(
            BigDecimal.valueOf(onTimeCount * 100.0 / orders.size())
        );

        // 리뷰 통계
        long reviewCount = orders.stream()
            .filter(o -> o.getReviewScore() != null)
            .count();
        performance.setTotalReviews(reviewCount);

        if (reviewCount > 0) {
            double avgScore = orders.stream()
                .filter(o -> o.getReviewScore() != null)
                .mapToInt(OrderProjection::getReviewScore)
                .average()
                .orElse(0.0);
            performance.setAvgReviewScore(BigDecimal.valueOf(avgScore));

            // 점수별 분포
            Map<Integer, Long> scoreDistribution = orders.stream()
                .filter(o -> o.getReviewScore() != null)
                .collect(Collectors.groupingBy(
                    OrderProjection::getReviewScore,
                    Collectors.counting()
                ));

            performance.setReviewScore1(scoreDistribution.getOrDefault(1, 0L));
            performance.setReviewScore2(scoreDistribution.getOrDefault(2, 0L));
            performance.setReviewScore3(scoreDistribution.getOrDefault(3, 0L));
            performance.setReviewScore4(scoreDistribution.getOrDefault(4, 0L));
            performance.setReviewScore5(scoreDistribution.getOrDefault(5, 0L));
        }

        // 3. 셀러 등급 계산
        calculateTier(performance);

        performance.setLastCalculatedAt(LocalDateTime.now());
        sellerPerformanceRepository.save(performance);
    }

    private void calculateTier(SellerPerformance performance) {
        // 속도 점수 (0-40점)
        BigDecimal speedScore = BigDecimal.valueOf(
            Math.max(0, 40 - (performance.getAvgPrepHours().doubleValue() / 24) * 10)
        );

        // 신뢰도 점수 (0-35점)
        BigDecimal reliabilityScore = performance.getOnTimeRate()
            .multiply(BigDecimal.valueOf(0.35));

        // 만족도 점수 (0-25점)
        BigDecimal satisfactionScore = performance.getAvgReviewScore()
            .multiply(BigDecimal.valueOf(5));

        // 종합 점수
        BigDecimal tierScore = speedScore
            .add(reliabilityScore)
            .add(satisfactionScore);

        performance.setTierScore(tierScore);

        // 등급 결정
        if (tierScore.compareTo(BigDecimal.valueOf(80)) >= 0) {
            performance.setSellerTier("PLATINUM");
        } else if (tierScore.compareTo(BigDecimal.valueOf(70)) >= 0) {
            performance.setSellerTier("GOLD");
        } else if (tierScore.compareTo(BigDecimal.valueOf(60)) >= 0) {
            performance.setSellerTier("SILVER");
        } else {
            performance.setSellerTier("BRONZE");
        }

        performance.setTierUpdatedAt(LocalDateTime.now());
    }
}
```

#### 예시 데이터

```sql
SELECT * FROM seller_performance WHERE seller_tier = 'PLATINUM';

-- seller_id | total_orders | avg_prep_hours | on_time_rate | avg_review_score | seller_tier | tier_score
-- seller_001 | 1,234       | 36.5           | 95.2         | 4.8              | PLATINUM    | 87.3
-- seller_002 | 2,456       | 42.1           | 92.8         | 4.7              | PLATINUM    | 83.5
```

---

### 3. `route_statistics` 테이블

#### 역할

**출발지-목적지 경로별 배송 성과를 집계**

#### 왜 필요한가?

- 경로별 배송 시간 예측
- 위험 경로 식별
- 라우팅 최적화

#### 테이블 구조

```sql
CREATE TABLE route_statistics (
    route_id VARCHAR(100) PRIMARY KEY,      -- "SP-RJ", "PR-AL" 등

    -- 경로 정보
    seller_state CHAR(2),
    customer_state CHAR(2),

    -- 배송 통계
    total_deliveries BIGINT DEFAULT 0,

    -- 배송 시간 통계
    avg_shipping_days DECIMAL(10, 2),
    min_shipping_days DECIMAL(10, 2),
    max_shipping_days DECIMAL(10, 2),
    p50_shipping_days DECIMAL(10, 2),
    p90_shipping_days DECIMAL(10, 2),

    -- 지연 통계
    delayed_deliveries BIGINT DEFAULT 0,
    delay_rate DECIMAL(5, 2),               -- (delayed / total) * 100
    avg_delay_days DECIMAL(10, 2),

    -- 위험 수준 (계산된 값)
    risk_level VARCHAR(20),                 -- HIGH_RISK, MEDIUM_RISK, NORMAL
    risk_score DECIMAL(5, 2),

    -- 리플레이별 통계 (JSONB)
    replay_stats JSONB,

    -- 타임스탬프
    last_calculated_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_route_seller_state ON route_statistics(seller_state);
CREATE INDEX idx_route_customer_state ON route_statistics(customer_state);
CREATE INDEX idx_route_risk ON route_statistics(risk_level);
CREATE INDEX idx_route_delay_rate ON route_statistics(delay_rate DESC);
```

#### 업데이트 로직

```java
@Service
public class RouteStatisticsService {

    @Transactional
    public void updateRouteStats(String sellerState, String customerState) {
        String routeId = sellerState + "-" + customerState;

        // 해당 경로의 모든 배송 완료 주문 조회
        List<OrderProjection> deliveries = orderProjectionRepository
            .findBySellerStateAndCustomerStateAndOrderStatus(
                sellerState, customerState, "DELIVERED"
            );

        if (deliveries.isEmpty()) {
            return;
        }

        RouteStatistics stats = routeStatisticsRepository
            .findById(routeId)
            .orElse(new RouteStatistics(routeId, sellerState, customerState));

        stats.setTotalDeliveries(deliveries.size());

        // 배송 시간 통계 (일 단위)
        List<BigDecimal> shippingDays = deliveries.stream()
            .map(o -> o.getShippingHours().divide(BigDecimal.valueOf(24), 2, RoundingMode.HALF_UP))
            .sorted()
            .collect(Collectors.toList());

        stats.setAvgShippingDays(calculateAverage(shippingDays));
        stats.setMinShippingDays(shippingDays.get(0));
        stats.setMaxShippingDays(shippingDays.get(shippingDays.size() - 1));
        stats.setP50ShippingDays(calculatePercentile(shippingDays, 0.5));
        stats.setP90ShippingDays(calculatePercentile(shippingDays, 0.9));

        // 지연 통계
        long delayedCount = deliveries.stream()
            .filter(OrderProjection::getIsDelayed)
            .count();

        stats.setDelayedDeliveries(delayedCount);
        stats.setDelayRate(BigDecimal.valueOf(delayedCount * 100.0 / deliveries.size()));

        if (delayedCount > 0) {
            double avgDelay = deliveries.stream()
                .filter(OrderProjection::getIsDelayed)
                .mapToDouble(o -> o.getDelayHours().doubleValue() / 24)
                .average()
                .orElse(0.0);
            stats.setAvgDelayDays(BigDecimal.valueOf(avgDelay));
        }

        // 위험 수준 계산
        calculateRiskLevel(stats);

        stats.setLastCalculatedAt(LocalDateTime.now());
        routeStatisticsRepository.save(stats);
    }

    private void calculateRiskLevel(RouteStatistics stats) {
        BigDecimal riskScore = BigDecimal.ZERO;

        // 지연율 기여 (0-50점)
        riskScore = riskScore.add(stats.getDelayRate().multiply(BigDecimal.valueOf(0.5)));

        // 평균 지연 일수 기여 (0-30점)
        if (stats.getAvgDelayDays() != null) {
            riskScore = riskScore.add(
                stats.getAvgDelayDays().multiply(BigDecimal.valueOf(5))
            );
        }

        // 배송 시간 변동성 기여 (0-20점)
        BigDecimal timeVariance = stats.getMaxShippingDays()
            .subtract(stats.getMinShippingDays());
        riskScore = riskScore.add(timeVariance.multiply(BigDecimal.valueOf(2)));

        stats.setRiskScore(riskScore);

        // 위험 등급 결정
        if (riskScore.compareTo(BigDecimal.valueOf(60)) >= 0) {
            stats.setRiskLevel("HIGH_RISK");
        } else if (riskScore.compareTo(BigDecimal.valueOf(30)) >= 0) {
            stats.setRiskLevel("MEDIUM_RISK");
        } else {
            stats.setRiskLevel("NORMAL");
        }
    }
}
```

#### 예시 데이터

```sql
SELECT * FROM route_statistics ORDER BY delay_rate DESC LIMIT 5;

-- route_id | total_deliveries | avg_shipping_days | delay_rate | risk_level
-- PR-AL    | 234              | 8.5               | 42.3       | HIGH_RISK
-- SP-AM    | 567              | 7.2               | 38.1       | HIGH_RISK
-- RJ-PA    | 123              | 6.8               | 28.5       | MEDIUM_RISK
-- SP-RJ    | 9,876            | 2.1               | 5.2        | NORMAL
```

---

### 4. `simulation_comparisons` 테이블

#### 역할

**서로 다른 리플레이(시나리오)의 결과를 비교**

#### 왜 필요한가?

- "재고 관리 시스템이 있었다면 얼마나 개선되었을까?" 증명
- A/B 테스트 결과 분석

#### 테이블 구조

```sql
CREATE TABLE simulation_comparisons (
    comparison_id UUID PRIMARY KEY,

    -- 비교 대상
    replay_job_id_a VARCHAR(50),            -- 실제 데이터 (As-Is)
    replay_job_id_b VARCHAR(50),            -- 최적화 시나리오 (To-Be)
    comparison_name VARCHAR(100),

    -- 집계 기본 정보
    total_orders_compared BIGINT,
    comparison_period_start TIMESTAMP,
    comparison_period_end TIMESTAMP,

    -- 시나리오 A (실제) 통계
    avg_delivery_time_a DECIMAL(10, 2),
    median_delivery_time_a DECIMAL(10, 2),
    total_delay_count_a BIGINT,
    delay_rate_a DECIMAL(5, 2),
    avg_review_score_a DECIMAL(3, 2),

    -- 시나리오 B (최적화) 통계
    avg_delivery_time_b DECIMAL(10, 2),
    median_delivery_time_b DECIMAL(10, 2),
    total_delay_count_b BIGINT,
    delay_rate_b DECIMAL(5, 2),
    avg_review_score_b DECIMAL(3, 2),

    -- 개선율 (계산된 값)
    time_improvement_pct DECIMAL(5, 2),     -- (A - B) / A * 100
    delay_reduction_pct DECIMAL(5, 2),
    review_improvement_pct DECIMAL(5, 2),

    -- 비즈니스 임팩트
    total_time_saved_hours BIGINT,
    estimated_cost_savings DECIMAL(15, 2),
    customer_satisfaction_improvement DECIMAL(5, 2),

    -- 상세 분석 (JSONB)
    comparison_details JSONB,

    -- 메타데이터
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_comparison_replay_a ON simulation_comparisons(replay_job_id_a);
CREATE INDEX idx_comparison_replay_b ON simulation_comparisons(replay_job_id_b);
CREATE INDEX idx_comparison_improvement ON simulation_comparisons(time_improvement_pct DESC);
```

#### 생성 로직

```java
@Service
public class SimulationComparisonService {

    @Transactional
    public SimulationComparison compareReplays(
        String replayIdA,
        String replayIdB,
        String comparisonName
    ) {
        // 1. 각 리플레이의 주문 데이터 조회
        List<OrderProjection> ordersA = orderProjectionRepository
            .findByReplayJobId(replayIdA);
        List<OrderProjection> ordersB = orderProjectionRepository
            .findByReplayJobId(replayIdB);

        SimulationComparison comparison = new SimulationComparison();
        comparison.setComparisonId(UUID.randomUUID());
        comparison.setReplayJobIdA(replayIdA);
        comparison.setReplayJobIdB(replayIdB);
        comparison.setComparisonName(comparisonName);
        comparison.setTotalOrdersCompared(ordersA.size());

        // 2. 시나리오 A 통계
        comparison.setAvgDeliveryTimeA(
            calculateAverageHours(ordersA, OrderProjection::getTotalHours)
        );
        comparison.setTotalDelayCountA(
            ordersA.stream().filter(OrderProjection::getIsDelayed).count()
        );
        comparison.setDelayRateA(
            BigDecimal.valueOf(comparison.getTotalDelayCountA() * 100.0 / ordersA.size())
        );

        // 3. 시나리오 B 통계
        comparison.setAvgDeliveryTimeB(
            calculateAverageHours(ordersB, OrderProjection::getTotalHours)
        );
        comparison.setTotalDelayCountB(
            ordersB.stream().filter(OrderProjection::getIsDelayed).count()
        );
        comparison.setDelayRateB(
            BigDecimal.valueOf(comparison.getTotalDelayCountB() * 100.0 / ordersB.size())
        );

        // 4. 개선율 계산
        BigDecimal timeA = comparison.getAvgDeliveryTimeA();
        BigDecimal timeB = comparison.getAvgDeliveryTimeB();
        comparison.setTimeImprovementPct(
            timeA.subtract(timeB)
                .divide(timeA, 2, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(100))
        );

        comparison.setDelayReductionPct(
            comparison.getDelayRateA()
                .subtract(comparison.getDelayRateB())
                .divide(comparison.getDelayRateA(), 2, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(100))
        );

        // 5. 총 절감 시간
        BigDecimal totalSaved = timeA.subtract(timeB)
            .multiply(BigDecimal.valueOf(ordersA.size()));
        comparison.setTotalTimeSavedHours(totalSaved.longValue());

        // 6. 상세 분석 (지역별, 카테고리별 등)
        Map<String, Object> details = new HashMap<>();
        details.put("byRegion", compareByRegion(ordersA, ordersB));
        details.put("byCategory", compareByCategory(ordersA, ordersB));
        details.put("bySellerTier", compareBySellerTier(ordersA, ordersB));
        comparison.setComparisonDetails(objectMapper.valueToTree(details));

        return simulationComparisonRepository.save(comparison);
    }

    private Map<String, Map<String, Object>> compareByRegion(
        List<OrderProjection> ordersA,
        List<OrderProjection> ordersB
    ) {
        Map<String, Map<String, Object>> result = new HashMap<>();

        // 시나리오 A의 지역별 그룹
        Map<String, List<OrderProjection>> regionGroupsA = ordersA.stream()
            .collect(Collectors.groupingBy(OrderProjection::getCustomerState));

        // 시나리오 B의 지역별 그룹
        Map<String, List<OrderProjection>> regionGroupsB = ordersB.stream()
            .collect(Collectors.groupingBy(OrderProjection::getCustomerState));

        // 각 지역별 비교
        for (String region : regionGroupsA.keySet()) {
            Map<String, Object> regionComparison = new HashMap<>();

            double avgTimeA = calculateAverageHours(
                regionGroupsA.get(region),
                OrderProjection::getTotalHours
            ).doubleValue();

            double avgTimeB = calculateAverageHours(
                regionGroupsB.getOrDefault(region, Collections.emptyList()),
                OrderProjection::getTotalHours
            ).doubleValue();

            regionComparison.put("avgTimeA", avgTimeA);
            regionComparison.put("avgTimeB", avgTimeB);
            regionComparison.put("improvement", (avgTimeA - avgTimeB) / avgTimeA * 100);

            result.put(region, regionComparison);
        }

        return result;
    }
}
```

#### 예시 데이터

```sql
SELECT * FROM simulation_comparisons;

-- comparison_id | replay_job_id_a  | replay_job_id_b    | total_orders | time_improvement_pct
-- uuid-001      | replay_actual    | replay_optimized   | 100,000      | 66.9
```

**comparison_details (JSONB)**:

```json
{
  "byRegion": {
    "SP": {
      "avgTimeA": 230.5,
      "avgTimeB": 76.2,
      "improvement": 66.9
    },
    "RJ": {
      "avgTimeA": 198.3,
      "avgTimeB": 68.1,
      "improvement": 65.7
    }
  },
  "byCategory": {
    "electronics": {
      "avgTimeA": 215.7,
      "avgTimeB": 70.3,
      "improvement": 67.4
    }
  }
}
```

---

### 5. `real_time_metrics` 테이블

#### 역할

**Grafana 대시보드용 시계열 메트릭 저장**

#### 왜 필요한가?

- 실시간 모니터링
- 시간대별 트렌드 분석
- 알림 트리거

#### 테이블 구조

```sql
CREATE TABLE real_time_metrics (
    metric_id UUID PRIMARY KEY,

    -- 메트릭 정보
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(20, 4),
    metric_unit VARCHAR(20),                -- hours, count, percentage 등

    -- 차원 (JSONB - 유연한 필터링)
    dimensions JSONB,

    -- 타임스탬프
    measured_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스 (시계열 조회 최적화)
CREATE INDEX idx_metrics_name_time ON real_time_metrics(metric_name, measured_at DESC);
CREATE INDEX idx_metrics_measured_at ON real_time_metrics(measured_at DESC);
CREATE INDEX idx_metrics_dimensions ON real_time_metrics USING GIN(dimensions);

-- 파티셔닝 (선택적, 데이터 증가 시)
-- CREATE TABLE real_time_metrics_2026_01 PARTITION OF real_time_metrics
-- FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

#### 저장 로직

```java
@Service
public class RealTimeMetricsService {

    @Async
    public void recordMetric(
        String metricName,
        BigDecimal value,
        String unit,
        Map<String, String> dimensions
    ) {
        RealTimeMetric metric = RealTimeMetric.builder()
            .metricId(UUID.randomUUID())
            .metricName(metricName)
            .metricValue(value)
            .metricUnit(unit)
            .dimensions(objectMapper.valueToTree(dimensions))
            .measuredAt(LocalDateTime.now())
            .build();

        realTimeMetricsRepository.save(metric);
    }

    // OrderDelivered 이벤트 발생 시
    @EventListener
    public void onOrderDelivered(OrderDeliveredEvent event) {
        OrderProjection order = orderProjectionRepository
            .findById(event.getOrderId())
            .orElseThrow();

        // 1. 배송 완료 카운트
        recordMetric(
            "orders_delivered_count",
            BigDecimal.ONE,
            "count",
            Map.of(
                "replay_id", order.getReplayJobId(),
                "seller_tier", getSellerfTier(order.getSellerId()),
                "region", order.getCustomerState()
            )
        );

        // 2. 평균 배송 시간
        recordMetric(
            "avg_delivery_time",
            order.getTotalHours(),
            "hours",
            Map.of(
                "replay_id", order.getReplayJobId(),
                "route", order.getSellerState() + "-" + order.getCustomerState()
            )
        );

        // 3. 지연 여부
        if (order.getIsDelayed()) {
            recordMetric(
                "delayed_orders_count",
                BigDecimal.ONE,
                "count",
                Map.of(
                    "replay_id", order.getReplayJobId(),
                    "delay_hours", order.getDelayHours().toString()
                )
            );
        }
    }
}
```

#### Grafana 쿼리 예시

```sql
-- 시간대별 평균 배송 시간
SELECT
    DATE_TRUNC('hour', measured_at) AS time,
    dimensions->>'replay_id' AS replay_id,
    AVG(metric_value) AS avg_value
FROM real_time_metrics
WHERE metric_name = 'avg_delivery_time'
  AND measured_at >= NOW() - INTERVAL '24 hours'
GROUP BY time, replay_id
ORDER BY time;

-- 리플레이별 지연 주문 수
SELECT
    dimensions->>'replay_id' AS replay_id,
    SUM(metric_value) AS total_delayed
FROM real_time_metrics
WHERE metric_name = 'delayed_orders_count'
  AND measured_at >= NOW() - INTERVAL '7 days'
GROUP BY replay_id;
```

---

## 🔄 Service C의 전체 처리 흐름

```
┌─────────────────────────────────────────────────────────────┐
│  1. Kafka Consumer: domain_events 토픽에서 이벤트 수신      │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  2. 이벤트 타입별 라우팅                                     │
│     - OrderPlaced → createProjection()                      │
│     - OrderApproved → updateProjectionApproved()            │
│     - OrderShipped → updateProjectionShipped()              │
│     - OrderDelivered → updateProjectionDelivered()          │
│     - OrderReviewed → updateProjectionReviewed()            │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Projection 업데이트                                      │
│                                                              │
│  order_projections 테이블:                                  │
│  - 새 행 삽입 또는 기존 행 업데이트                          │
│  - 계산 필드 갱신 (prep_hours, shipping_hours 등)           │
│  - 지연 여부 판단                                            │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  4. 통계 재계산 트리거                                       │
│     (OrderDelivered 이벤트인 경우)                           │
│                                                              │
│  ① seller_performance 업데이트                              │
│  ② route_statistics 업데이트                                │
│  ③ real_time_metrics 기록                                   │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  5. 데이터 준비 완료                                         │
│                                                              │
│  - REST API 조회 가능                                        │
│  - Grafana 대시보드 갱신                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 📡 Service C API 명세

### 1. 주문 조회 API

```http
GET /api/v1/orders/{orderId}

Response:
{
  "orderId": "abc123",
  "customerId": "customer_456",
  "customerState": "SP",
  "sellerId": "seller_789",
  "sellerState": "RJ",
  "productCategory": "electronics",
  "orderStatus": "DELIVERED",
  "purchasedAt": "2017-05-13T14:23:11Z",
  "deliveredAt": "2017-05-18T16:45:30Z",
  "prepHours": 42.33,
  "shippingHours": 79.25,
  "totalHours": 122.37,
  "isDelayed": false,
  "reviewScore": 5
}
```

---

### 2. 주문 목록 조회 API (필터링)

```http
GET /api/v1/orders?status=DELIVERED&replayJobId=replay_001&limit=100

Response:
{
  "orders": [...],
  "totalCount": 100000,
  "page": 1,
  "pageSize": 100
}
```

---

### 3. 셀러 랭킹 조회 API

```http
GET /api/v1/sellers/ranking?tier=PLATINUM&limit=10

Response:
{
  "sellers": [
    {
      "sellerId": "seller_001",
      "sellerState": "SP",
      "totalOrders": 1234,
      "avgPrepHours": 36.5,
      "onTimeRate": 95.2,
      "avgReviewScore": 4.8,
      "sellerTier": "PLATINUM",
      "tierScore": 87.3
    },
    ...
  ]
}
```

---

### 4. 셀러 상세 성과 조회 API

```http
GET /api/v1/sellers/{sellerId}/performance

Response:
{
  "sellerId": "seller_789",
  "totalOrders": 5678,
  "avgPrepHours": 48.2,
  "p50PrepHours": 42.0,
  "p90PrepHours": 72.5,
  "stddevPrepHours": 18.3,
  "onTimeRate": 88.5,
  "avgReviewScore": 4.3,
  "sellerTier": "GOLD",
  "tierScore": 75.8,
  "reviewDistribution": {
    "score1": 45,
    "score2": 123,
    "score3": 456,
    "score4": 1234,
    "score5": 3820
  }
}
```

---

### 5. 경로 통계 조회 API

```http
GET /api/v1/routes/statistics?riskLevel=HIGH_RISK

Response:
{
  "routes": [
    {
      "routeId": "PR-AL",
      "sellerState": "PR",
      "customerState": "AL",
      "totalDeliveries": 234,
      "avgShippingDays": 8.5,
      "delayRate": 42.3,
      "riskLevel": "HIGH_RISK",
      "riskScore": 68.5
    },
    ...
  ]
}
```

---

### 6. 리플레이 비교 API

```http
POST /api/v1/simulations/compare

Request:
{
  "replayIdA": "replay_actual",
  "replayIdB": "replay_optimized",
  "comparisonName": "Actual vs Optimized with Inventory"
}

Response:
{
  "comparisonId": "uuid-001",
  "totalOrdersCompared": 100000,
  "scenarioA": {
    "avgDeliveryTime": 230.5,
    "delayRate": 18.5
  },
  "scenarioB": {
    "avgDeliveryTime": 76.2,
    "delayRate": 5.3
  },
  "improvement": {
    "timeImprovementPct": 66.9,
    "delayReductionPct": 71.4,
    "totalTimeSavedHours": 15430000
  },
  "comparisonDetails": {
    "byRegion": {...},
    "byCategory": {...}
  }
}
```

---

### 7. 실시간 메트릭 조회 API

```http
GET /api/v1/metrics/timeseries?metricName=avg_delivery_time&from=2026-01-24T00:00:00Z&to=2026-01-24T23:59:59Z

Response:
{
  "metricName": "avg_delivery_time",
  "unit": "hours",
  "dataPoints": [
    {
      "timestamp": "2026-01-24T00:00:00Z",
      "value": 125.3,
      "dimensions": {
        "replay_id": "replay_001",
        "region": "SP"
      }
    },
    ...
  ]
}
```

---

### 8. 배송 분석 대시보드 데이터 API

```http
GET /api/v1/analytics/delivery-analysis?replayJobId=replay_001

Response:
{
  "overview": {
    "totalOrders": 100000,
    "avgDeliveryTime": 122.5,
    "delayRate": 12.3,
    "avgReviewScore": 4.2
  },
  "byStage": {
    "avgPrepTime": 48.5,
    "avgShippingTime": 74.0,
    "prepPercentage": 39.6,
    "shippingPercentage": 60.4
  },
  "topDelayedRoutes": [
    {"route": "PR-AL", "delayRate": 42.3},
    {"route": "SP-AM", "delayRate": 38.1}
  ],
  "topPerformingSellers": [
    {"sellerId": "seller_001", "tierScore": 87.3}
  ]
}
```

---

## 📊 Grafana 대시보드 구성

### Dashboard 1: 리플레이 실시간 모니터링

**Panel 1: 처리 중인 주문 수 (Stat)**

```sql
SELECT COUNT(*)
FROM order_projections
WHERE replay_job_id = 'replay_001'
  AND projection_updated_at >= NOW() - INTERVAL '5 minutes';
```

**Panel 2: 평균 배송 시간 추이 (Time Series)**

```sql
SELECT
    DATE_TRUNC('minute', measured_at) AS time,
    AVG(metric_value) AS avg_delivery_hours
FROM real_time_metrics
WHERE metric_name = 'avg_delivery_time'
  AND dimensions->>'replay_id' = 'replay_001'
  AND measured_at >= NOW() - INTERVAL '1 hour'
GROUP BY time
ORDER BY time;
```

**Panel 3: 배송 단계별 비중 (Pie Chart)**

```sql
SELECT
    'Prep Time' AS stage,
    AVG(prep_hours) AS value
FROM order_projections
WHERE replay_job_id = 'replay_001'
UNION ALL
SELECT
    'Shipping Time',
    AVG(shipping_hours)
FROM order_projections
WHERE replay_job_id = 'replay_001';
```

---

### Dashboard 2: 셀러 성과 분석

**Panel 1: 셀러 티어 분포 (Bar Chart)**

```sql
SELECT
    seller_tier,
    COUNT(*) AS seller_count
FROM seller_performance
GROUP BY seller_tier
ORDER BY
    CASE seller_tier
        WHEN 'PLATINUM' THEN 1
        WHEN 'GOLD' THEN 2
        WHEN 'SILVER' THEN 3
        WHEN 'BRONZE' THEN 4
    END;
```

**Panel 2: Top 10 셀러 (Table)**

```sql
SELECT
    seller_id,
    total_orders,
    avg_prep_hours,
    on_time_rate,
    avg_review_score,
    seller_tier,
    tier_score
FROM seller_performance
ORDER BY tier_score DESC
LIMIT 10;
```

---

### Dashboard 3: 리플레이 비교 대시보드

**Panel 1: 배송 시간 비교 (Bar Gauge)**

```sql
SELECT
    'Actual' AS scenario,
    avg_delivery_time_a AS avg_time
FROM simulation_comparisons
WHERE comparison_id = 'uuid-001'
UNION ALL
SELECT
    'Optimized',
    avg_delivery_time_b
FROM simulation_comparisons
WHERE comparison_id = 'uuid-001';
```

**Panel 2: 개선율 (Stat with Sparkline)**

```sql
SELECT
    time_improvement_pct,
    delay_reduction_pct,
    total_time_saved_hours
FROM simulation_comparisons
WHERE comparison_id = 'uuid-001';
```

**Panel 3: 지역별 개선율 (Geomap)**

```sql
SELECT
    details->>'SP' AS sp_improvement,
    details->>'RJ' AS rj_improvement,
    details->>'MG' AS mg_improvement
FROM simulation_comparisons,
     LATERAL jsonb_each(comparison_details->'byRegion') AS details
WHERE comparison_id = 'uuid-001';
```

---

## 🧪 테스트 전략

### 1. 단위 테스트

```java
@Test
void testProjectionUpdate() {
    // Given
    OrderProjection projection = OrderProjection.builder()
        .orderId("order_001")
        .purchasedAt(LocalDateTime.parse("2017-05-13T14:23:11"))
        .approvedAt(LocalDateTime.parse("2017-05-13T15:10:22"))
        .build();

    // When
    projection.setCarrierDate(LocalDateTime.parse("2017-05-15T09:30:45"));
    projection.calculatePrepHours();

    // Then
    assertThat(projection.getPrepHours()).isEqualByComparingTo("42.33");
}

@Test
void testSellerTierCalculation() {
    // Given
    SellerPerformance performance = SellerPerformance.builder()
        .avgPrepHours(BigDecimal.valueOf(36.5))
        .onTimeRate(BigDecimal.valueOf(95.2))
        .avgReviewScore(BigDecimal.valueOf(4.8))
        .build();

    // When
    sellerPerformanceService.calculateTier(performance);

    // Then
    assertThat(performance.getSellerTier()).isEqualTo("PLATINUM");
    assertThat(performance.getTierScore()).isGreaterThan(BigDecimal.valueOf(80));
}
```

---

### 2. 통합 테스트

```java
@SpringBootTest
@Testcontainers
class ProjectionIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:14");

    @Container
    static KafkaContainer kafka = new KafkaContainer(
        DockerImageName.parse("confluentinc/cp-kafka:7.4.0")
    );

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    @Autowired
    private OrderProjectionRepository orderProjectionRepository;

    @Test
    void testProjectionCreatedFromDomainEvent() throws Exception {
        // Given
        DomainEvent event = DomainEvent.builder()
            .eventType("OrderPlaced")
            .orderId("order_test_001")
            .customerId("customer_001")
            .sellerId("seller_001")
            .purchasedAt(LocalDateTime.now())
            .build();

        // When
        kafkaTemplate.send("domain_events", event.toJson());

        // Wait for processing
        Thread.sleep(2000);

        // Then
        Optional<OrderProjection> projection = orderProjectionRepository
            .findById("order_test_001");

        assertThat(projection).isPresent();
        assertThat(projection.get().getOrderStatus()).isEqualTo("PLACED");
    }
}
```

---

## 📈 모니터링 메트릭

### 수집할 메트릭

```java
// 1. Projection 업데이트 속도
@Timed(value = "service_c.projection.update.time")
public void updateProjection(DomainEvent event) { ... }

// 2. Kafka Consumer Lag
Gauge.builder("service_c.kafka.consumer.lag", () ->
    calculateConsumerLag()
).register(meterRegistry);

// 3. 통계 계산 시간
@Timed(value = "service_c.statistics.calculation.time")
public void updateStatistics(String sellerId) { ... }

// 4. API 응답 시간
@Timed(value = "service_c.api.response.time",
       extraTags = {"endpoint", "path"})
public ResponseEntity<?> getOrders(...) { ... }
```

---

## ✅ Definition of Done

### Service C 완료 조건

- [ ] **기능**:
  - [ ] Domain Event Consumer 정상 작동
  - [ ] Projection 업데이트 성공
  - [ ] 통계 재계산 정상 동작
  - [ ] REST API 정상 응답

- [ ] **성능**:
  - [ ] Kafka Consumer Lag < 10초
  - [ ] API 응답 시간 < 500ms (P95)
  - [ ] 통계 계산 시간 < 5초

- [ ] **데이터 품질**:
  - [ ] Projection 데이터 정합성 100%
  - [ ] 계산 필드 정확도 검증
  - [ ] 리플레이별 데이터 격리 확인

- [ ] **대시보드**:
  - [ ] Grafana 패널 10개 이상
  - [ ] 실시간 업데이트 확인
  - [ ] 비교 대시보드 구현

---

**이제 Service C를 구현할 준비가 되었습니다!** 📊
