# E-Commerce Intelligence Project (EIP)

# 프로젝트 개요

“검색엔진 + 벡터 서치 + 개인화 추천 + 광고 CTR 모델 + 재고/물류 지표를 통합한 이커머스 AI 플랫폼”

> Kaggle Olist(이커머스·물류), Amazon Products(상품/텍스트), Criteo/Avazu(광고 클릭 로그) 데이터를 통합해
> 검색(BM25 + 벡터), 추천(User·Item Embedding), 광고 CTR 예측, 재고/물류 기반 랭킹 보정을
> Kafka 중심의 마이크로서비스 아키텍처로 구현한 엔드투엔드 AI 기반 이커머스 플랫폼.

---

# 프로젝트 주요 목표

1. 고품질 상품 검색엔진 구축

- BM25 + HNSW 기반 벡터 검색
- Hybrid Search 랭킹 모델 구현

2. 개인화 추천 시스템

- User/Item Embedding 모델 기반 Top-K 추천
- 세션/뷰 이벤트 기반 실시간 재랭킹

3. 광고(Ads) CTR 예측 및 랭킹 엔진

- Criteo/Avazu를 학습한 CTR 예측 모델(DeepFM/Wide&Deep)
- 검색/추천 결과 위에 광고 후보군을 CTR × Bid로 최종 정렬

4. OMS/WMS 물류 데이터 기반 품질 지표 반영

- 배송 지연률, 반품률, 재고량 등으로 상품 스코어 보정
- Low-stock 상품 자동 페널티 / 재고 많은 상품 우대

5. 실시간 이벤트 스트림 + 지표 파이프라인

- 검색·조회·장바구니·구매·광고 클릭 이벤트를 Kafka로 수집
- Redis ZSET 기반 실시간 인기상품/인기검색어 랭킹

6. Clean Architecture + MSA 구성

- 검색, 추천, 광고, 인덱싱, 임베딩, Feature Store, 물류 인텔리전스 등을 독립 서비스로 구성

---

# 🗂 사용 데이터셋

1. Kaggle Olist (브라질 이커머스 전체 흐름 데이터)

주문(OMS), 물류(WMS), 배송 SLA, 반품 정보 등 포함
→ 상품 카탈로그 + 주문 로그 + 물류 데이터 활용

2. Amazon Product Metadata & Reviews

상품 설명, 리뷰 텍스트, 카테고리
→ 벡터 임베딩 생성 + 검색 품질 향상 + 유사 상품 추천

3. Criteo / Avazu CTR Dataset

광고 노출/클릭 로그
→ 광고 CTR 모델 학습 + Ads Ranking

---

🧱 핵심 구성 요소

1. 검색엔진(Search Service)

- ElasticSearch 기반 BM25 인덱스
- HNSW(FAISS/NMSLIB) 기반 knn_vector
- Hybrid Search = BM25 + Vector Score Fusion

2. 벡터/추천 엔진(Recommendation Service)

- Item Embedding: Amazon 텍스트 기반
- User Embedding: Olist 주문/조회 이력 기반
- ANN 기반 Top-K 추천

3. 광고 엔진(Ads Service)

- Candidate Generation: 검색결과 + 카테고리 + 벡터 유사 상품
- CTR Prediction Model: DeepFM/Wide&Deep/XGBoost
- Final Ad Ranking = CTR × Bid × Relevance

4. 재고/물류 인텔리전스(Logistics Intelligence)

- 배송 지연률, 재고 부족률, 반품률 → 정규화한 logistics_score
- Ranking 시 score penalty/boost 적용

5. Kafka 기반 파이프라인

- 이벤트 토픽: search, view, cart, purchase, ad-click
- Consumer 그룹:
- Indexer
- Feature Aggregator
- Ranking Updater

6. Redis 실시간 데이터

- hot_products:\* – 조회수 기반 실시간 랭킹(ZSET)
- user_reco:\* – 개인화 추천 캐싱
- Feature Store 일부도 Redis로 구성

7. Observability

- Prometheus + Grafana
- p95 latency, QPS, cache hit ratio, indexing throughput, CTR 모델 latency

---

🧩 전체 아키텍처 (요약)

```
[Dataset: Olist, Amazon, Criteo/Avazu]
  ↓ (ETL)
[Data Lake / Feature Store / Preprocessing]
  ↓
+---------------------------+
| Kafka Event Streams |
+---------------------------+
(search events, ad clicks, orders, etc.)
  ↓
┌────────────────────────────────────────────┐
│ Microservices                              │
│                                            │
│ 1. Search Service (OpenSearch)             │
│ 2. Vector/Embedding Service                │
│ 3. Recommendation Service (ANN)            │
│ 4. Ads CTR Model Service                   │
│ 5. Ranking Service (Search + Ads + Stock)  │
│ 6. Inventory/Logistics Service             │
│ 7. Indexer & Data Pipeline Service         │
└────────────────────────────────────────────┘
  ↓
[API Gateway / BFF]
  ↓
[Client / Admin Dashboard]

```

---

# 이 프로젝트로 증명 가능한 기술 역량

1. 검색엔진 전문성

- OpenSearch 클러스터 관리
- Query DSL · BM25 튜닝
- HNSW 벡터 검색 및 Hybrid Search 구현

1. 머신러닝·추천 시스템 전문성

- Embedding 생성/ANN 검색
- DeepFM/Wide&Deep 기반 CTR 예측
- Re-ranking(가중 합 + 비즈니스 지표 결합)

1. 데이터 엔지니어링

- Kafka ingestion pipeline
- 이벤트 기반 실시간 처리
- Feature Store 설계 및 서빙

1. MSA + Clean Architecture

- 도메인 분리
- 서비스 단위 배포
- 의존성 없는 안정적 구조 설계

1. 이커머스/광고 도메인 이해도

- 검색 → 추천 → 광고 → 물류 → 재고 → 재구매 플로우
- 실제 기업 시스템과 매우 유사한 설계 경험

# 고려 사항

- “검색 → 추천 → 광고 → 물류 → 재고”를 MSA로 나누고 동기 체이닝을 할시 발생할 문제

  - 체인이 길수록 p95/p99가 급격히 나빠짐
  - 한 서비스 장애가 전체 검색을 망침 (cascading failure)

  - 트래픽이 폭증할 때 가장 먼저 터짐

> 동기 호출은 “최소한”으로
>
> - earch API가 요청당 동기로 호출하는 건 Ads + Reco 정도까지만(심지어 이것도 옵션)
> - Logistics/Inventory는 미리 계산된 score/필터 값을 Search index에 넣어두거나 캐시에서 읽는다.

## MSA 구조 (현실적인 분리)

### A. 온라인 Query Path (사용자 요청에 즉시 응답)

1. API Gateway / BFF
2. Search Service (주 응답 생성)

   - OpenSearch에서 BM25+벡터 하이브리드 검색
   - (옵션) Reco 후보/Ads 후보를 “짧게” 붙임

3. Ads Service (옵션/짧은 SLA)

   - 광고 후보 + CTR 스코어 + bid 적용

4. Reco Service (옵션/짧은 SLA)

   - 유사 상품 / 개인화 Top-K

### B. 상태 갱신 Path (비동기 이벤트 기반)

- Inventory Service: 재고 변경 이벤트 소유
- Logistics Service: 배송/지연/반품 지표 소유
- 이 둘은 Kafka로 이벤트 발행
- Indexer Service(또는 Search Ingest)가 그 이벤트를 받아 OpenSearch 문서를 업데이트

Search는 “조회(Serving)”에 집중
Inventory/Logistics는 “진실의 원천(Source of Truth)”로 존재
Search 인덱스는 “서빙 최적화용 뷰(Materialized View)”로 두는 구조

## “정답에 가까운” 데이터 소유권(경계) 설계

- Inventory Service가 소유하는 데이터

  - stock_on_hand, stock_reserved, atp(available-to-promise)
  - 재고 차감/예약/복구 이벤트

- Logistics Service가 소유하는 데이터

  - 배송 리드타임, 지연률, 반품률, 지역별 배송 가능 여부

- Ads Service가 소유하는 데이터

  - 캠페인, 예산, bid, 타게팅, 소재(creative)
  - impression/click 로그 + CTR 모델 호출

- Reco Service가 소유하는 데이터

  - user embedding, item embedding
  - 추천 결과 캐시/피드

- Search Service가 소유하는 데이터
  - “검색 결과를 서빙하기 위한 인덱스/랭킹” 로직
  - query 분석, 검색 전처리, 하이브리드 서치 조합

# 설계에 대해 좀더 고민하고 MSA를 어떻게 나눠 진행할지 검토
