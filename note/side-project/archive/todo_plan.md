# Phase 1 MVP: 4주 실행 계획

## 목표

**"배송 지연이 어디서 발생하는지 데이터로 증명하고,
재고 관리 시스템 도입 시 67% 개선 가능함을 시뮬레이션"**

---

## Week 1: 데이터 파이프라인 구축

### 목표

Olist 데이터를 PostgreSQL에 적재하고, 기본 분석 쿼리 실행

### 작업 목록

- [ ] **Day 1-2**: 환경 설정

  ```bash
  # Docker Compose로 PostgreSQL + Grafana 실행
  docker-compose up -d
  ```

  - PostgreSQL 12+
  - Grafana 9+
  - Jupyter Notebook (분석용)

- [ ] **Day 3-4**: 데이터 적재
  ```sql
  -- Olist CSV → PostgreSQL 임포트
  -- 테이블 생성 및 Foreign Key 설정
  ```
- [ ] **Day 5**: 첫 번째 인사이트 추출
  ```sql
  -- 쿼리: "배송 시간의 54%가 셀러 출고 단계"
  SELECT
    AVG(EXTRACT(EPOCH FROM (order_delivered_carrier_date - order_approved_at)) / 3600) /
    AVG(EXTRACT(EPOCH FROM (order_delivered_customer_date - order_approved_at)) / 3600) * 100
    AS prep_time_percentage
  FROM olist_orders_dataset
  WHERE order_status = 'delivered';
  ```

### 완료 기준

- ✅ PostgreSQL에 모든 Olist 테이블 적재
- ✅ Grafana에서 PostgreSQL 연결 확인
- ✅ "배송 단계별 소요 시간" 쿼리 결과 검증

### 데모

- Slack/팀 채널에 스크린샷 공유:
  - "SP 지역 셀러들의 평균 출고 시간: 231시간"

---

## Week 2: 셀러 성과 분석 대시보드

### 목표

Grafana에서 "문제가 있는 셀러/지역" 시각화

### 작업 목록

- [ ] **Day 1-2**: 셀러별 성과 집계 테이블 생성

  ```sql
  CREATE MATERIALIZED VIEW mv_seller_performance AS
  SELECT
    seller_id,
    COUNT(*) AS total_orders,
    AVG(prep_time_hours) AS avg_prep_hours,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY prep_time_hours) AS p90_prep_hours,
    on_time_rate
  FROM ...
  GROUP BY seller_id;
  ```

- [ ] **Day 3-4**: Grafana 대시보드 구축
  - Panel 1: 셀러별 출고 시간 (Bar Chart)
  - Panel 2: 지역별 배송 지연율 (Map)
  - Panel 3: 상위 10% vs 하위 10% 셀러 비교 (Table)

- [ ] **Day 5**: 문서화
  - README에 대시보드 스크린샷 추가
  - "이 데이터가 의미하는 것" 해석 작성

### 완료 기준

- ✅ Grafana에서 실시간 쿼리 결과 시각화
- ✅ "상위 10개 지연 셀러" 리스트 자동 생성
- ✅ 팀원이 대시보드를 보고 "아, 문제가 여기 있구나" 이해

### 데모

- 녹화 영상 (30초):
  - Grafana 대시보드를 열어 "셀러 A는 평균 231시간, 셀러 B는 24시간" 보여주기

---

## Week 3: 시뮬레이션 엔진 구축

### 목표

"만약 재고 관리 시스템이 있었다면?" 시뮬레이션

### 작업 목록

- [ ] **Day 1-2**: 가상 재고 데이터 생성

  ```sql
  -- 각 셀러에게 초기 재고 50개 부여
  INSERT INTO olist_inventory ...
  ```

- [ ] **Day 3-4**: 시뮬레이션 로직 구현 (Python)

  ```python
  # Pseudo-code
  for order in orders_sorted_by_time:
      # Scenario A: 실제 배송 (먼 셀러)
      actual_time = calculate_actual_delivery_time(order)

      # Scenario B: 최적 배송 (가까운 재고 있는 셀러)
      optimal_seller = find_nearest_seller_with_stock(order)
      optimal_time = calculate_optimal_delivery_time(order, optimal_seller)

      savings = actual_time - optimal_time
  ```

- [ ] **Day 5**: 결과 집계 및 시각화
  ```sql
  SELECT
    AVG(actual_delivery_hours) AS avg_actual,
    AVG(optimized_delivery_hours) AS avg_optimized,
    AVG(actual_delivery_hours - optimized_delivery_hours) AS avg_savings
  FROM simulation_results;
  ```

### 완료 기준

- ✅ "실제 vs 최적화" 배송 시간 비교 테이블 생성
- ✅ Grafana에서 "231시간 → 48시간" 차트 시각화
- ✅ 시뮬레이션 코드 GitHub에 커밋

### 데모

- Jupyter Notebook 공유:
  - "10만 건 주문 시뮬레이션 결과: 평균 67% 단축"

---

## Week 4: 프레젠테이션 준비

### 목표

"경영진에게 투자 근거 제시" 수준의 자료 완성

### 작업 목록

- [ ] **Day 1-2**: 스토리 구성

  ```
  1. 문제: "브라질 고객들이 9일을 기다립니다"
  2. 원인: "54%가 셀러 출고 단계, 재고 관리 부재"
  3. 해결책: "재고 관리 + 스마트 라우팅"
  4. 효과: "9.6일 → 3.2일, 67% 단축"
  5. 투자: "Phase 2 구현 시 연간 $2M 절감"
  ```

- [ ] **Day 3**: PPT/PDF 작성
  - 슬라이드 1: 문제 정의 (데이터 차트)
  - 슬라이드 2: 분석 결과 (대시보드 스크린샷)
  - 슬라이드 3: 시뮬레이션 (Before/After)
  - 슬라이드 4: 기술 아키텍처 (간단히)
  - 슬라이드 5: 다음 단계 (Phase 2 계획)

- [ ] **Day 4**: 리허설
  - 10분 발표 연습
  - 피드백 수집 및 반영

- [ ] **Day 5**: 문서 정리 및 오픈소스 준비
  - README 업데이트
  - 라이선스 추가
  - GitHub Release v0.1.0

### 완료 기준

- ✅ 비기술자도 이해 가능한 프레젠테이션
- ✅ "왜 이 프로젝트가 중요한가?" 3문장으로 설명 가능
- ✅ GitHub README가 "Star 받을 만한" 수준

### 데모

- 팀 전체 회의에서 10분 발표
- 질문: "이걸 실제로 구현하면 효과가 있을까요?" → 데이터로 답변

---

## 주간 체크포인트

### 매주 금요일 17시

- [ ] 이번 주 성과 공유 (Slack)
- [ ] 다음 주 목표 설정
- [ ] 블로커 사항 논의

### 체크리스트

```
Week 1: [ ] 데이터 적재 완료
Week 2: [ ] 대시보드 1개 완성
Week 3: [ ] 시뮬레이션 결과 도출
Week 4: [ ] 프레젠테이션 준비
```

---

## 성공의 정의

### 기술적 성공

- PostgreSQL + Grafana로 실시간 분석 가능
- Python으로 10만 건 시뮬레이션 실행
- GitHub에 재현 가능한 코드 공개

### 비즈니스 성공

- "배송 지연의 54%가 셀러 출고" 데이터 증명
- "재고 관리 시 67% 개선" 시뮬레이션 완료
- 경영진/팀원이 "투자할 가치 있음" 동의

### 커리어 성공

- 포트폴리오에 "비즈니스 임팩트" 강조 가능
- 면접에서 "왜 이 프로젝트를?" 질문에 명확히 답변
- GitHub README로 "이 사람은 문제 해결자" 인식

---

## 만약 막힌다면?

### 기술적 막힘

- PostgreSQL 설치 실패 → Docker 사용
- 쿼리 너무 느림 → Materialized View 사용
- Grafana 복잡함 → Jupyter Notebook으로 대체

### 방향성 막힘

- "이게 맞나?" 의구심 → Week 1 결과 먼저 보여주고 피드백
- "너무 복잡한가?" 걱정 → Phase 1만 집중, 나머지는 Optional

### 동기 부여 막힘

- 매주 금요일 데모 → 작은 성취감
- GitHub Star 목표 → 커뮤니티 반응 확인

---

## 4주 후 모습

### 완성된 결과물

1. **GitHub Repo**: `olist-delivery-optimizer`
   - README에 "67% 개선" 강조
   - Grafana 대시보드 스크린샷
   - 시뮬레이션 결과 차트

2. **프레젠테이션 자료**
   - "브라질 배송 문제 해결" 스토리
   - 데이터 기반 근거
   - 투자 대비 효과

3. **포트폴리오**
   - "비즈니스 임팩트" 섹션 추가
   - "Event Sourcing 실전 적용" 사례

### 당신이 얻는 것

- ✅ "문제를 정의하고 데이터로 증명하는" 능력
- ✅ "기술을 비즈니스 가치로 변환하는" 스토리텔링
- ✅ "복잡한 시스템을 단계별로 구현하는" 경험

---

**첫 단계는 간단합니다:**

```bash
# 1. PostgreSQL 실행
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=pass postgres:12

# 2. Olist CSV 다운로드
wget https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce

# 3. 첫 번째 쿼리 실행
psql -h localhost -U postgres -c "SELECT COUNT(*) FROM olist_orders_dataset;"
```

**이것만 되면 Week 1 Day 1 완료입니다. 시작하세요!**
