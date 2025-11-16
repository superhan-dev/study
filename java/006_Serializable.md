# 자바 직렬화

String API 에서 implements 하고있는 인터페이스로 serializable 인터페이스가 있다. **"이 객체가 직렬화가 가능한 대상이다."** 라는 뜻으로 사용된다.

## 직렬화가 뭐에요?

직렬화(Serialize)란 자바 언어에서 사용되는 Object 또는 데이터를 시스템에서 사용할 수 있도록 바이트 스트림 형태로 변환하는 포맷 변환 기술을 의미한다.

> 바이트 스트림이란?
> 데이터를 1byte(8bit) 단위로 흘려보내는 I/O 방식을 의미한다. Stream이란 연속적인 데이터의 흐름을 의미한다.

## 역직렬화는 뭐에요?

역직렬화(Deserialize) 바이트로 변환된 데이터를 원래 자바 시스템의 Object 또는 Data로 변환하는 기술이다.

---

## String 에서 Serialize를 사용한 이유

String 은 모든 객체 그래프에 섞여있는 객체이기 때문이다. 즉 윗물에서부터 직렬화가 가능한 객체여야 하기때문에 라고 이해하면 좋을 듯하다.

---

# 직렬화 방법 (ObjectOutputStream)

직접 한번 직렬화하고 파일을 만들어보자.

## 소스코드

Student 객체를 정의하고 toString을 Override하여 어떤 String으로 내보낼지 재정의한다.

```java
package org.example;

import java.io.Serializable;

public final class Student implements Serializable {
    int id;
    String name;

    public Student(int id, String name) {
        this.id = id;
        this.name = name;
    }

    @Override()
    public String toString(){
        return "Student{" +
                "id=" + id + '\'' +
                ", name='" + name + '\'' +
                "}";
    }
}
```

`FileOutputStream`을 생성해서 어떤 파일로 Stream이 저장될지 설정한 후에 `ObjectOutputStream`으로 Student 인스턴스를 write 파라미터로 메세지를 전달 하면 student.ser 파일이 생성된다.

```java
package org.example;

import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
      Student student = new Student(1, "Han");

      try(
          FileOutputStream fos = new FileOutputStream("student.ser");
          ObjectOutputStream out = new ObjectOutputStream(fos)
        )
      {
          out.writeObject(student);
      } catch (Exception e) {
          e.printStackTrace();
      }
    }
}
```

## 직렬화된 student.ser

직렬화가 완료되면 다음과 같이 Bytecode로 직렬화가 된 것을 확인할 수 있다.

![직렬화된 바이트코드 예시](../images/java/serialized-byte-code-image.png)

---

# 역직렬화 (ObjectInputStream)

## 역직렬화 테스트

다음과 같이 ObjectInputStream을 사용하여 파일을 읽어 역직렬화를 시도했다. 하지만 에러가 발생하게 되었다.

```java
package org.example;

import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        String filename = "student.ser";

        try(
            FileInputStream fis = new FileInputStream(filename);
            ObjectInputStream objectInputStream = new ObjectInputStream(fis);
        ) {
            Student student = (Student) objectInputStream.readObject();
            System.out.println(student);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```

## 역직렬화 트러블 슈팅

역직렬화를 시도하니 다음과 같은 이슈가 발생하고 serialVersionUID 이 다르다는 이슈를 내뱉고 있었다.
serializable을 상속받은 객체는 직렬화시 직렬화 버전을 관리하여 객체의 무결성을 확인하는데 Student에 버전을 따로 설정해 주지 않아 발생한 이슈였다.

```text
Caused by: java.io.InvalidClassException: org.example.Student; local class incompatible: stream classdesc serialVersionUID = 1636962972112701215, local class serialVersionUID  349931227699981827
```

### serialVersionUID

serialVersionUID가 달라서 바이트 스크림을 역직렬화 할 수 없다는 에러가 발생한다.
위 문제를 해결하기 위해 serialVersionUID 고정하여 설정해주어 문제를 해결할 수 있다.

`@Serial`를 사용해서 Serial임을 표시하는 어노테이션도 달아주면 좋다. 이 어노테이션은 `serialVersionUID` 이라는 이름과 누락 타입을 정확히 잡아주기 위해서 사용된다.

#### serialVersionUID가 추가된 코드

```java
package org.example;

import java.io.Serializable;

public final class Student implements Serializable {
    // Serial version Id를 추가해준다.
    @Serial
    private static final long serialVersionUID = 1L;

    int id;
    String name;

    public Student(int id, String name) {
        this.id = id;
        this.name = name;
    }

    @Override()
    public String toString(){
        return "Student{" +
                "id=" + id + '\'' +
                ", name='" + name + '\'' +
                "}";
    }
}
```

#### 정상적으로 출력된 결과물

```
Student{id=1', name='Han'}
```

# 참고 문헌

- [자바 직렬화](https://www.slideshare.net/slideshow/java-serialization-46382579/46382579)
- [자바 직렬화(Serializable) - 완벽 마스터하기](https://inpa.tistory.com/entry/JAVA-%E2%98%95-%EC%A7%81%EB%A0%AC%ED%99%94Serializable-%EC%99%84%EB%B2%BD-%EB%A7%88%EC%8A%A4%ED%84%B0%ED%95%98%EA%B8%B0)
