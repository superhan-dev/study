# Kafka 개념 정리 및 학습 개요

Kafka ^4.0 부터는 zookeeper가 필요하지 않고 KRaft 되었지만 아직까지 zookeeper를 사용하는 환경이 분명 존재할 것이고 두가지 버전을 모두 학습할 필요가 있어 두가지 버전 모두 공부하면서 정리해보기로 한다.

# Zookeeper의 역할 및 Kafka cluster 상관관계

주키퍼를 설치하는 궁극적인 이유는 주키퍼 앙상블 이라고 하는 기능을 통해 카프카 클러스터의 컨트롤러와 주키퍼가 통신을 통해 리더 선출과 그 정보를 기록하는데 있다.

카프카 브로커중 리더로 선출된 브로커가 컨트롤러를 통해 외부와 통신하면서 메세지를 쌓고 나머지 레플리카 들에게 메세지를 전달하는 방식으로 동작한다.

이때 주키퍼 앙상블이 리더로 선출된 브로커의 정보와 컨트롤러의 정보를 관리하고 만약 리더에 문제가 생기면 리더를 재 선출 하는 등의 역할에 관여하며 관리를 하도록 구성 되어 있었다.
때문에 주키퍼를 사용할 때는 클러스터에 반드시 1개의 컨트롤러가 생성되고 리더가 이를 가지고 있는 상태였다.

# KRaft

주키퍼와 의존성을 제거한 후 카프카 클러스터 내부에서 여러개의 컨트롤러를 가지고 있도록 하고 리더의 컨트롤러만 활성화 하는 방식으로 구성을하여 이전 보다 독립적인 구조로 카프카를 유지할 수 있게 되었다.
또한 주키퍼 인스턴스를 생성하고 관리하는 포인트를 줄여 확장에 용이하게 구조를 변경한 것이라고 볼 수 있다.

# 도커를 활용한 카프카 설치 및 테스트

## docker-compose.yml 작성

먼저 주키퍼와 카프카를 모두 설치하기 위해 이전에 사용했던 이미지 셋인 `wurstmeister/*`을 이용하여 docker-compose.yml을 작성했다.

```yml
version: "3.1"

services:
  zookeeper:
    image: wurstmeister/zookeeper
    container_name: zookeeper
    ports:
      - "2181:2181"
  kafka:
    image: wurstmeister/kafka
    container_name: kafka
    ports:
      - "9092:9092"
    environment:
      KAFKA_ADVERTISED_HOST_NAME: 127.0.0.1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
```

## 도커 컴포즈 명령어 실행

다음 명령어를 통해서 docker compose를 실행 후 이미지들을 다운로드 후 프로세스에 띄운 것을 볼 수 있다.

```bash
% docker compose -f docker-compose.yml up -d
```

명령어 실행 후 다음과 같이 ps 명령어를 통해 실행중인 카프카와 주키퍼를 확인할 수 있다.

```bash
% docker ps
CONTAINER ID   IMAGE                    COMMAND                   CREATED         STATUS         PORTS                                         NAMES
2dfb05ad16be   wurstmeister/kafka       "start-kafka.sh"          3 minutes ago   Up 3 minutes   0.0.0.0:9092->9092/tcp, [::]:9092->9092/tcp   kafka
4e35e741a411   wurstmeister/zookeeper   "/bin/sh -c '/usr/sb…"   3 minutes ago   Up 3 minutes   0.0.0.0:2181->2181/tcp, [::]:2181->2181/tcp   zookeeper

```

## 이미지 들여다보기

이미지에 접속해서 들여다보면 로컬에서 다운로드 후 카프카를 실행할 때와 같은 bin 파일이 존재하는 것을 확인할 수 있다.

```bash
% docker exec -it kafka /bin/sh

# cd opt/kafka_2.13-2.8.1/bin
# ls

connect-distributed.sh	      kafka-dump-log.sh			   kafka-storage.sh
connect-mirror-maker.sh       kafka-features.sh			   kafka-streams-application-reset.sh
connect-standalone.sh	      kafka-leader-election.sh		   kafka-topics.sh
kafka-acls.sh		      kafka-log-dirs.sh			   kafka-verifiable-consumer.sh
kafka-broker-api-versions.sh  kafka-metadata-shell.sh		   kafka-verifiable-producer.sh
kafka-cluster.sh	      kafka-mirror-maker.sh		   trogdor.sh
kafka-configs.sh	      kafka-preferred-replica-election.sh  windows
kafka-console-consumer.sh     kafka-producer-perf-test.sh	   zookeeper-security-migration.sh
kafka-console-producer.sh     kafka-reassign-partitions.sh	   zookeeper-server-start.sh
kafka-consumer-groups.sh      kafka-replica-verification.sh	   zookeeper-server-stop.sh
kafka-consumer-perf-test.sh   kafka-run-class.sh		   zookeeper-shell.sh
kafka-delegation-tokens.sh    kafka-server-start.sh
kafka-delete-records.sh       kafka-server-stop.sh

```

## kafka 실행 후 메세지 생성

다음 명령어를 사용해 `quickstart` 라는 토픽을 생성하고 메세지를 생성 해 보자.

```bash
# kafka-topics.sh --create --zookeeper zookeeper:2181 --replication-factor 1 --partitions 1 --topic quickstart
```

생성 후 메세지를 보내보면 offset explorer 를 통해 생성된 메세지들을 모니터링 할 수 있다.

```bash
# kafka-console-producer.sh --topic quickstart --bootstrap-server localhost:9092
>Hello
>docker kafka!

```

### 생성된 토픽 메세지

토픽에 메세지 생성 후 offset_explorer를 사용해 모니터링
`Hello`와 `docker kafka!` 가 생성된 것을 확인할 수 있다.

![생성된 토픽 메세지](../images/kafka/offset_explorer_001_1.png)

## 메세지 컨슈밍 해보기

다음 명령어를 입력하면 현재 까지 작성된 메세지를 오프셋을 계산 후 컨슈밍해서 화면에 출력해주는 것을 볼 수 있다.

```bash
# kafka-console-consumer.sh --topic quickstart --from-beginning --bootstrap-server localhost:9092

Hello
docker kafka!

```

# 참조 링크

- [Apache Kafka Crash Course With Spring Boot 3.0.x | ‪@Javatechie‬](https://www.youtube.com/watch?v=c7LPlWvxZcQ)
