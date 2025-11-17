# 작성일

- 2025-11-17

# N+1은 왜 발생할까?

분명 뛰어난 개발자들이 만들어 놓은 ORM일 텐데 왜 N+1과 같은 이슈가 날까?
프로그래밍은 트레이드오프를 고려해서 개발해 놓은 만큼 분명 그 이유가 있을 것이다.

# JPA의 기본 전략

JPA는 일단 엔티티만 로딩하는 전략을 가지고있다. 예를 들어 Member와 Team이 있고 Member를 조회할 시 Team까지 꼭 필요하다는 보장을 하고있지 않다. 때문에 1차 쿼리는 다음과 같이 나간다.

```sql
select m.* from members m;
```

위와 같이 Member를 조회해서 영속성 컨텍스트에 올려두고 team필드는 Team 객체 대신 프록시(Proxy)를 심어두는 전략을 가져가고 있다.

## Proxy와 Team 조회 방식

JPA에서는 관계 매핑에 있어서 Lazy 사용을 권고한다.

```java
@Entity
class Member {
    @ManyToOne(fetch = FetchType.LAZY)
    private Team team;
}
```

위와 같은 식으로 사용하는데 이와 같이 사용하면 `m.getTeam()`과 같이 객체를 사용하기 위해 호출해도 DB에서 실제로 조회하지는 않는다.
대신 Proxy 객체를 영속성 컨텍스트에 넣어두고 코드에서 `m.getTeam().getName()`과 같이 접근하는 순간 DB에 쿼리 해서 Team Entity를 프록시 뒤에 연결한다.

이때 바로 N+1이 발생하게 되는 것이다.

## 왜 이렇게 하는가?

JPA는 프로그래머가 Member를 사용할 때 Team을 사용할지 알지 못한다. 때문에 1차원 적으로 위와 같이 처리하도록 전략을 세워둔 것이다. 즉, N+1이 발생하지만 이를 통해 얻고자 했던 이득은 불필요한 오버패칭 방지와 메모리 절약인 것이다.

```java
// 1) 팀 안 쓰는 경우
for (Member m : members) {
    System.out.println(m.getName());
}

// 2) 팀 쓰는 경우
for (Member m : members) {
    System.out.println(m.getTeam().getName());
}
```

- JPA는 JPQL만 보고는 “반드시 team을 써야 한다”는 정보가 없기 때문에 기본은 “일단 Member만 가져오고, team은 진짜 접근할 때 그때 조회하자 (LAZY)”로 설계되었다.

  - → 객체 세계에서는 자연스러운 전략이지만,
  - → DB 세계에서는 “행 수만큼 추가 쿼리”라는 비용 폭탄(N+1) 이 됨.

  다시 말해 N+1 현상은 객체 그래프 탐색을 자동으로 맞추려다보니 연관관계를 필요할 때마다 한 번씩 조회하게 되어 N개의 추가 쿼리가 발생하는 것이다.

# 대응 방법

N+1이 발생하면 대응하기 위한 방법은 fetchJoin, @Query로 직접 쿼리를 작성, entityGraph를 사용하는 방법 그리고 QueryDsl을 사용하는 방법이 있다.

## 1. fetchJoin 또는 @Query 작성

가장 기본적이며 직관적으로 사용하는 방법이다. join을 개발자가 직접 작성하므로써 N+1을 방지할 수 있게된다.

```java
public interface MemberRepository extends JpaRepository<Member, Long> {
    // JPQL + fetch join
    @Query("""
       select m from Member m
       join fetch m.team
       where m.status = :status
    """)
    List<Member> findWithTeamByStatus(@Param("status") MemberStatus status);
}
```

### 단점/주의

- 컬렉션(@OneToMany) fetch join + 페이징 조합시 중복 row + 메모리 페이징 이슈
  - 해결: @BatchSize or default_batch_fetch_size 같은 배치 페치 or DTO 방식
  - 재사용성이 떨어짐: JPQL이 메서드에 박혀서, 그래프가 바뀔 때마다 메서드 수정해야 함
  - 코드에 query string이 노출되는 것 싫어하는 팀도 있음

### 정리

“N+1이 딱 눈에 보이고, 조인 구조까지 내가 완전히 컨트롤하고 싶다" 할 때 fetch join + @Query를 사용할 수 있다.

## 2. @EntityGraph 사용

선언적으로 “이 연관관계는 같이 가져와줘” 라고 명시하는 것과 같다.

### 예시 1) 메서드 이름 쿼리 + 기본 EntityGraph

```java
@Entity
@NamedEntityGraph(
    name = "Member.withTeam",
    attributeNodes = @NamedAttributeNode("team")
)
public class Member { ... }

public interface MemberRepository extends JpaRepository<Member, Long> {

    @EntityGraph(value = "Member.withTeam", type = EntityGraphType.LOAD)
    List<Member> findByStatus(MemberStatus status);
}
```

### 예시 2) @Query + EntityGraph 같이 사용

```java
public interface MemberRepository extends JpaRepository<Member, Long> {

    @EntityGraph(attributePaths = { "team" })
    @Query("select m from Member m where m.status = :status")
    List<Member> findByStatusWithTeam(@Param("status") MemberStatus status);
}
```

### 장점

- 선언적: “이 메서드는 team까지 같이 가져와라”만 적어주면 됨
- 동일 메서드 이름 쿼리에도 붙일 수 있어서 코드가 깔끔
- JPQL을 건들지 않고 “어떤 연관관계를 패치할지”만 바꿀 수 있음
- 스프링 데이터 환경에서 재사용성이 좋음
  - 특정 엔티티의 “기본 조회 그래프”처럼 쓰기 좋다.

### 단점/주의

- 조인 방식/조건을 세밀하게 제어하긴 힘듦
  - 어떤 조인을 쓸지, 어떤 필터를 적용할지 → 여전히 JPQL/SQL에 의존
- 컬렉션 fetch와 페이징 문제는 여전히 존재 (결국 내부에서 fetch join을 쓰기 때문에)
- 복잡한 그래프(여러 단계 조인)에서는 오히려 파악이 어려워질 수 있음

### 정리

“이 엔티티를 조회할 때는 보통 A, B 정도는 항상 같이 가져온다”
→ 이런 “기본 뷰 그래프”를 선언하고 싶을 때 @EntityGraph가 좋다.
복잡한 검색 쿼리 튜닝용이라기보다는, 일상적인 조회 패턴을 깔끔하게 관리하는 용도에 가깝다.

## 3. DTO 조회 / Querydsl – 조회 전용 쿼리는 아예 따로 뽑기

실무에서 “조회량 많고 화면도 복잡한 리스트”는
애초부터 엔티티 그대로 쓰지 않고 DTO로 뽑아버리는 경우가 많다.

### JPQL DTO 예시

```java
@Query("""
   select new com.example.MemberSummaryDto(
       m.id, m.name, t.name, count(o.id)
   )
   from Member m
   join m.team t
   left join m.orders o
   where ...
   group by m.id, m.name, t.name
""")
Page<MemberSummaryDto> searchMembers(...);
```

## Querydsl 예시

```java
public Page<MemberSummaryDto> searchMembers(MemberSearchCond cond, Pageable pageable) {
    QMember m = QMember.member;
    QTeam t = QTeam.team;
    QOrder o = QOrder.order;

    List<MemberSummaryDto> content = query
        .select(new QMemberSummaryDto(
            m.id, m.name, t.name, o.count()
        ))
        .from(m)
        .join(m.team, t)
        .leftJoin(m.orders, o)
        .where(
            statusEq(cond.getStatus()),
            teamNameLike(cond.getTeamName())
        )
        .groupBy(m.id, m.name, t.name)
        .offset(pageable.getOffset())
        .limit(pageable.getPageSize())
        .fetch();

    ...
}
```

### 장점

- N+1이 애초에 생길 구석이 없음 (LAZY 안 타니까)
- 페이징, 통계, 정렬, 동적 검색 등 복잡한 조회 최적화에 최적
- 도메인 엔티티를 “조회 전용 요구사항”에 휘둘리지 않게 보호할 수 있음

### 단점

- 코드가 길어짐
- 엔티티 기반 “영속성 컨텍스트” 이점(1차 캐시, 변경 감지 등)을 못 씀
  - → 그러나 “조회 전용”이면 애초에 필요 없는 경우가 많음

### 정리

“리스트·검색 화면, 통계, 리포트” 같이 화면이 복잡하고 조회량이 많은 기능
→ 그냥 DTO 쿼리로 별도 레이어(Repository/QueryRepository) 파는 게 제일 깔끔하게 구현할 수 있다.

## 4. 그래서 “무엇을 언제 쓰는 게 베스트냐?”

제가 실무에서 쓰는 추천 패턴을 딱 정리해보면:

1. 매핑 규칙
   - @ManyToOne, @OneToMany, @OneToOne, @ManyToMany → 전부 LAZY
   - EAGER는 금지(진짜 특수한 경우 말고는 안 씀)
2. 단순/중요 화면에서 엔티티 그대로 필요할 때

   - 예: “상세 조회 화면에서 Member + Team만 있으면 된다”
   - → 1순위: fetch join + @Query
   - → 이게 반복되는 기본 패턴이라면, NamedEntityGraph + @EntityGraph 로 승격해서 재사용

3. 조회 조건이 복잡, 페이징 필요, 1:N 컬렉션 많이 얽혀 있음

   - → DTO 조회 (Querydsl/JPQL) 로 아예 별도 쿼리 모델 분리
   - 이 경우는 “N+1 해결”이 목표가 아니라 “애초에 LAZY를 안 타게 설계”하는 것.

4. EntityGraph는 언제?
   - “이 엔티티를 조회할 땐 항상 이 정도 그래프까진 기본으로 필요해”
   - → 예: Member.withTeam, Order.withMemberAndDelivery 같은 “대표 조회 그래프”용
   - JPQL을 자주 바꾸기 싫고, 조회 그래프만 선언적으로 조절하고 싶을 때 사용

## 5. 한 줄 요약

- “N+1을 가장 명확하게 통제하고 싶다”

  - → fetch join (+ @Query)

- “이 엔티티는 항상 A,B 정도까지는 같이 가져와야 한다”를 선언하고 싶다

  - → @EntityGraph

- “조회가 복잡하고, 쿼리 성능이 중요하다” (검색, 통계, 대량 리스트)
  - → 엔티티 말고 DTO 전용 쿼리 (Querydsl, JPQL)
