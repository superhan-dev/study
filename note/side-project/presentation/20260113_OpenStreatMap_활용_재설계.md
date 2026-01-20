# [Project] OSM 기반 Smart Routing 시스템 상세 설계 및 검증

## 목차
1. [도로 품질 검증 SQL](#1-도로-품질-검증-sql)
2. [셀러 랭킹 시스템 상세 설계](#2-셀러-랭킹-시스템-상세-설계)
3. [경로-셀러 통합 스코어링](#3-경로-셀러-통합-스코어링)
4. [실시간 의사결정 로직](#4-실시간-의사결정-로직)
5. [운영 대시보드 KPI](#5-운영-대시보드-kpi)

---

## 1. 도로 품질 검증 SQL

### 1.1. Zip 간 도로 프로파일 생성 (Core ETL)

```sql
-- ================================================================
-- OSM 도로 데이터로부터 Zip-to-Zip 경로 특성 추출
-- ================================================================
WITH zip_centroids AS (
    -- 각 우편번호의 대표 좌표 (geolocation 테이블 활용)
    SELECT 
        geolocation_zip_code_prefix AS zip_code,
        AVG(geolocation_lat) AS lat,
        AVG(geolocation_lng) AS lng,
        ST_SetSRID(ST_MakePoint(AVG(geolocation_lng), AVG(geolocation_lat)), 4326) AS geom
    FROM olist_geolocation_dataset
    GROUP BY geolocation_zip_code_prefix
),
actual_routes AS (
    -- 과거 실제 배송이 발생한 경로만 추출 (샘플 크기 확보)
    SELECT DISTINCT
        s.seller_zip_code_prefix AS from_zip,
        c.customer_zip_code_prefix AS to_zip,
        COUNT(*) OVER (PARTITION BY s.seller_zip_code_prefix, c.customer_zip_code_prefix) AS route_volume
    FROM olist_orders_dataset o
    JOIN olist_order_items_dataset oi ON o.order_id = oi.order_id
    JOIN olist_sellers_dataset s ON oi.seller_id = s.seller_id
    JOIN olist_customers_dataset c ON o.customer_id = c.customer_id
    WHERE o.order_status = 'delivered'
),
road_intersections AS (
    -- OSM 도로 중 해당 경로와 교차하는 도로들을 추출
    SELECT 
        ar.from_zip,
        ar.to_zip,
        r.highway,
        r.surface,
        ST_Length(r.geometry::geography) / 1000 AS segment_km,
        CASE 
            WHEN r.highway IN ('motorway', 'motorway_link') THEN 1.0
            WHEN r.highway IN ('trunk', 'trunk_link') THEN 0.8
            WHEN r.highway IN ('primary', 'primary_link') THEN 0.6
            WHEN r.highway IN ('secondary') THEN 0.4
            WHEN r.highway IN ('tertiary', 'residential') THEN 0.3
            ELSE 0.1
        END AS road_quality_weight
    FROM actual_routes ar
    JOIN zip_centroids zf ON ar.from_zip = zf.zip_code
    JOIN zip_centroids zt ON ar.to_zip = zt.zip_code
    JOIN osm_brazil_roads r ON ST_DWithin(
        r.geometry::geography,
        ST_MakeLine(zf.geom, zt.geom)::geography,
        50000  -- 경로 버퍼 50km (실제 배송 경로의 근사값)
    )
)
INSERT INTO zip_road_profile (from_zip, to_zip, highway_ratio, unpaved_ratio, 
                               avg_road_quality, complexity_score, total_distance_km, route_volume)
SELECT 
    from_zip,
    to_zip,
    -- 고속도로 비율
    SUM(CASE WHEN highway IN ('motorway', 'trunk') THEN segment_km ELSE 0 END) / SUM(segment_km) AS highway_ratio,
    -- 비포장 비율
    SUM(CASE WHEN surface IN ('unpaved', 'gravel', 'dirt', 'ground') THEN segment_km ELSE 0 END) / NULLIF(SUM(segment_km), 0) AS unpaved_ratio,
    -- 가중 평균 도로 품질
    SUM(segment_km * road_quality_weight) / SUM(segment_km) AS avg_road_quality,
    -- 복잡도 점수 (도로 등급 변화 횟수를 근사)
    COUNT(DISTINCT highway) * 0.1 + 
    STDDEV(road_quality_weight) * 2 AS complexity_score,
    -- 총 거리
    SUM(segment_km) AS total_distance_km,
    -- 이 경로의 과거 주문량
    MAX(route_volume) AS route_volume
FROM road_intersections
GROUP BY from_zip, to_zip
HAVING SUM(segment_km) > 0;  -- 유효한 경로만 저장
```

**핵심 로직 설명:**
- `ST_DWithin(..., 50000)`: 직선 경로 50km 버퍼 내 도로들을 "실제 배송 경로"로 간주
- `complexity_score`: 도로 등급의 표준편차가 클수록 경로가 복잡함을 의미
- `route_volume`: 과거 배송 빈도가 높은 경로일수록 신뢰도 높은 데이터

---

### 1.2. 경로별 지연 위험도 분석

```sql
-- ================================================================
-- 도로 품질과 실제 지연율의 상관관계 검증
-- ================================================================
WITH route_performance AS (
    SELECT 
        s.seller_zip_code_prefix AS from_zip,
        c.customer_zip_code_prefix AS to_zip,
        COUNT(*) AS total_orders,
        -- 실제 배송 시간 (carrier → customer)
        AVG(EXTRACT(EPOCH FROM (o.order_delivered_customer_date - o.order_delivered_carrier_date)) / 86400) AS avg_shipping_days,
        -- 지연율
        COUNT(CASE WHEN o.order_delivered_customer_date > o.order_estimated_delivery_date THEN 1 END) * 100.0 / COUNT(*) AS delay_rate,
        -- 지연 주문의 평균 초과 일수
        AVG(CASE 
            WHEN o.order_delivered_customer_date > o.order_estimated_delivery_date 
            THEN EXTRACT(DAY FROM (o.order_delivered_customer_date - o.order_estimated_delivery_date))
            ELSE 0 
        END) AS avg_delay_days
    FROM olist_orders_dataset o
    JOIN olist_order_items_dataset oi ON o.order_id = oi.order_id
    JOIN olist_sellers_dataset s ON oi.seller_id = s.seller_id
    JOIN olist_customers_dataset c ON o.customer_id = c.customer_id
    WHERE o.order_status = 'delivered'
      AND o.order_delivered_customer_date IS NOT NULL
      AND o.order_delivered_carrier_date IS NOT NULL
    GROUP BY s.seller_zip_code_prefix, c.customer_zip_code_prefix
    HAVING COUNT(*) >= 10  -- 통계적 신뢰도 확보
)
SELECT 
    rp.from_zip,
    rp.to_zip,
    rp.total_orders,
    rp.avg_shipping_days,
    rp.delay_rate,
    rp.avg_delay_days,
    -- 도로 프로파일 결합
    zrp.highway_ratio,
    zrp.unpaved_ratio,
    zrp.avg_road_quality,
    zrp.complexity_score,
    zrp.total_distance_km,
    -- 도로 품질 대비 성능 효율성
    rp.avg_shipping_days / NULLIF(zrp.total_distance_km, 0) AS days_per_km,
    -- 리스크 플래그 (도로 품질이 낮은데 지연율도 높은 경우)
    CASE 
        WHEN zrp.unpaved_ratio > 0.3 AND rp.delay_rate > 20 THEN 'HIGH_RISK'
        WHEN zrp.avg_road_quality < 0.5 AND rp.delay_rate > 15 THEN 'MEDIUM_RISK'
        ELSE 'NORMAL'
    END AS risk_level
FROM route_performance rp
LEFT JOIN zip_road_profile zrp 
    ON rp.from_zip = zrp.from_zip 
    AND rp.to_zip = zrp.to_zip
ORDER BY rp.delay_rate DESC, rp.avg_delay_days DESC;
```

**검증 포인트:**
1. `unpaved_ratio`가 높은 경로의 `delay_rate`가 실제로 높은가?
2. `complexity_score`가 높을수록 `avg_delay_days`도 증가하는가?
3. 물리적 거리(`total_distance_km`)는 같은데 도로 품질이 다른 경로 간 성능 차이는?

**기대 결과 예시:**
```
from_zip | to_zip | delay_rate | unpaved_ratio | risk_level
---------|--------|------------|---------------|------------
81xxx    | 57xxx  | 46.5%      | 0.42          | HIGH_RISK
89xxx    | 57xxx  | 38.2%      | 0.35          | HIGH_RISK
04xxx    | 01xxx  | 5.8%       | 0.03          | NORMAL
```

---

### 1.3. 도로 병목 구간 식별 (Critical Path Analysis)

```sql
-- ================================================================
-- 특정 경로에서 가장 취약한 구간 찾기
-- ================================================================
WITH pr_al_route AS (
    -- PR → AL 경로의 모든 OSM 도로 추출
    SELECT 
        r.osm_id,
        r.highway,
        r.surface,
        r.lanes,
        ST_Length(r.geometry::geography) / 1000 AS segment_km
    FROM osm_brazil_roads r
    WHERE ST_DWithin(
        r.geometry::geography,
        ST_MakeLine(
            (SELECT geom FROM zip_centroids WHERE state = 'PR'),
            (SELECT geom FROM zip_centroids WHERE state = 'AL')
        )::geography,
        50000
    )
),
bottleneck_segments AS (
    SELECT 
        highway,
        surface,
        lanes,
        COUNT(*) AS segment_count,
        SUM(segment_km) AS total_km,
        -- 병목 지수: 차선 수가 적고 비포장일수록 높음
        AVG(
            CASE 
                WHEN surface IN ('unpaved', 'gravel') THEN 2.0
                ELSE 1.0
            END * 
            CASE 
                WHEN lanes::INTEGER <= 1 THEN 3.0
                WHEN lanes::INTEGER = 2 THEN 1.5
                ELSE 1.0
            END
        ) AS bottleneck_index
    FROM pr_al_route
    WHERE segment_km > 0
    GROUP BY highway, surface, lanes
)
SELECT 
    highway,
    surface,
    lanes,
    segment_count,
    ROUND(total_km::NUMERIC, 2) AS total_km,
    ROUND(bottleneck_index::NUMERIC, 2) AS bottleneck_index,
    ROUND((total_km / (SELECT SUM(total_km) FROM bottleneck_segments) * 100)::NUMERIC, 2) AS pct_of_route
FROM bottleneck_segments
ORDER BY bottleneck_index DESC, total_km DESC;
```

**활용 시나리오:**
- 결과에서 `highway='primary', surface='unpaved', lanes=1, bottleneck_index=6.0`인 구간이 전체 경로의 30%를 차지한다면?
- → "PR→AL 지연의 주범은 단선 비포장 국도 구간"이라는 물리적 근거 확보
- → 운영팀은 해당 구간 우회 가능 여부 검토 또는 고객 사전 공지 정책 수립

---

## 2. 셀러 랭킹 시스템 상세 설계

### 2.1. 다차원 셀러 스코어 산출

```sql
-- ================================================================
-- Seller Performance Score (종합 점수)
-- ================================================================
CREATE MATERIALIZED VIEW mv_seller_ranking AS
WITH seller_fulfillment AS (
    -- 1차원: 출고 속도 (Fulfillment Speed)
    SELECT 
        oi.seller_id,
        COUNT(DISTINCT oi.order_id) AS total_orders,
        AVG(EXTRACT(EPOCH FROM (o.order_delivered_carrier_date - o.order_approved_at)) / 3600) AS avg_prep_hours,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (o.order_delivered_carrier_date - o.order_approved_at)) / 3600) AS p50_prep_hours,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (o.order_delivered_carrier_date - o.order_approved_at)) / 3600) AS p90_prep_hours,
        -- 출고 속도 점수 (0~100, 빠를수록 높음)
        100 - LEAST(AVG(EXTRACT(EPOCH FROM (o.order_delivered_carrier_date - o.order_approved_at)) / 3600), 200) / 2 AS speed_score
    FROM olist_order_items_dataset oi
    JOIN olist_orders_dataset o ON oi.order_id = o.order_id
    WHERE o.order_status = 'delivered'
      AND o.order_delivered_carrier_date IS NOT NULL
      AND o.order_approved_at IS NOT NULL
    GROUP BY oi.seller_id
),
seller_reliability AS (
    -- 2차원: 약속 이행률 (Promise Adherence)
    SELECT 
        oi.seller_id,
        COUNT(CASE WHEN o.order_delivered_customer_date <= o.order_estimated_delivery_date THEN 1 END) * 100.0 / COUNT(*) AS on_time_rate,
        -- 신뢰도 점수 (0~100)
        COUNT(CASE WHEN o.order_delivered_customer_date <= o.order_estimated_delivery_date THEN 1 END) * 100.0 / COUNT(*) AS reliability_score
    FROM olist_order_items_dataset oi
    JOIN olist_orders_dataset o ON oi.order_id = o.order_id
    WHERE o.order_status = 'delivered'
      AND o.order_delivered_customer_date IS NOT NULL
      AND o.order_estimated_delivery_date IS NOT NULL
    GROUP BY oi.seller_id
),
seller_satisfaction AS (
    -- 3차원: 고객 만족도 (Customer Satisfaction)
    SELECT 
        oi.seller_id,
        AVG(r.review_score) AS avg_review_score,
        COUNT(r.review_id) AS review_count,
        -- 만족도 점수 (0~100)
        AVG(r.review_score) * 20 AS satisfaction_score
    FROM olist_order_items_dataset oi
    JOIN olist_orders_dataset o ON oi.order_id = o.order_id
    JOIN olist_order_reviews_dataset r ON o.order_id = r.order_id
    GROUP BY oi.seller_id
),
seller_consistency AS (
    -- 4차원: 성능 일관성 (Performance Consistency)
    SELECT 
        oi.seller_id,
        STDDEV(EXTRACT(EPOCH FROM (o.order_delivered_carrier_date - o.order_approved_at)) / 3600) AS prep_time_stddev,
        -- 일관성 점수 (편차가 낮을수록 높은 점수, 0~100)
        100 - LEAST(STDDEV(EXTRACT(EPOCH FROM (o.order_delivered_carrier_date - o.order_approved_at)) / 3600), 100) AS consistency_score
    FROM olist_order_items_dataset oi
    JOIN olist_orders_dataset o ON oi.order_id = o.order_id
    WHERE o.order_status = 'delivered'
      AND o.order_delivered_carrier_date IS NOT NULL
      AND o.order_approved_at IS NOT NULL
    GROUP BY oi.seller_id
)
SELECT 
    sf.seller_id,
    s.seller_city,
    s.seller_state,
    sf.total_orders,
    -- 개별 점수
    ROUND(sf.speed_score::NUMERIC, 2) AS speed_score,
    ROUND(sr.reliability_score::NUMERIC, 2) AS reliability_score,
    ROUND(ss.satisfaction_score::NUMERIC, 2) AS satisfaction_score,
    ROUND(sc.consistency_score::NUMERIC, 2) AS consistency_score,
    -- 종합 점수 (가중 평균)
    ROUND((
        sf.speed_score * 0.30 +          -- 속도 30%
        sr.reliability_score * 0.35 +     -- 신뢰도 35%
        ss.satisfaction_score * 0.25 +    -- 만족도 25%
        sc.consistency_score * 0.10       -- 일관성 10%
    )::NUMERIC, 2) AS total_score,
    -- 상세 지표
    ROUND(sf.avg_prep_hours::NUMERIC, 2) AS avg_prep_hours,
    ROUND(sf.p50_prep_hours::NUMERIC, 2) AS p50_prep_hours,
    ROUND(sr.on_time_rate::NUMERIC, 2) AS on_time_rate,
    ROUND(ss.avg_review_score::NUMERIC, 2) AS avg_review_score,
    ss.review_count,
    -- 등급 분류
    CASE 
        WHEN (sf.speed_score * 0.30 + sr.reliability_score * 0.35 + 
              ss.satisfaction_score * 0.25 + sc.consistency_score * 0.10) >= 80 THEN 'PLATINUM'
        WHEN (sf.speed_score * 0.30 + sr.reliability_score * 0.35 + 
              ss.satisfaction_score * 0.25 + sc.consistency_score * 0.10) >= 70 THEN 'GOLD'
        WHEN (sf.speed_score * 0.30 + sr.reliability_score * 0.35 + 
              ss.satisfaction_score * 0.25 + sc.consistency_score * 0.10) >= 60 THEN 'SILVER'
        ELSE 'BRONZE'
    END AS seller_tier
FROM seller_fulfillment sf
JOIN seller_reliability sr ON sf.seller_id = sr.seller_id
JOIN seller_satisfaction ss ON sf.seller_id = ss.seller_id
JOIN seller_consistency sc ON sf.seller_id = sc.seller_id
JOIN olist_sellers_dataset s ON sf.seller_id = s.seller_id
WHERE sf.total_orders >= 10  -- 최소 주문 수 필터
ORDER BY total_score DESC;
```

**활용 방안:**
1. **검색 랭킹**: 같은 상품을 파는 여러 셀러 중 `total_score`가 높은 셀러 우선 노출
2. **자동 배정**: 신규 주문 발생 시 `seller_tier='PLATINUM'` 셀러에게 우선 배정
3. **페널티 정책**: `seller_tier='BRONZE'`이면서 `on_time_rate < 50%`인 셀러는 신규 주문 배정 제한

---

### 2.2. 셀러별 경로 성능 프로파일

```sql
-- ================================================================
-- 특정 셀러가 어느 지역으로 배송할 때 잘하는지 분석
-- ================================================================
WITH seller_route_performance AS (
    SELECT 
        oi.seller_id,
        s.seller_state,
        c.customer_state,
        COUNT(*) AS deliveries,
        AVG(EXTRACT(EPOCH FROM (o.order_delivered_customer_date - o.order_delivered_carrier_date)) / 86400) AS avg_shipping_days,
        COUNT(CASE WHEN o.order_delivered_customer_date <= o.order_estimated_delivery_date THEN 1 END) * 100.0 / COUNT(*) AS on_time_rate
    FROM olist_order_items_dataset oi
    JOIN olist_orders_dataset o ON oi.order_id = o.order_id
    JOIN olist_sellers_dataset s ON oi.seller_id = s.seller_id
    JOIN olist_customers_dataset c ON o.customer_id = c.customer_id
    WHERE o.order_status = 'delivered'
      AND o.order_delivered_customer_date IS NOT NULL
      AND o.order_delivered_carrier_date IS NOT NULL
    GROUP BY oi.seller_id, s.seller_state, c.customer_state
    HAVING COUNT(*) >= 5
)
SELECT 
    srp.seller_id,
    srp.seller_state || ' → ' || srp.customer_state AS route,
    srp.deliveries,
    ROUND(srp.avg_shipping_days::NUMERIC, 2) AS avg_days,
    ROUND(srp.on_time_rate::NUMERIC, 2) AS on_time_pct,
    -- 해당 경로의 도로 품질 정보
    zrp.unpaved_ratio,
    zrp.avg_road_quality,
    -- 셀러의 해당 경로 특화 점수
    CASE 
        WHEN srp.on_time_rate >= 90 AND srp.avg_shipping_days < 5 THEN 'SPECIALIST'
        WHEN srp.on_time_rate >= 80 THEN 'RELIABLE'
        WHEN srp.on_time_rate < 60 THEN 'AVOID'
        ELSE 'NORMAL'
    END AS route_expertise
FROM seller_route_performance srp
LEFT JOIN zip_road_profile zrp 
    ON srp.seller_state = SUBSTRING(zrp.from_zip, 1, 2)
    AND srp.customer_state = SUBSTRING(zrp.to_zip, 1, 2)
ORDER BY srp.on_time_rate DESC, srp.avg_shipping_days ASC;
```

**인사이트 예시:**
- 셀러 A: SP → RJ 경로에서 `on_time_rate=95%` → 이 경로로는 A 우선 배정
- 셀러 A: SP → AM 경로에서 `on_time_rate=45%` → 이 경로로는 A 배정 회피
- → **"셀러의 절대 점수가 아니라 경로별 적합성"** 기반 배정 로직 구현

---

## 3. 경로-셀러 통합 스코어링

### 3.1. Smart Routing Score v2.0 구현

```sql
-- ================================================================
-- 신규 주문 발생 시 최적 셀러 선정 로직
-- ================================================================
CREATE OR REPLACE FUNCTION calculate_smart_routing_score(
    p_customer_zip VARCHAR,
    p_product_id VARCHAR
) RETURNS TABLE (
    seller_id VARCHAR,
    routing_score NUMERIC,
    estimated_days NUMERIC,
    confidence_level VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    WITH eligible_sellers AS (
        -- 해당 상품을 보유한 셀러 (재고 가정)
        SELECT DISTINCT 
            oi.seller_id,
            s.seller_zip_code_prefix AS seller_zip
        FROM olist_order_items_dataset oi
        JOIN olist_sellers_dataset s ON oi.seller_id = s.seller_id
        WHERE oi.product_id = p_product_id
    ),
    seller_scores AS (
        SELECT 
            es.seller_id,
            es.seller_zip,
            -- 셀러 기본 점수
            sr.total_score AS seller_base_score,
            sr.avg_prep_hours,
            -- 경로 품질 정보
            zrp.avg_road_quality,
            zrp.complexity_score,
            zrp.unpaved_ratio,
            zrp.total_distance_km,
            -- 과거 배송 성능
            rp.avg_shipping_days,
            rp.delay_rate
        FROM eligible_sellers es
        JOIN mv_seller_ranking sr ON es.seller_id = sr.seller_id
        LEFT JOIN zip_road_profile zrp 
            ON es.seller_zip = zrp.from_zip 
            AND p_customer_zip = zrp.to_zip
        LEFT JOIN (
            -- 해당 경로의 과거 평균 성능
            SELECT 
                s.seller_zip_code_prefix AS from_zip,
                c.customer_zip_code_prefix AS to_zip,
                AVG(EXTRACT(EPOCH FROM (o.order_delivered_customer_date - o.order_delivered_carrier_date)) / 86400) AS avg_shipping_days,
                COUNT(CASE WHEN o.order_delivered_customer_date > o.order_estimated_delivery_date THEN 1 END) * 100.0 / COUNT(*) AS delay_rate
            FROM olist_orders_dataset o
            JOIN olist_order_items_dataset oi ON o.order_id = oi.order_id
            JOIN olist_sellers_dataset s ON oi.seller_id = s.seller_id
            JOIN olist_customers_dataset c ON o.customer_id = c.customer_id
            WHERE o.order_status = 'delivered'
            GROUP BY s.seller_zip_code_prefix, c.customer_zip_code_prefix
        ) rp ON es.seller_zip = rp.from_zip AND p_customer_zip = rp.to_zip
    )
    SELECT 
        ss.seller_id,
        -- Smart Routing Score 계산
        ROUND((
            -- 1. 셀러 기본 점수 (40%)
            (ss.seller_base_score * 0.4) +
            -- 2. 도로 품질 보정 (30%)
            (COALESCE(ss.avg_road_quality, 0.5) * 100 * 0.3) +
            -- 3. 과거 경로 성능 (30%)
            ((100 - COALESCE(ss.delay_rate, 10)) * 0.3)
        )::NUMERIC, 2) AS routing_score,
        -- 예상 배송 일수
        ROUND((
            (ss.avg_prep_hours / 24) +  -- 출고 시간
            COALESCE(ss.avg_shipping_days, ss.total_distance_km / 500) *  -- 운송 시간
            (1.0 + COALESCE(ss.unpaved_ratio, 0) * 0.5 + COALESCE(ss.complexity_score, 0) * 0.3)  -- 도로 품질 페널티
        )::NUMERIC, 2) AS estimated_days,
        -- 신뢰 수준
        CASE 
            WHEN ss.avg_shipping_days IS NOT NULL AND zrp.route_volume > 50 THEN 'HIGH'
            WHEN ss.avg_shipping_days IS NOT NULL THEN 'MEDIUM'
            ELSE 'LOW'
        END AS confidence_level
    FROM seller_scores ss
    ORDER BY routing_score DESC, estimated_days ASC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;
```

**사용 예시:**
```sql
-- 고객 우편번호 01310, 상품 ID xyz123에 대한 최적 셀러 추천
SELECT * FROM calculate_smart_routing_score('01310', 'xyz123');
```

**결과 예시:**
```
seller_id | routing_score | estimated_days | confidence_level
----------|---------------|----------------|------------------
abc123    | 87.5          | 3.2            | HIGH
def456    | 82.3          | 4.1            | MEDIUM
ghi789    | 79.8          | 3.8            | HIGH
```

---

### 3.2. 경로별 대안 셀러 그룹화

```sql
-- ================================================================
-- 특정 경로에 대해 티어별 셀러 풀 구성
-- ================================================================
WITH route_sellers AS (
    SELECT 
        c.customer_state,
        oi.seller_id,
        s.seller_state,
        sr.seller_tier,
        sr.total_score,
        COUNT(*) AS past_deliveries,
        AVG(EXTRACT(EPOCH FROM (o.order_delivered_customer_date - o.order_delivered_carrier_date)) / 86400) AS avg_days
    FROM olist_orders_dataset o
    JOIN olist_order_items_dataset oi ON o.order_id = oi.order_id
    JOIN olist_sellers_dataset s ON oi.seller_id = s.seller_id
    JOIN olist_customers_dataset c ON o.customer_id = c.customer_id
    JOIN mv_seller_ranking sr ON oi.seller_id = sr.seller_id
    WHERE o.order_status = 'delivered'
    GROUP BY c.customer_state, oi.seller_id, s.seller_state, sr.seller_tier, sr.total_score
)
SELECT 
    customer_state AS destination,
    seller_tier,
    COUNT(DISTINCT seller_id) AS available_sellers,
    ROUND(AVG(total_score)::NUMERIC, 2) AS avg_tier_score,
    ROUND(AVG(avg_days)::NUMERIC, 2) AS avg_delivery_days,
    STRING_AGG(seller_id, ', ' ORDER BY total_score DESC) AS seller_list
FROM route_sellers
GROUP BY customer_state, seller_tier
ORDER BY customer_state, seller_tier;
```

**활용:**
- SP 주로 배송 시: PLATINUM 티어 셀러 5명, GOLD 12명, SILVER 23명 확보
- 주문 폭증 시 GOLD 티어까지 자동 배정 확장
- BRONZE 티어는 긴급 상황에만 활용

---

## 4. 실시간 의사결정 로직

### 4.1. 배송 지연 사전 예측 알고리즘

```sql
-- ================================================================
-- 주문 발생 즉시 지연 위험도 계산
-- ================================================================
CREATE OR REPLACE FUNCTION predict_delay_risk(
    p_order_id VARCHAR
) RETURNS TABLE (
    risk_level VARCHAR,
    risk_score NUMERIC,
    primary_risk_factor VARCHAR,
    recommended_action TEXT
) AS $$
DECLARE
    v_seller_zip VARCHAR;
    v_customer_zip VARCHAR;
    v_seller_tier VARCHAR;
    v_road_quality NUMERIC;
    v_unpaved_ratio NUMERIC;
    v_seller_on_time_rate NUMERIC;
BEGIN
    -- 주문 정보 추출
    SELECT 
        s.seller_zip_code_prefix,
        c.customer_zip_code_prefix,
        sr.seller_tier,
        sr.on_time_rate
    INTO v_seller_zip, v_customer_zip, v_seller_tier, v_seller_on_time_rate
    FROM olist_orders_dataset o
    JOIN olist_order_items_dataset oi ON o.order_id = oi.order_id
    JOIN olist_sellers_dataset s ON oi.seller_id = s.seller_id
    JOIN olist_customers_dataset c ON o.customer_id = c.customer_id
    LEFT JOIN mv_seller_ranking sr ON oi.seller_id = sr.seller_id
    WHERE o.order_id = p_order_id
    LIMIT 1;
    
    -- 경로 품질 조회
    SELECT avg_road_quality, unpaved_ratio
    INTO v_road_quality, v_unpaved_ratio
    FROM zip_road_profile
    WHERE from_zip = v_seller_zip AND to_zip = v_customer_zip;
    
    -- 리스크 스코어 계산
    RETURN QUERY
    SELECT 
        CASE 
            WHEN (
                (COALESCE(v_seller_on_time_rate, 70) < 60) OR
                (COALESCE(v_unpaved_ratio, 0) > 0.4) OR
                (COALESCE(v_road_quality, 0.5) < 0.3)
            ) THEN 'HIGH'
            WHEN (
                (COALESCE(v_seller_on_time_rate, 70) < 75) OR
                (COALESCE(v_unpaved_ratio, 0) > 0.2)
            ) THEN 'MEDIUM'
            ELSE 'LOW'
        END AS risk_level,
        ROUND((
            (100 - COALESCE(v_seller_on_time_rate, 70)) * 0.4 +
            (COALESCE(v_unpaved_ratio, 0) * 100) * 0.3 +
            ((1 - COALESCE(v_road_quality, 0.5)) * 100) * 0.3
        )::NUMERIC, 2) AS risk_score,
        CASE 
            WHEN COALESCE(v_seller_on_time_rate, 70) < 60 THEN 'SELLER_UNRELIABLE'
            WHEN COALESCE(v_unpaved_ratio, 0) > 0.4 THEN 'POOR_ROAD_INFRASTRUCTURE'
            WHEN COALESCE(v_road_quality, 0.5) < 0.3 THEN 'COMPLEX_ROUTE'
            ELSE 'NORMAL_OPERATION'
        END AS primary_risk_factor,
        CASE 
            WHEN COALESCE(v_seller_on_time_rate, 70) < 60 THEN 
                '셀러 성능 저하. 대안 셀러로 재배정을 권장합니다.'
            WHEN COALESCE(v_unpaved_ratio, 0) > 0.4 THEN 
                '비포장 도로 구간 40% 이상. 고객에게 배송 지연 가능성 사전 안내 필요.'
            WHEN COALESCE(v_road_quality, 0.5) < 0.3 THEN 
                '경로 복잡도 높음. ETA +2일 보정 및 모니터링 강화.'
            ELSE 
                '정상 범위 내 주문. 표준 프로세스 진행.'
        END AS recommended_action;
END;
$$ LANGUAGE plpgsql;
```

**실시간 트리거 예시:**
```sql
-- 주문 생성 시 자동 실행
CREATE TRIGGER trg_order_risk_assessment
AFTER INSERT ON olist_orders_dataset
FOR EACH ROW
EXECUTE FUNCTION log_delay_risk(NEW.order_id);
```

---

### 4.2. 동적 ETA 계산 엔진

```sql
-- ================================================================
-- 주문 시점의 컨텍스트를 모두 반영한 정밀 ETA
-- ================================================================
CREATE OR REPLACE FUNCTION calculate_dynamic_eta(
    p_seller_id VARCHAR,
    p_customer_zip VARCHAR,
    p_product_weight NUMERIC,
    p_order_datetime TIMESTAMP
) RETURNS TABLE (
    base_eta_days NUMERIC,
    road_penalty_days NUMERIC,
    seller_penalty_days NUMERIC,
    temporal_penalty_days NUMERIC,
    final_eta_days NUMERIC,
    confidence_level VARCHAR
) AS $$
DECLARE
    v_dow INTEGER;
    v_hour INTEGER;
BEGIN
    v_dow := EXTRACT(DOW FROM p_order_datetime);
    v_hour := EXTRACT(HOUR FROM p_order_datetime);
    
    RETURN QUERY
    WITH seller_info AS (
        SELECT 
            s.seller_zip_code_prefix,
            sr.avg_prep_hours,
            sr.on_time_rate
        FROM olist_sellers_dataset s
        JOIN mv_seller_ranking sr ON s.seller_id = sr.seller_id
        WHERE s.seller_id = p_seller_id
    ),
    route_info AS (
        SELECT 
            avg_road_quality,
            unpaved_ratio,
            complexity_score,
            total_distance_km
        FROM zip_road_profile
        WHERE from_zip = (SELECT seller_zip_code_prefix FROM seller_info)
          AND to_zip = p_customer_zip
    )
    SELECT 
        -- 1. 기본 ETA (거리 기반)
        ROUND((ri.total_distance_km / 500)::NUMERIC, 2) AS base_eta_days,
        
        -- 2. 도로 품질 페널티
        ROUND((
            COALESCE(ri.unpaved_ratio, 0) * 2.0 +
            COALESCE(ri.complexity_score, 0) * 0.5
        )::NUMERIC, 2) AS road_penalty_days,
        
        -- 3. 셀러 성능 페널티
        ROUND((
            CASE 
                WHEN si.on_time_rate < 70 THEN 1.5
                WHEN si.on_time_rate < 85 THEN 0.5
                ELSE 0
            END
        )::NUMERIC, 2) AS seller_penalty_days,
        
        -- 4. 시간적 페널티 (주말/야간 주문)
        ROUND((
            CASE 
                WHEN v_dow IN (0, 6) THEN 1.0  -- 주말
                WHEN v_hour BETWEEN 20 AND 23 OR v_hour BETWEEN 0 AND 6 THEN 0.5  -- 야간
                ELSE 0
            END
        )::NUMERIC, 2) AS temporal_penalty_days,
        
        -- 5. 최종 ETA
        ROUND((
            (ri.total_distance_km / 500) +
            (si.avg_prep_hours / 24) +
            (COALESCE(ri.unpaved_ratio, 0) * 2.0 + COALESCE(ri.complexity_score, 0) * 0.5) +
            CASE WHEN si.on_time_rate < 70 THEN 1.5 WHEN si.on_time_rate < 85 THEN 0.5 ELSE 0 END +
            CASE WHEN v_dow IN (0, 6) THEN 1.0 WHEN v_hour BETWEEN 20 AND 6 THEN 0.5 ELSE 0 END
        )::NUMERIC, 1) AS final_eta_days,
        
        -- 6. 신뢰 수준
        CASE 
            WHEN ri.total_distance_km IS NULL THEN 'LOW'
            WHEN si.on_time_rate < 60 THEN 'LOW'
            WHEN ri.unpaved_ratio > 0.3 THEN 'MEDIUM'
            ELSE 'HIGH'
        END AS confidence_level
    FROM seller_info si
    CROSS JOIN route_info ri;
END;
$$ LANGUAGE plpgsql;
```

**고객에게 제공되는 정보:**
```
기본 배송: 3.2일
도로 여건: +0.8일 (비포장 구간 포함)
현재 시각: +0.5일 (야간 주문)
───────────────────
예상 도착: 4.5일 (신뢰도: MEDIUM)
```

---

## 5. 운영 대시보드 KPI

### 5.1. 실시간 물류 건강도 모니터링

```sql
-- ================================================================
-- 대시보드용 핵심 지표 집계 (매 1시간 갱신)
-- ================================================================
CREATE MATERIALIZED VIEW mv_logistics_health_dashboard AS
WITH today_orders AS (
    SELECT 
        o.order_id,
        o.order_purchase_timestamp,
        oi.seller_id,
        s.seller_state,
        c.customer_state
    FROM olist_orders_dataset o
    JOIN olist_order_items_dataset oi ON o.order_id = oi.order_id
    JOIN olist_sellers_dataset s ON oi.seller_id = s.seller_id
    JOIN olist_customers_dataset c ON o.customer_id = c.customer_id
    WHERE DATE(o.order_purchase_timestamp) = CURRENT_DATE
),
risk_distribution AS (
    SELECT 
        COUNT(*) AS total_orders,
        COUNT(CASE WHEN (SELECT risk_level FROM predict_delay_risk(order_id)) = 'HIGH' THEN 1 END) AS high_risk_orders,
        COUNT(CASE WHEN (SELECT risk_level FROM predict_delay_risk(order_id)) = 'MEDIUM' THEN 1 END) AS medium_risk_orders
    FROM today_orders
)
SELECT 
    -- 전체 건강도 점수 (0~100)
    ROUND(100 - (rd.high_risk_orders * 100.0 / NULLIF(rd.total_orders, 0) * 2 + 
                 rd.medium_risk_orders * 100.0 / NULLIF(rd.total_orders, 0))::NUMERIC, 2) AS health_score,
    
    -- 상세 지표
    rd.total_orders,
    rd.high_risk_orders,
    rd.medium_risk_orders,
    ROUND((rd.high_risk_orders * 100.0 / NULLIF(rd.total_orders, 0))::NUMERIC, 2) AS high_risk_pct,
    
    -- 경로별 TOP 리스크
    (
        SELECT STRING_AGG(seller_state || '→' || customer_state, ', ' ORDER BY cnt DESC)
        FROM (
            SELECT seller_state, customer_state, COUNT(*) AS cnt
            FROM today_orders to2
            WHERE (SELECT risk_level FROM predict_delay_risk(to2.order_id)) = 'HIGH'
            GROUP BY seller_state, customer_state
            LIMIT 3
        ) t
    ) AS top_risk_routes,
    
    -- 셀러별 TOP 리스크
    (
        SELECT STRING_AGG(seller_id, ', ' ORDER BY cnt DESC)
        FROM (
            SELECT seller_id, COUNT(*) AS cnt
            FROM today_orders to3
            WHERE (SELECT risk_level FROM predict_delay_risk(to3.order_id)) = 'HIGH'
            GROUP BY seller_id
            LIMIT 3
        ) t
    ) AS top_risk_sellers,
    
    CURRENT_TIMESTAMP AS last_updated
FROM risk_distribution rd;
```

**Grafana 대시보드 구성:**
1. **Health Score Gauge**: 0~100 점수를 색상으로 표시 (빨강/노랑/초록)
2. **Risk Distribution Pie Chart**: HIGH/MEDIUM/LOW 비율
3. **Top Risk Routes Table**: 실시간 집중 모니터링 대상
4. **Alert Trigger**: `health_score < 70` 시 운영팀 Slack 알림

---

### 5.2. 셀러 성과 추적 대시보드

```sql
-- ================================================================
-- 주간 셀러 성과 리포트 (매주 월요일 생성)
-- ================================================================
CREATE MATERIALIZED VIEW mv_weekly_seller_report AS
WITH last_week AS (
    SELECT 
        oi.seller_id,
        COUNT(DISTINCT oi.order_id) AS orders_delivered,
        AVG(EXTRACT(EPOCH FROM (o.order_delivered_carrier_date - o.order_approved_at)) / 3600) AS avg_prep_hours,
        COUNT(CASE WHEN o.order_delivered_customer_date <= o.order_estimated_delivery_date THEN 1 END) * 100.0 / COUNT(*) AS on_time_rate,
        AVG(r.review_score) AS avg_review
    FROM olist_order_items_dataset oi
    JOIN olist_orders_dataset o ON oi.order_id = o.order_id
    LEFT JOIN olist_order_reviews_dataset r ON o.order_id = r.order_id
    WHERE o.order_status = 'delivered'
      AND DATE(o.order_delivered_customer_date) >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY oi.seller_id
),
prev_week AS (
    SELECT 
        oi.seller_id,
        COUNT(DISTINCT oi.order_id) AS orders_delivered,
        AVG(EXTRACT(EPOCH FROM (o.order_delivered_carrier_date - o.order_approved_at)) / 3600) AS avg_prep_hours,
        COUNT(CASE WHEN o.order_delivered_customer_date <= o.order_estimated_delivery_date THEN 1 END) * 100.0 / COUNT(*) AS on_time_rate
    FROM olist_order_items_dataset oi
    JOIN olist_orders_dataset o ON oi.order_id = o.order_id
    WHERE o.order_status = 'delivered'
      AND DATE(o.order_delivered_customer_date) >= CURRENT_DATE - INTERVAL '14 days'
      AND DATE(o.order_delivered_customer_date) < CURRENT_DATE - INTERVAL '7 days'
    GROUP BY oi.seller_id
)
SELECT 
    lw.seller_id,
    sr.seller_tier,
    sr.total_score AS current_total_score,
    -- 이번 주 성과
    lw.orders_delivered,
    ROUND(lw.avg_prep_hours::NUMERIC, 2) AS prep_hours,
    ROUND(lw.on_time_rate::NUMERIC, 2) AS on_time_pct,
    ROUND(lw.avg_review::NUMERIC, 2) AS avg_review,
    -- 전주 대비 변화
    ROUND((lw.on_time_rate - COALESCE(pw.on_time_rate, lw.on_time_rate))::NUMERIC, 2) AS on_time_delta,
    ROUND((lw.avg_prep_hours - COALESCE(pw.avg_prep_hours, lw.avg_prep_hours))::NUMERIC, 2) AS prep_hours_delta,
    -- 등급 변동 가능성
    CASE 
        WHEN lw.on_time_rate < 60 AND sr.seller_tier IN ('PLATINUM', 'GOLD') THEN 'DOWNGRADE_RISK'
        WHEN lw.on_time_rate > 90 AND sr.seller_tier IN ('SILVER', 'BRONZE') THEN 'UPGRADE_CANDIDATE'
        ELSE 'STABLE'
    END AS tier_status
FROM last_week lw
LEFT JOIN prev_week pw ON lw.seller_id = pw.seller_id
JOIN mv_seller_ranking sr ON lw.seller_id = sr.seller_id
ORDER BY lw.orders_delivered DESC;
```

**활용:**
- 성과 하락 셀러에게 자동 경고 이메일 발송
- 상승 셀러에게 인센티브 제공
- 티어 조정 의사결정 근거

---

## 6. 프로젝트 핵심 성과 요약

### 6.1. 데이터 기반 의사결정 체계 확립

| 의사결정 | Before (As-Is) | After (To-Be) |
|---------|----------------|---------------|
| 셀러 배정 | 무작위 또는 선착순 | 경로별 최적 셀러 자동 선정 |
| ETA 제공 | 고정값 (7일) | 동적 계산 (3.2~9.5일) |
| 지연 대응 | 사후 CS 처리 | 사전 리스크 탐지 및 알림 |
| 셀러 관리 | 주관적 평가 | 4차원 정량 스코어 |

### 6.2. 기대 효과

**정량적 목표:**
- 배송 지연율 30% 감소 (현재 20% → 목표 14%)
- 고객 리뷰 점수 0.3점 상승 (현재 4.1 → 목표 4.4)
- 지연 관련 CS 문의 40% 감소

**정성적 가치:**
- "왜 늦는지" 물리적으로 설명 가능한 시스템
- 셀러-경로 매칭의 과학화
- 데이터 기반 물류 네트워크 최적화 기반 마련

---

## 7. 다음 단계 (Roadmap)

1. **Phase 1 (현재)**: SQL 기반 분석 및 검증
2. **Phase 2**: Kafka Streams 기반 실시간 리플레이 시스템 구축
3. **Phase 3**: ML 모델 도입 (XGBoost 기반 지연 예측)
4. **Phase 4**: A/B 테스트를 통한 라우팅 알고리즘 최적화

---

본 문서는 단순한 데이터 분석을 넘어, **"물류를 데이터로 이해하고 제어하는"** 시스템 설계의 청사진입니다.