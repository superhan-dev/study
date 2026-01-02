# 작성일

- 2025-11-27

# Redis 에서 Lua script 사용 방법 정리

Redis를 사용하다보면 여러 명령어를 하나의 트랜젝션으로 처리해서 여러 연산을 묶어 하나의 명령어 처럼 사용할 수 있다.
DB의 트랜젝션과 비슷한 개념이라고 보면 이해가 쉽다.

# Nestjs Module

```typescript
// redis.module.ts
import { Module } from "@nestjs/common";
import * as Redis from "ioredis";

@Module({
  providers: [
    {
      provide: "REDIS_CLIENT",
      useFactory: () => {
        return new Redis({
          host: process.env.REDIS_HOST || "localhost",
          port: Number(process.env.REDIS_PORT) || 6379,
          // password: process.env.REDIS_PASSWORD,
          // db: 0,
        });
      },
    },
  ],
  exports: ["REDIS_CLIENT"],
})
export class RedisModule {}
```

# Lua 스크립트 작성 & 실행 (EVAL)

## Lua script 작성

```lua
-- KEYS[1] = coupon:stock
-- KEYS[2] = coupon:user:{userId}
-- ARGV[1] = userId (옵션으로 쓰고 싶으면)

local stock = tonumber(redis.call('GET', KEYS[1]))
if not stock or stock <= 0 then
  return 0 -- 재고 없음
end

if redis.call('EXISTS', KEYS[2]) == 1 then
  return 2 -- 이미 발급된 유저
end

redis.call('DECR', KEYS[1])      -- 재고 감소
redis.call('SET', KEYS[2], 1)    -- 유저 발급 표시

return 1 -- 성공

```

## NestJs 서비스에서 Lua 실행

> SCRIPT LOAD + EVALSHA 조합을 통한 성능 최적화를 할 수 있다.

성능 최적화를 하면 스크립트는 Redis에 캐시되고 실제 요청 시에는 SHA만 보내서 실행 하기 때문에 네트워크 Payload가 감소한다.

따라서 대용량 트래픽에서 보다 효율적으로 부하를 줄일 수 있다.

```typescript
// coupon.service.ts
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";

@Injectable()
export class CouponService {
  private issueCouponSha?: string;

  constructor(@Inject("REDIS_CLIENT") private readonly redis: Redis) {}

  private readonly issueCouponScript = `
    local stock = tonumber(redis.call('GET', KEYS[1]))
    if not stock or stock <= 0 then
      return 0 -- SOLD_OUT
    end

    if redis.call('EXISTS', KEYS[2]) == 1 then
      return 2 -- ALREADY_ISSUED
    end

    redis.call('DECR', KEYS[1])
    redis.call('SET', KEYS[2], 1)

    return 1 -- SUCCESS
  `;

  async onModuleInit() {
    // 서버 스타트 시 스크립트를 Redis에 로드
    this.issueCouponSha = await this.redis.script(
      "LOAD",
      this.issueCouponScript
    );
  }

  async issueCoupon(couponId: string, userId: string) {
    const stockKey = `coupon:${couponId}:stock`;
    const userKey = `coupon:${couponId}:user:${userId}`;

    const result = await this.redis.eval(
      this.issueCouponScript,
      2, // KEYS 개수
      stockKey, // KEYS[1]
      userKey // KEYS[2]
      // ARGV ... 필요하면 여기 뒤에
      // userId,
    );

    // result는 Lua에서 return 한 숫자
    switch (Number(result)) {
      case 1:
        return { status: "SUCCESS" };
      case 0:
        return { status: "SOLD_OUT" };
      case 2:
        return { status: "ALREADY_ISSUED" };
      default:
        return { status: "ERROR", code: result };
    }
  }
}
```

## EVAL을 쓰면 위험하지는 않은가?

typescript 개발을 해서 그런지 eval을 보면 거부감 부터 든다. 그 이유는 javascript에도 eval이라는 함수가 있는데 이 함수를 쓰면 파라미터로 넘어가 값은 바로 코드로 실행시켜 버리기 때문에 위험하다.

혹시 모르니 Redis에서 EVAL사용법을 한번 더 확인해보자.

### EVAL은 Lua 스크립트를 실행하는 실행엔진

개발자가 작성한 Lua 스크립트를 실행하며, 저장 프로시저 또는 DB함수에 더 가깝다.

### Lua 스크립트도 위험할 수 있다.

Lua 스크립트는 명령의 묶음이다. Redis에서 명령을 처리할때는 블로킹 기반으로 처리된다. 때문에 원자성이 확보된 연산을 할 수 있게 되는 것이다. 따라서 여러 명령어를 하나의 큰 명령어 처럼 묶는 Lua 스크립트도 처리 당시에 블로킹으로 동작하며 이 명령어들이 CPU 집약적인 규모의 큰 연산이라면 다른 연산들에 레이턴시가 발생할 수 있다.
