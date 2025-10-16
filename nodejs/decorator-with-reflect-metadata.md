# nodeJs에서 데코레이터 사용하기

Java에서 어노테이션이 있듯이 노드 js에서 데코레이터를 사용해서 AOP와 같은 공통 로직에 대한 처리들을 할 수 있다.

Meta Programming, Reflection 에 대한 개념을 사용하여 프로그램을 데이터로 취급하는 방법을 의미한다.
Reflection은 "투사하다." 라는 동사이며 여기서 힌트를 얻을 수 있다.
프로그래밍 언어 자체를 즉, nodeJs 코드를 활용해서 nodeJs 코드를 데이터로 바라본다는 의미가 된다.

[Wiki의 Meta programming 정의](https://en.wikipedia.org/wiki/Metaprogramming)에서 볼 수 있듯이 언어 자체가 자기 자신을 바라보며 프로그래밍 한다고 표현하면 좀더 편하게 이해할 수 있다.

동작 방식을 보면서 이해를 높혀보자.

## 메타 프로그래밍 동작 방식

1. 1단계(노출): 내부 정보를 읽는다 →
2. 2단계(증강/변환): 메타데이터를 붙이고/바꾸고/감싼다 →
3. 3단계(오케스트레이션): 프레임워크가 그 정보를 소비해 실제 동작을 구성한다 (라우팅/DI/AOP 등).

### 1단계: 노출(Introspection)

런타임에 **내부 정보(타입/메서드/파라미터/속성/디스크립터 등)**를 코드로 읽어올 수 있게 하는 단계

- JS/TS: Reflect.getMetadata, Object.getOwnPropertyDescriptors, Proxy의 get 트랩로 관찰
- Java: 리플렉션 API로 클래스/메소드/어노테이션 조회

### 2단계: 증강/변환(Augmentation/Transformation)

노출된 정보를 바탕으로 메타데이터를 부착·수정하거나, 대상의 구조/동작을 감싸서 변경하는 단계

- JS/TS: 데코레이터로 Reflect.defineMetadata 추가, PropertyDescriptor 수정, Proxy로 메서드 래핑
  - 예: @Transactional()이 원 메서드를 감싸 트랜잭션 시작/커밋/롤백 삽입
  - 예: @Get('/users')가 메서드에 {method:'GET', path:'/users'} 메타데이터를 부착
- 빌드타임도 가능: AST 변환(예: TS 트랜스포머, Babel)로 코드에 부가 로직 삽입

### 3단계: 오케스트레이션/적용(Orchestration/Application)

증강된 메타데이터와 변환 결과를 프레임워크가 소비하여 실제 동작을 구성하는 단계

- 런타임에서 라우팅/DI/AOP/검증 등 레지스트리 생성 후 실행 경로에 연결
  - 예: NestJS가 부팅 시 컨트롤러/핸들러를 스캔 → 메타데이터로 라우팅 테이블 구성 → Express/Fastify에 등록
  - 예: design:paramtypes를 읽어 의존성 주입 그래프 구성
  - 예: 검증/로깅/권한 가드 같은 횡단 관심사를 인터셉터/미들웨어로 체인에 연결
- 필요 시 코드 생성(스텁, 타입, 스키마)이나 캐시 프리컴파일 등 실행 최적화

# 참로링크

- [위키 백과 - Meta programming](https://en.wikipedia.org/wiki/Metaprogramming)
- [메타프로그래밍 살펴보기](https://medium.com/@hongseongho/%EB%A9%94%ED%83%80%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%98%EB%B0%8D-%EC%82%B4%ED%8E%B4%EB%B3%B4%EA%B8%B0-8c30dbe4d566)
