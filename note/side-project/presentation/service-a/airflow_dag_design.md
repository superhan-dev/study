# Airflow DAG 설계: Init & Replay
## 데이터 초기화 및 리플레이 워크플로우

---

## 🎯 목적

**이벤트 흐름 확인을 위한 체계적인 데이터 준비 및 리플레이**

1. **Init DAG**: CSV 데이터를 DB에 적재 (한 번만, 멱등성 보장)
2. **Replay DAG**: DB 데이터로 리플레이 (여러 번, Init 완료 후에만 실행)

---

## 📊 DAG 전체 구조

```
┌─────────────────────────────────────────────────────────┐
│          1. Init DAG (초기 데이터 적재)                  │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐ │
│  │ Check Data   │───▶│  Load CSV    │───▶│  Verify   │ │
│  │ Exists       │    │  to Service A│    │  Load     │ │
│  └──────────────┘    └──────────────┘    └───────────┘ │
│         │ NO                                     │      │
│         ▼                                        ▼      │
│    [실행]                                   [완료]      │
│         │ YES                                           │
│         ▼                                               │
│    [스킵]                                               │
└─────────────────────────────────────────────────────────┘
                            │
                            │ Init 성공 확인
                            ▼
┌─────────────────────────────────────────────────────────┐
│          2. Replay DAG (리플레이 실행)                   │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐ │
│  │ Check Init   │───▶│ Create Replay│───▶│  Monitor  │ │
│  │ Complete     │    │ Job & Start  │    │  Progress │ │
│  └──────────────┘    └──────────────┘    └───────────┘ │
│         │ NO                                     │      │
│         ▼                                        ▼      │
│    [실패]                                   [완료]      │
│         │ YES                                           │
│         ▼                                               │
│    [실행]                                               │
└─────────────────────────────────────────────────────────┘
```

---

## 1️⃣ Init DAG (초기 데이터 적재)

### 1.1 DAG 정의

```python
from airflow import DAG
from airflow.operators.python import PythonOperator, BranchPythonOperator
from airflow.operators.dummy import DummyOperator
from airflow.utils.dates import days_ago
from datetime import timedelta
import requests
import pandas as pd
import logging

default_args = {
    'owner': 'data-team',
    'depends_on_past': False,
    'email_on_failure': True,
    'email_on_retry': False,
    'retries': 3,
    'retry_delay': timedelta(minutes=5),
}

dag = DAG(
    'olist_init_data_load',
    default_args=default_args,
    description='Initialize raw order data from CSV to Service A (once only)',
    schedule_interval=None,  # 수동 실행만
    start_date=days_ago(1),
    catchup=False,
    tags=['olist', 'init', 'data-load'],
)
```

---

### 1.2 Task 1: 데이터 존재 여부 확인

```python
def check_data_exists(**context):
    """
    Service A의 raw_order_data 테이블에 데이터가 있는지 확인
    
    Returns:
        'skip_load' - 데이터 존재 (적재 스킵)
        'load_data' - 데이터 없음 (적재 실행)
    """
    SERVICE_A_URL = "http://service-a:8080"
    
    try:
        # Service A API 호출: 데이터 개수 조회
        response = requests.get(
            f"{SERVICE_A_URL}/api/v1/raw-data/orders/count",
            timeout=10
        )
        response.raise_for_status()
        
        data_count = response.json().get('count', 0)
        
        logging.info(f"Found {data_count} orders in raw_order_data table")
        
        # 데이터가 1개라도 있으면 스킵
        if data_count > 0:
            logging.info("Data already exists. Skipping load.")
            # XCom에 저장 (다른 DAG에서 참조)
            context['ti'].xcom_push(key='init_status', value='ALREADY_LOADED')
            context['ti'].xcom_push(key='data_count', value=data_count)
            return 'skip_load'
        else:
            logging.info("No data found. Proceeding with load.")
            context['ti'].xcom_push(key='init_status', value='LOADING')
            return 'load_data'
            
    except requests.exceptions.RequestException as e:
        logging.error(f"Failed to check data existence: {e}")
        # Service A 접근 불가 시 적재 시도 (멱등성 보장됨)
        return 'load_data'

check_data = BranchPythonOperator(
    task_id='check_data_exists',
    python_callable=check_data_exists,
    dag=dag,
)
```

#### Service A API 추가 필요
```
GET /api/v1/raw-data/orders/count

Response:
{
  "count": 99441,
  "lastUpdated": "2026-01-24T10:30:00Z"
}
```

---

### 1.3 Task 2: CSV 데이터 적재

```python
def load_csv_to_service_a(**context):
    """
    CSV 파일들을 읽어서 Service A에 적재
    """
    SERVICE_A_URL = "http://service-a:8080"
    CSV_BASE_PATH = "/data/olist"
    BATCH_SIZE = 1000
    
    logging.info("Starting CSV data load...")
    
    # 1. CSV 파일 읽기
    logging.info("Reading CSV files...")
    orders_df = pd.read_csv(f"{CSV_BASE_PATH}/olist_orders_dataset.csv")
    items_df = pd.read_csv(f"{CSV_BASE_PATH}/olist_order_items_dataset.csv")
    customers_df = pd.read_csv(f"{CSV_BASE_PATH}/olist_customers_dataset.csv")
    payments_df = pd.read_csv(f"{CSV_BASE_PATH}/olist_order_payments_dataset.csv")
    reviews_df = pd.read_csv(f"{CSV_BASE_PATH}/olist_order_reviews_dataset.csv")
    
    logging.info(f"Loaded {len(orders_df)} orders from CSV")
    
    # 2. 데이터 JOIN
    logging.info("Joining data...")
    merged = orders_df.merge(customers_df, on='customer_id', how='left') \
                      .merge(payments_df, on='order_id', how='left') \
                      .merge(reviews_df, on='order_id', how='left')
    
    # 3. order_items를 JSONB로 그룹화
    logging.info("Grouping order items...")
    items_grouped = items_df.groupby('order_id').apply(
        lambda x: x[['order_item_id', 'product_id', 'seller_id', 
                     'price', 'freight_value', 'shipping_limit_date']].to_dict('records')
    ).to_dict()
    
    # 4. 배치 전송
    total_orders = len(merged)
    imported_count = 0
    failed_count = 0
    duplicate_count = 0
    
    logging.info(f"Sending {total_orders} orders to Service A...")
    
    for batch_start in range(0, total_orders, BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, total_orders)
        batch = merged.iloc[batch_start:batch_end]
        
        orders_data = []
        for _, row in batch.iterrows():
            order = {
                "orderId": row["order_id"],
                "customerId": row["customer_id"],
                "orderStatus": row["order_status"],
                "orderPurchaseTimestamp": row["order_purchase_timestamp"],
                "orderApprovedAt": row.get("order_approved_at"),
                "orderDeliveredCarrierDate": row.get("order_delivered_carrier_date"),
                "orderDeliveredCustomerDate": row.get("order_delivered_customer_date"),
                "orderEstimatedDeliveryDate": row.get("order_estimated_delivery_date"),
                "customerState": row["customer_state"],
                "customerCity": row["customer_city"],
                "customerZipCodePrefix": int(row["customer_zip_code_prefix"]),
                "orderItems": items_grouped.get(row["order_id"], []),
                "paymentValue": float(row.get("payment_value", 0)),
                "paymentType": row.get("payment_type"),
                "paymentInstallments": int(row.get("payment_installments", 1)),
                "reviewScore": int(row["review_score"]) if pd.notna(row.get("review_score")) else None,
                "reviewCommentTitle": row.get("review_comment_title"),
                "reviewCommentMessage": row.get("review_comment_message"),
            }
            orders_data.append(order)
        
        # Service A API 호출
        try:
            response = requests.post(
                f"{SERVICE_A_URL}/api/v1/raw-data/orders/batch",
                json={
                    "sourceFile": "olist_orders_dataset.csv",
                    "orders": orders_data
                },
                timeout=60
            )
            response.raise_for_status()
            
            result = response.json()
            imported_count += result.get('imported', 0)
            failed_count += result.get('failed', 0)
            duplicate_count += result.get('duplicates', 0)
            
            logging.info(
                f"Batch {batch_start//BATCH_SIZE + 1}/{(total_orders + BATCH_SIZE - 1)//BATCH_SIZE}: "
                f"imported={result.get('imported')}, "
                f"failed={result.get('failed')}, "
                f"duplicates={result.get('duplicates')}"
            )
            
        except requests.exceptions.RequestException as e:
            logging.error(f"Failed to send batch {batch_start}: {e}")
            failed_count += len(orders_data)
    
    # 5. 결과 저장 (XCom)
    context['ti'].xcom_push(key='init_status', value='COMPLETED')
    context['ti'].xcom_push(key='total_orders', value=total_orders)
    context['ti'].xcom_push(key='imported_count', value=imported_count)
    context['ti'].xcom_push(key='failed_count', value=failed_count)
    context['ti'].xcom_push(key='duplicate_count', value=duplicate_count)
    
    logging.info(
        f"Load completed: "
        f"total={total_orders}, "
        f"imported={imported_count}, "
        f"failed={failed_count}, "
        f"duplicates={duplicate_count}"
    )
    
    if failed_count > 0:
        raise Exception(f"Failed to load {failed_count} orders")

load_data = PythonOperator(
    task_id='load_data',
    python_callable=load_csv_to_service_a,
    dag=dag,
)
```

---

### 1.4 Task 3: 적재 검증

```python
def verify_data_load(**context):
    """
    적재된 데이터 검증
    """
    SERVICE_A_URL = "http://service-a:8080"
    
    # XCom에서 적재 결과 가져오기
    init_status = context['ti'].xcom_pull(key='init_status')
    
    if init_status == 'ALREADY_LOADED':
        logging.info("Data was already loaded. Verification skipped.")
        return
    
    imported_count = context['ti'].xcom_pull(key='imported_count')
    total_orders = context['ti'].xcom_pull(key='total_orders')
    
    # Service A에서 실제 데이터 개수 확인
    response = requests.get(
        f"{SERVICE_A_URL}/api/v1/raw-data/orders/count",
        timeout=10
    )
    response.raise_for_status()
    
    actual_count = response.json().get('count', 0)
    
    logging.info(
        f"Verification: "
        f"expected={imported_count}, "
        f"actual={actual_count}"
    )
    
    # 데이터 개수 일치 확인
    if actual_count < imported_count * 0.95:  # 95% 이상 적재되어야 성공
        raise Exception(
            f"Data verification failed: "
            f"expected at least {imported_count * 0.95}, "
            f"but found {actual_count}"
        )
    
    logging.info("Data verification successful!")
    
    # 최종 상태 저장
    context['ti'].xcom_push(key='init_verified', value=True)
    context['ti'].xcom_push(key='verified_count', value=actual_count)

verify_load = PythonOperator(
    task_id='verify_load',
    python_callable=verify_data_load,
    trigger_rule='none_failed',  # skip이거나 load 성공 시 실행
    dag=dag,
)
```

---

### 1.5 Task 4: 스킵 처리

```python
skip_load = DummyOperator(
    task_id='skip_load',
    dag=dag,
)
```

---

### 1.6 Task 의존성 설정

```python
# Task 흐름
check_data >> [load_data, skip_load]
load_data >> verify_load
skip_load >> verify_load
```

---

## 2️⃣ Replay DAG (리플레이 실행)

### 2.1 DAG 정의

```python
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.sensors.external_task import ExternalTaskSensor
from airflow.utils.dates import days_ago
from datetime import timedelta
import requests
import time
import logging

default_args = {
    'owner': 'data-team',
    'depends_on_past': False,
    'email_on_failure': True,
    'email_on_retry': False,
    'retries': 1,
    'retry_delay': timedelta(minutes=2),
}

dag = DAG(
    'olist_replay',
    default_args=default_args,
    description='Replay events from raw_order_data (requires init DAG completion)',
    schedule_interval=None,  # 수동 실행만
    start_date=days_ago(1),
    catchup=False,
    tags=['olist', 'replay', 'event-sourcing'],
    params={
        # 사용자가 실행 시 설정 가능한 파라미터
        'replay_name': 'default_replay',
        'customer_state': None,  # None이면 전체, 'SP'면 SP주만
        'min_payment_value': None,
        'max_payment_value': None,
        'start_date': '2017-05-01',
        'end_date': '2017-05-31',
        'speed_multiplier': 100.0,
    },
)
```

---

### 2.2 Task 1: Init DAG 완료 확인 (Sensor)

```python
# 방법 1: ExternalTaskSensor 사용
wait_for_init = ExternalTaskSensor(
    task_id='wait_for_init_dag',
    external_dag_id='olist_init_data_load',
    external_task_id='verify_load',
    allowed_states=['success'],
    failed_states=['failed', 'skipped'],
    mode='reschedule',  # poke 대신 reschedule (리소스 절약)
    timeout=600,  # 10분 대기
    poke_interval=30,  # 30초마다 체크
    dag=dag,
)
```

```python
# 방법 2: Python 함수로 직접 확인 (더 유연함) ⭐ 권장
def check_init_complete(**context):
    """
    Init DAG 완료 여부 및 데이터 존재 확인
    """
    SERVICE_A_URL = "http://service-a:8080"
    
    logging.info("Checking if init DAG has completed...")
    
    # Service A에 데이터가 있는지 확인
    try:
        response = requests.get(
            f"{SERVICE_A_URL}/api/v1/raw-data/orders/count",
            timeout=10
        )
        response.raise_for_status()
        
        data_count = response.json().get('count', 0)
        
        logging.info(f"Found {data_count} orders in raw_order_data")
        
        if data_count == 0:
            raise Exception(
                "No data found in raw_order_data table. "
                "Please run 'olist_init_data_load' DAG first."
            )
        
        # XCom에 저장
        context['ti'].xcom_push(key='available_data_count', value=data_count)
        
        logging.info(f"Init check passed: {data_count} orders available for replay")
        
    except requests.exceptions.RequestException as e:
        raise Exception(f"Failed to check init status: {e}")

check_init = PythonOperator(
    task_id='check_init_complete',
    python_callable=check_init_complete,
    dag=dag,
)
```

---

### 2.3 Task 2: Replay Job 생성 및 시작

```python
def create_and_start_replay(**context):
    """
    Service A에 Replay Job 생성 및 시작
    """
    SERVICE_A_URL = "http://service-a:8080"
    
    # DAG 파라미터 가져오기
    params = context['params']
    replay_name = params.get('replay_name', 'default_replay')
    customer_state = params.get('customer_state')
    min_payment = params.get('min_payment_value')
    max_payment = params.get('max_payment_value')
    start_date = params.get('start_date', '2017-05-01')
    end_date = params.get('end_date', '2017-05-31')
    speed_multiplier = params.get('speed_multiplier', 100.0)
    
    # Replay Job ID 생성
    from datetime import datetime
    replay_id = f"replay_{replay_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    # 필터 조건 구성
    filter_condition = {
        "startTime": f"{start_date}T00:00:00Z",
        "endTime": f"{end_date}T23:59:59Z",
    }
    
    if customer_state:
        filter_condition['customerState'] = customer_state
    if min_payment:
        filter_condition['minPaymentValue'] = float(min_payment)
    if max_payment:
        filter_condition['maxPaymentValue'] = float(max_payment)
    
    logging.info(f"Creating replay job: {replay_id}")
    logging.info(f"Filter: {filter_condition}")
    
    # 1. Replay Job 생성
    create_response = requests.post(
        f"{SERVICE_A_URL}/api/v1/replay-jobs",
        json={
            "replayJobId": replay_id,
            "sourceType": "DATABASE",
            "sourceLocation": "raw_order_data",
            "filter": filter_condition,
            "speedMultiplier": speed_multiplier,
            "eventsPerSecond": 1000
        },
        timeout=30
    )
    create_response.raise_for_status()
    
    job_info = create_response.json()
    total_events = job_info.get('totalEvents', 0)
    
    logging.info(
        f"Replay job created: {replay_id}, "
        f"totalEvents={total_events}"
    )
    
    # XCom에 저장
    context['ti'].xcom_push(key='replay_job_id', value=replay_id)
    context['ti'].xcom_push(key='total_events', value=total_events)
    
    # 2. Replay Job 시작
    start_response = requests.post(
        f"{SERVICE_A_URL}/api/v1/replay-jobs/{replay_id}/start",
        timeout=30
    )
    start_response.raise_for_status()
    
    start_info = start_response.json()
    
    logging.info(
        f"Replay job started: {replay_id}, "
        f"status={start_info.get('status')}"
    )

create_replay = PythonOperator(
    task_id='create_and_start_replay',
    python_callable=create_and_start_replay,
    dag=dag,
)
```

---

### 2.4 Task 3: Replay 진행 상황 모니터링

```python
def monitor_replay_progress(**context):
    """
    Replay Job 진행 상황 모니터링
    """
    SERVICE_A_URL = "http://service-a:8080"
    
    replay_job_id = context['ti'].xcom_pull(key='replay_job_id')
    total_events = context['ti'].xcom_pull(key='total_events')
    
    logging.info(f"Monitoring replay job: {replay_job_id}")
    
    check_interval = 10  # 10초마다 체크
    max_wait_time = 3600  # 최대 1시간 대기
    elapsed_time = 0
    
    while elapsed_time < max_wait_time:
        # Replay Job 상태 조회
        response = requests.get(
            f"{SERVICE_A_URL}/api/v1/replay-jobs/{replay_job_id}",
            timeout=10
        )
        response.raise_for_status()
        
        job_status = response.json()
        status = job_status.get('status')
        processed = job_status.get('processedEvents', 0)
        progress = job_status.get('progressPercentage', 0)
        
        logging.info(
            f"Replay progress: {processed}/{total_events} ({progress:.2f}%) - "
            f"status={status}"
        )
        
        # 완료 확인
        if status == 'COMPLETED':
            logging.info(f"Replay job completed: {replay_job_id}")
            
            # 최종 통계 저장
            context['ti'].xcom_push(key='final_status', value='COMPLETED')
            context['ti'].xcom_push(key='final_processed', value=processed)
            
            return
        
        # 실패 확인
        if status in ['FAILED', 'CANCELLED']:
            error_msg = job_status.get('errorMessage', 'Unknown error')
            raise Exception(
                f"Replay job {status}: {replay_job_id} - {error_msg}"
            )
        
        # 대기
        time.sleep(check_interval)
        elapsed_time += check_interval
    
    # 타임아웃
    raise Exception(
        f"Replay job timeout: {replay_job_id} - "
        f"processed {processed}/{total_events} in {max_wait_time}s"
    )

monitor_replay = PythonOperator(
    task_id='monitor_replay_progress',
    python_callable=monitor_replay_progress,
    dag=dag,
)
```

---

### 2.5 Task 의존성 설정

```python
# Task 흐름
check_init >> create_replay >> monitor_replay
```

---

## 3️⃣ DAG 간 의존성 및 실행 시나리오

### 3.1 첫 실행 (Init 필요)

```
시나리오 1: Init DAG 먼저 실행
┌──────────────────────────────────────────────────────┐
│  Step 1: Init DAG 실행                                │
│  $ airflow dags trigger olist_init_data_load         │
│                                                       │
│  ├─ check_data_exists                                │
│  │  └─ Service A: GET /raw-data/orders/count         │
│  │     → count = 0 (데이터 없음)                      │
│  │                                                    │
│  ├─ load_data (실행)                                 │
│  │  └─ POST /raw-data/orders/batch (1000개씩)        │
│  │     → 99,441개 적재                                │
│  │                                                    │
│  └─ verify_load                                      │
│     └─ GET /raw-data/orders/count                    │
│        → count = 99,441 ✅                            │
└──────────────────────────────────────────────────────┘
                        │
                        │ Init 완료
                        ▼
┌──────────────────────────────────────────────────────┐
│  Step 2: Replay DAG 실행                              │
│  $ airflow dags trigger olist_replay \               │
│      --conf '{"customer_state":"SP"}'                │
│                                                       │
│  ├─ check_init_complete                              │
│  │  └─ GET /raw-data/orders/count                    │
│  │     → count = 99,441 ✅                            │
│  │                                                    │
│  ├─ create_and_start_replay                          │
│  │  └─ POST /replay-jobs                             │
│  │     → filter: {customerState: "SP"}               │
│  │     → totalEvents: 23,456                         │
│  │  └─ POST /replay-jobs/{id}/start                  │
│  │                                                    │
│  └─ monitor_replay_progress                          │
│     └─ GET /replay-jobs/{id} (10초마다)              │
│        → status: RUNNING → COMPLETED ✅               │
└──────────────────────────────────────────────────────┘
```

---

### 3.2 재실행 (Init 스킵)

```
시나리오 2: 데이터가 이미 있는 경우
┌──────────────────────────────────────────────────────┐
│  Step 1: Init DAG 재실행 (실수로)                     │
│  $ airflow dags trigger olist_init_data_load         │
│                                                       │
│  ├─ check_data_exists                                │
│  │  └─ GET /raw-data/orders/count                    │
│  │     → count = 99,441 (이미 존재)                   │
│  │                                                    │
│  ├─ skip_load (실행) ⭐                               │
│  │  └─ 데이터 적재 건너뛰기                           │
│  │                                                    │
│  └─ verify_load                                      │
│     └─ init_status = 'ALREADY_LOADED' ✅             │
└──────────────────────────────────────────────────────┘
                        │
                        │ 바로 Replay 가능
                        ▼
┌──────────────────────────────────────────────────────┐
│  Step 2: Replay DAG 실행 (여러 번 가능)               │
│                                                       │
│  실행 1: 전체 리플레이                                │
│  $ airflow dags trigger olist_replay                 │
│                                                       │
│  실행 2: SP주만 리플레이                              │
│  $ airflow dags trigger olist_replay \               │
│      --conf '{"customer_state":"SP"}'                │
│                                                       │
│  실행 3: 고액 주문만 리플레이                         │
│  $ airflow dags trigger olist_replay \               │
│      --conf '{"min_payment_value":500.0}'            │
└──────────────────────────────────────────────────────┘
```

---

### 3.3 Init 없이 Replay 시도 (실패)

```
시나리오 3: Init 없이 Replay 시도
┌──────────────────────────────────────────────────────┐
│  Step 1: Replay DAG 실행 (Init 안 함)                 │
│  $ airflow dags trigger olist_replay                 │
│                                                       │
│  ├─ check_init_complete                              │
│  │  └─ GET /raw-data/orders/count                    │
│  │     → count = 0 ❌                                 │
│  │                                                    │
│  └─ Exception 발생:                                  │
│     "No data found in raw_order_data table.          │
│      Please run 'olist_init_data_load' DAG first."   │
│                                                       │
│  → DAG 실패 (빨간색)                                  │
└──────────────────────────────────────────────────────┘
```

---

## 4️⃣ Airflow UI에서 실행 방법

### 4.1 Init DAG 실행 (최초 1회)

```
1. Airflow UI 접속
   http://localhost:8080

2. DAGs 목록에서 'olist_init_data_load' 찾기

3. 오른쪽 "Trigger DAG" 버튼 클릭

4. 진행 상황 확인
   - check_data_exists: 녹색 (데이터 없음 확인)
   - load_data: 녹색 (적재 완료)
   - verify_load: 녹색 (검증 완료)

5. 완료! (약 10-30분 소요)
```

---

### 4.2 Replay DAG 실행 (여러 번 가능)

```
1. DAGs 목록에서 'olist_replay' 찾기

2. "Trigger DAG w/ config" 버튼 클릭

3. JSON 설정 입력:
   {
     "replay_name": "sp_may_2017",
     "customer_state": "SP",
     "min_payment_value": 100.0,
     "start_date": "2017-05-01",
     "end_date": "2017-05-31",
     "speed_multiplier": 100.0
   }

4. "Trigger" 클릭

5. 진행 상황 확인
   - check_init_complete: 녹색 (Init 완료 확인)
   - create_and_start_replay: 녹색 (Job 생성/시작)
   - monitor_replay_progress: 실행 중 (10초마다 진행률 로그)

6. 완료! (약 5-60분, 데이터 양에 따라)
```

---

## 5️⃣ 이벤트 흐름 확인 방법

### 5.1 Airflow 로그로 확인

```
Task: monitor_replay_progress 로그

[2026-01-24 10:30:00] INFO - Replay progress: 1000/23456 (4.26%) - status=RUNNING
[2026-01-24 10:30:10] INFO - Replay progress: 2000/23456 (8.53%) - status=RUNNING
[2026-01-24 10:30:20] INFO - Replay progress: 3000/23456 (12.79%) - status=RUNNING
...
[2026-01-24 10:45:30] INFO - Replay progress: 23456/23456 (100.00%) - status=COMPLETED
[2026-01-24 10:45:30] INFO - Replay job completed: replay_sp_may_2017_20260124_103000
```

---

### 5.2 Service A API로 확인

```bash
# Replay Job 상태 조회
curl http://localhost:8080/api/v1/replay-jobs/replay_sp_may_2017_20260124_103000

{
  "replayJobId": "replay_sp_may_2017_20260124_103000",
  "sourceType": "DATABASE",
  "status": "RUNNING",
  "processedEvents": 5000,
  "totalEvents": 23456,
  "progressPercentage": 21.32,
  "startedAt": "2026-01-24T10:30:05Z",
  "lastProcessedAt": "2026-01-24T10:35:10Z"
}
```

---

### 5.3 Kafka로 확인 (실시간 이벤트 흐름)

```bash
# Kafka Consumer로 raw_events 토픽 구독
kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic raw_events \
  --from-beginning

# 출력 예시
{"eventId":"uuid-001","eventType":"OrderPlaced","aggregateId":"order_abc123",...}
{"eventId":"uuid-002","eventType":"OrderPlaced","aggregateId":"order_abc124",...}
{"eventId":"uuid-003","eventType":"OrderPlaced","aggregateId":"order_abc125",...}
...
```

---

### 5.4 Grafana 대시보드로 확인

```
대시보드: "Replay Progress"

패널 1: 실시간 이벤트 처리 속도 (events/sec)
패널 2: 누적 이벤트 수
패널 3: Replay Job 상태 (RUNNING/COMPLETED)
패널 4: 서비스별 처리 지연 (lag)
```

---

## 6️⃣ 멱등성 보장

### 6.1 Init DAG 멱등성

```
1차 실행:
- check_data_exists → count = 0
- load_data 실행 → 99,441개 적재
- verify_load → ✅

2차 실행:
- check_data_exists → count = 99,441
- skip_load 실행 → 적재 건너뛰기 ⭐
- verify_load → ALREADY_LOADED ✅

결과: 중복 적재 방지
```

---

### 6.2 Replay DAG 멱등성

```
같은 조건으로 여러 번 실행:

1차 실행:
- replay_id: replay_sp_may_2017_20260124_103000
- totalEvents: 23,456
- 결과: 23,456개 이벤트 생성

2차 실행:
- replay_id: replay_sp_may_2017_20260124_104500 (새 ID)
- totalEvents: 23,456
- 결과: 23,456개 이벤트 생성 (중복 허용)

이유: 
- 시나리오 비교를 위해 같은 데이터 여러 번 리플레이 가능
- Service B의 processed_events 테이블이 중복 처리 방지
```

---

## 7️⃣ Service A 추가 API

### API: 데이터 개수 조회

```
GET /api/v1/raw-data/orders/count

Response:
{
  "count": 99441,
  "lastUpdated": "2026-01-24T10:30:00Z",
  "sourceFiles": [
    "olist_orders_dataset.csv"
  ]
}

Service A 구현:
SELECT COUNT(*) as count,
       MAX(created_at) as last_updated
FROM raw_order_data;
```

---

## ✅ 요약

### Init DAG (한 번만 실행)
```
목적: CSV → DB 적재
실행: 수동 (최초 1회)
멱등성: ✅ (데이터 있으면 스킵)
소요 시간: 10-30분
결과: raw_order_data 테이블에 99,441개
```

### Replay DAG (여러 번 실행 가능)
```
목적: DB → 이벤트 생성 → Kafka 발행
실행: 수동 (필요할 때마다)
의존성: Init DAG 완료 필수
파라미터: customer_state, payment_value 등
소요 시간: 5-60분 (데이터 양에 따라)
결과: events 테이블 + Kafka raw_events
```

### 이벤트 흐름 확인
```
1. Airflow 로그 (진행률)
2. Service A API (상태 조회)
3. Kafka Consumer (실시간 이벤트)
4. Grafana 대시보드 (시각화)
```

---

**이제 체계적인 데이터 준비 및 리플레이 시스템이 완성되었습니다!** 🎯

Init DAG가 데이터 존재를 보장하고, Replay DAG가 안전하게 리플레이를 실행합니다!
