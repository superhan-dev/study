# 작성일

- 2025-12-11

# 1. 랜처 운영 설치 및 기록

1. cert-manager 설치
2.

# 2. cert-manager

cert-manager는 클러스터 내에서 SSL 인증서를 자동 발급/갱신해주는 컨트롤러인데,
이를 위해 아래와 같은 "새로운 리소스 타입"이 필요하다.

- Certificate
- Issuer
- ClusterIssuer
- CertificateRequest
- Order
- Challenge

이런 것들은 Kubernetes 기본 리소스가 아니라서
cert-manager가 동작하려면 먼저 **이 리소스 타입들을 Kubernetes에 등록(CRD 설치)**해야 한다.

그래야 예를 들어 Rancher가 설치될 때 다음과 같은 yaml을 만들 수 있다.

```yaml
apiVersion: cert-manager.io/v1
kind: Issuer
metadata:
  name: rancher-selfsigned-issuer
```

만약 CRD가 없으면 에러를 발생시킨다.

```
no matches for kind "Issuer" in version "cert-manager.io/v1"
```

## 2.1. CRD(Custom Resource Definition)

쿠버네티스는 기본적으로 다음과 같은 리소스를 제공한다.

- Deployment
- Pod
- Service
- Ingress
- ConfigMap
- Secret
- StatefulSet
- DaemonSet

하지만 운영의 편의를 위해 추가적인 툴을 확장할 수 있는 기능도 제공하는데 이를 위해 CRD(Custom Resource Definition)가 필요하다.

- MySQLCluster
- KafkaTopic
- Certificate
- Issuer
- ClusterIssuer

처럼 Kubernetes 기본에는 없는 리소스를,
CRD를 설치하면 바로 새로운 쿠버네티스 리소스처럼 쓸 수 있다.

## 2.2. cert-manager

## 설치 방법

```
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.3/cert-manager.crds.yaml
kubectl create namespace cert-manager
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --version v1.13.3

  NAME: cert-manager
LAST DEPLOYED: Thu Dec 11 14:34:21 2025
NAMESPACE: cert-manager
STATUS: deployed
REVISION: 1
DESCRIPTION: Install complete
TEST SUITE: None
NOTES:
cert-manager v1.13.3 has been deployed successfully!

In order to begin issuing certificates, you will need to set up a ClusterIssuer
or Issuer resource (for example, by creating a 'letsencrypt-staging' issuer).

More information on the different types of issuers and how to configure them
can be found in our documentation:

https://cert-manager.io/docs/configuration/

For information on how to configure cert-manager to automatically provision
Certificates for Ingress resources, take a look at the `ingress-shim`
documentation:

https://cert-manager.io/docs/usage/ingress/
```

위 명령어들을 실행하면 cert-manager가 설치되고 랜처를 실행할 수 있게 된다.

# 3. Rancher 설치

## 3.1. namespace 생성

랜처환경이 설치될 네임스페이스를 먼저 생성한다.

```bash
kubectl create namespace cattle-system
```

## 3.2. install rancher

```bash
helm install rancher rancher-latest/rancher \
  --namespace cattle-system \
  --set hostname=rancher.localhost \
  --set replicas=1

level=WARN msg="unable to find exact version; falling back to closest available version" chart=rancher requested="" selected=2.13.0
NAME: rancher
LAST DEPLOYED: Thu Dec 11 14:37:23 2025
NAMESPACE: cattle-system
STATUS: deployed
REVISION: 1
DESCRIPTION: Install complete
TEST SUITE: None
NOTES:
Rancher Server has been installed. Rancher may take several minutes to fully initialize.

Please standby while Certificates are being issued, Containers are started and the Ingress rule comes up.

Check out our docs at https://rancher.com/docs/

## First Time Login

If you provided your own bootstrap password during installation, browse to https://rancher.localhost to get started.
If this is the first time you installed Rancher, get started by running this command and clicking the URL it generates:

echo https://rancher.localhost/dashboard/?setup=$(kubectl get secret --namespace cattle-system bootstrap-secret -o go-template='{{.data.bootstrapPassword|base64decode}}')

To get just the bootstrap password on its own, run:

kubectl get secret --namespace cattle-system bootstrap-secret -o go-template='{{.data.bootstrapPassword|base64decode}}{{ "\n" }}'

Happy Containering!
```

위와 같은 로고를 본다면 성공적으로 랜처가 설치된 것이다.

랜처 초기 패스워드를 설정하고 포트포워딩을 해서 웹서버를 통해 접속하게되면 배포된 pod들을 볼 수있게 된다.
