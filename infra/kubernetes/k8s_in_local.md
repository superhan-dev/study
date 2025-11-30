# k8s in local

그라파나와 프로메테우스 + Loki로 모니터링 테스트해보기 위한 첫번째 과정인 로컬 설치를 정리한다.

# 진행 순서

1. 로컬 K8s 클러스터 생성 (kind)
2. kubectl이 로컬 클러스터를 바라보게 설정
3. 간단한 앱(Nginx or NestJS) 배포해서 K8s 감 익히기
4. Helm 설치 → Redis / Prometheus / Grafana 올리기
5. NestJS에 /metrics + pino 로그 붙이고, 메트릭/로그 가시화 연습
6. Rancher를 로컬 클러스터에 올려서 UI로도 만져보기

## 1. kind 설치

1. Docker Desktop 설치 & 실행
   - Docker 컨테이너 실행 가능한 상태까지 확인
2. kubectl 설치
   - 이미 있다면 패스

```bash
brew install kubernetes-cli
kubectl version --client=true
```

3. kind 설치
   - kind는 kubernetes in desktop의 약자로 로컬에 k8s를 설치하는 소프트웨어다.

```bash
brew install kind
```

---

## 2. 로컬 K8s 클러스터 만들기 + 연결

클러스터를 생성하면 로컬 환경에 control-plane이 하나 생성된다.

1. kind 클러스터 생성

```bash
kind create cluster --name local-dev
```

2. kubectl 컨텍스트 확인 & 전환

```bash
kubectl config get-contexts
kubectl config use-context kind-local-dev
```

3. 클러스터 동작 확인

```bash
kubectl get nodes
kubectl get pods -A
```

---

## 3. 기본 앱 배포로 K8s 감 잡기

1. Nginx Deployment 생성

```bash
kubectl create deployment nginx --image=nginx
```

2. Service(NodePort or port-forward)로 노출

```bash
kubectl expose deployment nginx --type=NodePort --port=80

# service/nginx exposed 가 뜨는데 제대로 동작하지 않음
```

다음 명령어로 서비스에 매핑을 해주니 정상 동작함.

```bash
kubectl port-forward svc/nginx 8080:80

# port forward를 시키니 정상 동작함.
# Forwarding from 127.0.0.1:8080 -> 80
# Forwarding from [::1]:8080 -> 80
# Handling connection for 8080
```

3. 브라우저에서 http://localhost:8080 접속 → 페이지 뜨는지 확인
   - 여기까지 되면 “로컬 K8s에 앱 올리고 접근하는 기본”은 성공.

---

## 4. Helm + 모니터링 스택 (Redis / Prometheus / Grafana)

1. Helm 설치 확인

```bash
brew install helm
helm version
```

2. Redis 설치 (테스트용)

   - bitnami/redis chart 사용

3. Prometheus + Grafana 설치

   - prometheus-community/kube-prometheus-stack 사용

4. Grafana port-forward 해서 웹 접속 → Redis 메트릭 보이는지 확인

### Helm이란?

Helm은 쿠버네티스 패키지 매니저이다.

---

## 5. NestJS 서비스 + 메트릭/로그 연동

1. NestJS 앱을 Docker 이미지로 빌드
2. kind 클러스터에 Deployment + Service로 배포
3. 앱에 @willsoto/nestjs-prometheus로 /metrics 붙이기
4. pino(JSON 로그)로 stdout 로깅 구성
5. (원하면) Loki까지 붙여서 로그 + 메트릭 + 대시보드 삼종세트 실습

---

## 6. Rancher 로컬에서 먼저 맛보기

1. 같은 kind 클러스터에 Rancher 설치
2. port-forward로 Rancher UI 접속
3. 워크로드/네임스페이스/RBAC 등 UI로 조작해보기
4. 나중에 NKS에도 같은 방식으로 올릴지 판단

---

# 여기부터 재시작

## prometheus-community/kube-prometheus-stack 설치 및 프로메테우스 실습

**Prometheus + Alertmanager + Grafana + 각종 Exporter + CRD(ServiceMonitor 등)**을 한번에 설치할 수 있는 스택이다.

## 설치 과정 정리

1. 전제 조건

- 클러스터에 이미 연결돼 있다고 가정

```bash
kubectl get nodes
```

- 정상적으로 노드가 보이면 준비 완료.

- Helm 설치 확인

```bash
helm version
```

2. Helm repo 추가

helm은 cli로 쿠버네티스 패키지를 관리할 수 있도록 도와주는 프로그램이다. 저장소를 등록하면 클라우드 저장소가 helm 레포지토리로 저장된다.

**prometheus-community 저장소 등록**

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
```

3. 네임스페이스 만들기

모니터링용 네임스페이스 하나 분리하는게 관리하기 편하므로 다음과 같이 네임스페이스를 생성한다.

```bash
kubectl create namespace monitoring
```

4. kube-prometheus-stack 설치 (기본)

설치 명령어 및 실행 로그

로그인 id는 admin이고 초기 패스워드는 Get Grafana 'admin' user password by running 로그에 따라 명령어를 실행해보면 터미널을 통해 확인할 수 있고 로그인시 사용할 수 있는 해시값이 나온다.

```bash
helm install monitoring prometheus-community/kube-prometheus-stack \
 -n monitoring

level=WARN msg="unable to find exact version; falling back to closest available version" chart=kube-prometheus-stack requested="" selected=79.8.2
I1128 11:54:06.922805    3449 warnings.go:110] "Warning: unrecognized format \"int64\""
I1128 11:54:06.922819    3449 warnings.go:110] "Warning: unrecognized format \"int32\""
...
I1128 11:54:14.746787    3449 warnings.go:110] "Warning: spec.SessionAffinity is ignored for headless services"
...
NAME: monitoring
LAST DEPLOYED: Fri Nov 28 11:54:07 2025
NAMESPACE: monitoring
STATUS: deployed
REVISION: 1
DESCRIPTION: Install complete
NOTES:
kube-prometheus-stack has been installed. Check its status by running:
  kubectl --namespace monitoring get pods -l "release=monitoring"

Get Grafana 'admin' user password by running:

  kubectl --namespace monitoring get secrets monitoring-grafana -o jsonpath="{.data.admin-password}" | base64 -d ; echo

Access Grafana local instance:

  export POD_NAME=$(kubectl --namespace monitoring get pod -l "app.kubernetes.io/name=grafana,app.kubernetes.io/instance=monitoring" -oname)
  kubectl --namespace monitoring port-forward $POD_NAME 3000

Get your grafana admin user password by running:

  kubectl get secret --namespace monitoring -l app.kubernetes.io/component=admin-secret -o jsonpath="{.items[0].data.admin-password}" | base64 --decode ; echo

```

**체크 리스트**

- monitoring = Helm 릴리스 이름
- -n monitoring = 아까 만든 네임스페이스에 설치
- 설치 상태 확인
  - 여러개의 pod들이 생성됨을 확인 할 수 있다.

```
kubectl --namespace monitoring get pods -l "release=monitoring"
NAME                                                   READY   STATUS    RESTARTS   AGE
monitoring-kube-prometheus-operator-68f6858fb5-xfqp6   1/1     Running   0          8m19s
monitoring-kube-state-metrics-5bd8b6b9cd-qxtcj         1/1     Running   0          8m19s
monitoring-prometheus-node-exporter-8t9h8              1/1     Running   0          8m19s
```

5. Grafana 접속해 보기 (port-forward)

- 외부 Ingress/LB 붙이기 전에, 먼저 로컬에서 붙어 확인할 수 있다.
- 서비스 확인

```
kubectl get svc -n monitoring | grep grafana

monitoring-grafana ClusterIP 10.x.x.x 80/TCP
```

- 포트포워딩
  - 실제 접속을 하기위해 다음과 같이 포트포워딩할 수 있다.

```
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
```

- 포트 포워딩 이후 접속 테스트

  - http://localhost:3000

- 기본 로그인 정보는 보통

```
ID: admin
PW: Helm values에 따라 다르지만, 안 바꿨다면 prom-operator 또는 secret에서 확인 필요

비밀번호 모르면:

kubectl get secret -n monitoring \
 $(kubectl get secret -n monitoring | grep grafana | awk '{print $1}') \
 -o jsonpath="{.data.admin-password}" | base64 --decode; echo
```

---

6. 설치 시 커스터마이징 (values.yaml 사용)

- 실서비스에 가까워질수록 Grafana admin 비밀번호, PersistentVolume 사용 여부, Prometheus retention 기간, 수집 대상(네임스페이스/ServiceMonitor 설정) config 설정 필요

6-1. 기본 values 템플릿 가져오기
helm show values prometheus-community/kube-prometheus-stack > kube-prometheus-values.yaml

이 파일을 열어서 필요한 부분만 수정한 뒤:

6-2. 커스텀 values로 설치
helm install monitoring prometheus-community/kube-prometheus-stack \
 -n monitoring \
 -f kube-prometheus-values.yaml

이미 설치한 상태에서 수정하려면:

helm upgrade monitoring prometheus-community/kube-prometheus-stack \
 -n monitoring \
 -f kube-prometheus-values.yaml

7. Redis / NestJS 메트릭 붙일 때 연결 포인트

이 스택을 깔아두면 Prometheus Operator + CRD(ServiceMonitor, PodMonitor) 가 설치됨

7.1. Redis 메트릭을 Helm으로 설치

이후 Redis 같은 걸 Helm으로 깔 때:

```
helm install my-redis bitnami/redis \
 -n redis \
 --set metrics.enabled=true \
 --set metrics.serviceMonitor.enabled=true
```

이렇게 하면 ServiceMonitor가 자동 생성되고,

kube-prometheus-stack의 Prometheus가 그걸 자동으로 스크랩해 줌.

NestJS도:

/metrics 노출

그걸 대상으로 하는 Service + ServiceMonitor만 만들면
바로 이 Prometheus에서 긁어서 Grafana에서 볼 수 있어.

8. 삭제하고 싶을 때

테스트용 클러스터에서 다 지우고 싶으면:

helm uninstall monitoring -n monitoring
kubectl delete namespace monitoring

(네임스페이스 삭제는 리소스 많으면 좀 시간 걸릴 수 있음)

정리하면, 설치 최소 경로는 딱 네 줄이야:

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
kubectl create namespace monitoring
helm install monitoring prometheus-community/kube-prometheus-stack -n monitoring

그 다음에
kubectl get pods -n monitoring → port-forward → Grafana 접속 순서로 확인하면 된다.
