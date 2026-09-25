# Spring Cloud Gateway

- Request Rate Limiting
- netflix zuul api gateway

# spring Cloud Circuit Breaker integration

circuit breaker는 두꺼비집에 있는 누전차단기를 부르는 용어다. 누전 차단기란 감당가능한 전기량을 초과할시 누전을 방지하기 위해 전압을 일시적으로 모두 내리는 역할을 하는 것이다.
정전 상태로 만드는 것인데 단어로만 유추해 봐도 API Gateway에서 감당 가능한 한계치를 넘어서면 모든 요청을 차단하는 방식으로 동작하는 것으로 유추해볼 수 있다.

부하가 심해진 서버에 잠시 회복을 위한 시간을 주는 것이라고 볼 수 있다.

> 장애가 발생한 서버에 더이상 요청이 들어가지 않도록하여 복구를 할 수 있도록 하는 장치가 서킷브레이커이다.
