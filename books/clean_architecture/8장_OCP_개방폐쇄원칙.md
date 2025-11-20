# 작성일

- 2025-11-20

# 저수준 클래스와 고수준 클래스의 차이

## 왜 저수준과 고수준이라고 하는가?

클래스는 상속이라는게 존재하고 확장과 상속은 위에서 아래로 내려온다. Java에서 가장 최상위 클래스는 Object라는 클래스인데 이 클래스를 확장해서 모든 클래스들이 하위에 존재한다.

때문에 하위일 수록 저수준이라고 하고 위로 올라갈 수록 고수준이라고 하는 것이다.
클래스간 관계를 명시할 때 화살표를 사용하곤 하는데 화살표 꼬리쪽이 저수준, 화살표 머리가 가르키는 쪽이 고수준 클래스라고 생각하면 된다.

하지만 클린 아키텍처에서 말하는 저수준과 고수준은 또 다르다.

## 클린 아키텍처의 OCP에서 말하는 저수준과 고수준

### 저수준(구체, 세부 구현에 가까운 것)

- JDBC, JPA, MyBatis 같은 DB 접근 코드
- Spring @RestController 안에서의 HTTP 요청/응답 처리
- UI 프레임워크 (JavaFX, Swing, Android UI)
- Object, String, ArrayList 같은 언어/라이브러리 레벨 도구

### 고수준(정채그 유스케이스 중심)

- StartConsultationUseCase
- CalculateMonthlyStatisticsService
- WhitelistLoginPolicy
- ChargePointService (충전 요금 계산 규칙)

### List 예시

- List (인터페이스) ← 좀 더 고수준·추상
- ArrayList, LinkedList (구현체들) ← 저수준·구체

# 정리

저수준일 수록 구체적인 것에 가깝고 고수준일 수록 추상적이다.
`Open Close Principle`은 확장에는 열려있고 변경에는 닫혀있다 라는 원리로 저수준 컴포넌트의 변경으로부터 고수준 컴포넌트를 보호할 수 있는 의존성 계층 구조가 만들어 지도록 해야한다.
