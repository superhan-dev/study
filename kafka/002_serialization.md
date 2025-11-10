# 작성일

- 2025-11-09

# Spring Kafka Serialize 이슈

카프카-스프링 환경에서 흔히 만나는 직렬화 이슈를 정리한다.

- spring.kafka.consumer.key-serializer 바인딩 에러

---

## 컨슈머 설정에서 가장 흔한 실수: serializer vs deserializer

카프카에서 `Producer`는 메세지를 serialization해서 브로커로 보낸다. 브로커에 있는 메세지들은 모두 serialized 되어 저장된 상태로 큐에서 머문다. `Consumer`는 브로커로 부터 메세지를 구독해서 deserialization을 한다.

때문에 yaml 설정시 다음과 같이 설정한다.

- 프로듀서는 key-serializer/value-serializer,
- 컨슈머는 key-deserializer/value-deserializer.

> `org.springframework.kafka`와 `org.apache.kafka.common` 과 같은 설정도 쉽게 헷갈리는 부분이다.
> `org.apache.kafka.*`는 저수준의 표준 클라이언트이고 `org.springframework.kafka.*`는 스프링 통합 + 편의/운영 기능(고수준) 클라이언트 이다.

### consumer's properties.yml

```yaml
spring:
  kafka:
    bootstrap-servers: localhost:9092
    consumer:
      group-id: kafkaconsuemerdemo
      auto-offset-reset: earliest
      enable-auto-commit: false
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      # 역직렬화 에러를 핸들러로 넘기고 싶다면 ErrorHandlingDeserializer 권장
      value-deserializer: org.springframework.kafka.support.serializer.ErrorHandlingDeserializer
      properties:
        # 실제 JSON 역직렬화는 delegate가 수행
        spring.deserializer.value.delegate.class: org.springframework.kafka.support.serializer.JsonDeserializer

        # JSON → DTO 맵핑을 안전하게(프로듀서가 타입 헤더를 안 붙여도 OK)
        spring.json.use.type.headers: false
        spring.json.value.default.type: org.olimplanet.kafkaconsumerdemo.controller.dto.CustomerDto

        # 역직렬화 허용 패키지(보안)
        spring.json.trusted.packages: org.olimplanet.kafkaconsumerdemo.controller.dto
```

### producer's properties.yml

```yaml
spring.kafka.producer.key-serializer=org.apache.kafka.common.serialization.StringSerializer
spring.kafka.producer.value-serializer=org.springframework.kafka.support.serializer.JsonSerializer
spring.kafka.producer.properties.spring.json.add.type.headers=false
```

# Java Bean을 통한 config

## KafkaProducerConfig

```java
package org.olimplanet.kafkademo.config;

import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.core.ProducerFactory;
import org.springframework.kafka.support.serializer.JsonSerializer;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class KafkaProducerConfig {
    @Bean
    public NewTopic createTopic() {
        return new NewTopic("test-topic-1", 3, (short) 1);
    }

    @Bean
    public NewTopic createTopic2() {
        return new NewTopic("customer-topic-1", 3, (short) 1);
    }

    // config를 작성하고
    @Bean
    public Map<String, Object> producerConfigs() {
        Map<String, Object> props = new HashMap<>();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG,"localhost:9092");
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, JsonSerializer.class);

        return props;
    }

    // 팩토리로 내보내고
    @Bean
    public ProducerFactory<String, Object> producerFactory(){
        return new DefaultKafkaProducerFactory<>(producerConfigs());
    }

    // KafkaTemplate으로 내보낼 수 있다.
    @Bean
    public KafkaTemplate<String, Object> kafkaTemplate(){
        return new KafkaTemplate<>(producerFactory());
    }
}


```

## KafkaConsumerConfiguration

```java
package org.olimplanet.kafkaconsumerdemo.config;

import java.util.HashMap;
import java.util.Map;

import org.apache.kafka.clients.consumer.Consumer;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.olimplanet.kafkaconsumerdemo.controller.dto.CustomerDto;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.EnableKafka;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.config.KafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.kafka.listener.ConcurrentMessageListenerContainer;
import org.springframework.kafka.support.serializer.JsonDeserializer;

@Configuration
@EnableKafka
public class KafkaConsumerConfiguration {

    @Bean
    public Map<String, Object> consumerConfig() {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
        props.put(ConsumerConfig.GROUP_ID_CONFIG, "customer-listener");
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, JsonDeserializer.class);
        props.put(
                JsonDeserializer.TRUSTED_PACKAGES,
                "org.olimplanet.kafkaconsumerdemo.controller.dto,org.olimplanet.kafkademo.controller.dto");
        props.put(JsonDeserializer.TYPE_MAPPINGS,
                "customerDto:org.olimplanet.kafkaconsumerdemo.controller.dto.CustomerDto");
        props.put(JsonDeserializer.USE_TYPE_INFO_HEADERS, false);
        props.put(JsonDeserializer.VALUE_DEFAULT_TYPE, CustomerDto.class.getName());
        return props;
    }

    @Bean
    public ConsumerFactory<String, Object> consumerFactory() {
        return new DefaultKafkaConsumerFactory<>(consumerConfig());
    }

    @Bean
    public KafkaListenerContainerFactory<ConcurrentMessageListenerContainer<String, Object>> kafkaListenerContainerFactory() {
         ConcurrentKafkaListenerContainerFactory<String, Object> factory = new ConcurrentKafkaListenerContainerFactory<>();
         factory.setConsumerFactory(consumerFactory());
         return factory;
    }
}



```

## consumer properties 설정 문제

카프카는 데이터를 deserialize 할때 신뢰할 수 있는 타입으로 제한하는 화이트리스트를 제공한다. 이때 사용하는 옵션이 `spring.json.trusted.packages`옵션이다.

# 관련 키워드

- KafkaTemplate
  - 개념 정리 필요
- Lag
  - 재시도 없이 컨테이너에 문제가 생겼을 때 카운트 되는 에러 플래그
- DLQ(Dead Letter Queue)
  - 처리 실패한 메시지를 따로 보관하는 토픽
    - Spring Kafka 기본 recoverer는 <원토픽>.DLT로 보낸다(예: orders → orders.DLT).
  - DLQ에 들어간 메시지는
    - 나중에 수동/반자동 재처리하거나
    - 원인 분석(스키마 문제, 외부 API 장애, “독성 메시지” 등)에 쓰입니다.

> DLQ는 최종 격리 장소다. “잠시 뒤에 다시 시도”가 목적이면 Retry 토픽(지연/백오프 전용)을 따로 두는 게 더 적절할 수 있다.
