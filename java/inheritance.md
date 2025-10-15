# 상속과 IS-A, HAS-A 그리고 override, overload

Parent 객체를 정의하고 Child 객체에서 부모를 상속 받았을 때 다음과 같이 Parent Class가 자식 객체를 생성할 수 있는 원리에 대해 설명해보자.

이를 `Upcasting` 이라고도 한다. `Upcasting`은 IS-A 관계일때 가능하다.

```java
Parent p = new Child("자식1");
```

# IS-A 관계

> "Child is a Parent."

자식이 생성될 시 부모로부터 상속 받아서 기능을 정의 하고있기 때문에 이를 IS-A 관계 라고 할 수 있다.

## IS-A VS HAS-A

IS-A 를 상속을 구현한 것이라 표현하고 HAS-A를 합성하여 구현했다고 표현한다.

### IS-A

IS-A 관계는 맨 처음 언급한 것처럼 Parent 가 Child를 생성하여 할당 받을 수 있다. (반대로는 안된다. 위에서 아래로만 가능하다.)

다음 같이 구현을 하면 Child가 Parent를 상속(또는 확장) 받아 구현한 것이므로 IS-A 관계가 수립된다.

```java
public class Parent {}

public class Child extends Parent {}
```

### HAS-A

HAS-A 관계는 단순히 클래스가 다른 클래스를 포함하고 있는 것을 의미한다.

다음과 같이 학교가 학생과 선생님 클래스를 포함(또는 조합)하고 있는 관계를 HAS-A 관계라고 한다.

보편적으로 조합(Composite) 패턴인 HAS-A 방식이 IS-A 방식보다 유연하다고 알려져 있으나 이는 어디까지난 논리적으로 상속이 필요한 부분이 존재하기 때문에 무엇이 더 낫다 라고 할 수 없다.

```java

public class School {
    private Student student;
    private Teacher teacher;

    public School(Student student, Teacher teacher){
        this.student = student;
        this.teacher = teacher;
    }
}

```

# Override

상속에서 짚고 넘어가야할 포인트 중 Override를 뺄 수 없다. 부모에서 정의된 메소드를 자식에서 다시 한번 재정의 할 수 있는데 이를 Override라고 한다. 개념은 같은 메소드를 사용하되 자식 클래스에 적합하게 수정을 원할 때 사용된다.

## 기본적인 Override

부모 클래스에서 선언한 메소드와 파라미터 그대로 구현을 해야한다.

```java
public class Parent {
    public greeting(String saySomething){
        System.out.println("Hello!" + saySomething);
    }
}

public class Child extends Parent {
    @Override
    public greeting(String saySomething){
        System.out.println("I want to say Hi!" + saySomething);
    }
}
```

## Overloading

만약 자식 클래스에서 메소드에 다른 파라미터를 사용하싶다면 overloading 을 해서 확장하면 된다.

```java
public class Parent {
    public Parent(){}

    public greeting(String saySomething){
        System.out.println("Hello!" + saySomething);
    }
}

public class Child extends Parent {
    public Child(){}

    @Override
    public greeting(String saySomething){
        System.out.println("I want to say Hi!" + saySomething);
    }

    // 만약 부모 객체에서 정의한 메소드에 파라미터를 추가하고 싶다면
    // overloading 을 아래와 같이 할 수 있다.
    public greeting(String saySomething, String addSomething){
        System.out.println("I want to say Hi!" + saySomething + "and also" + addSomething);
    }
}

// 이와 같이 선언을 하게 되면 부모 클래스를 사용하여 자식 클래스를 선언했을 시에는 자식클래스에서 선언된 파라미터 두개를 넘겨주는 메소드를 사용 할 수 없게 된다.

public class Main {
    public static void main(String[] args){
        Parent p1 = new Child();


        p1.greeting("Hello");

        // p1에서는 자식 요소에서 Overloading 한 메소드를 사용할 수 없다.
        p1.greeting("Hello", "I love you guys."); // 에러가 발생한다. (1개의 인수가 필요하지만 2이(가) 발견되었습니다.)

    }

}
```
