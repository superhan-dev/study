# 작성일

# 구형 맥미니 홈클라우드 구축

# 현재 맥미니 스팩 뜯어보기

## 스팩 정보

Intel Core i7이면 홈서버로 사용하기 매우 괜찮은 스팩으로 보여지고 코어 수도 4개 정도 되니 t3.medium정도에 버금가는 사이즈.

램 메모리도 16GB정도이니 개발하는 정도와 테스트 배포에서는 성능상 이슈도 크지 않을 것으로 보여짐.

```
system_profiler SPHardwareDataType
Hardware:

    Hardware Overview:

      Model Name: Mac mini
      Model Identifier: Macmini6,2
      Processor Name: Quad-Core Intel Core i7
      Processor Speed: 2.3 GHz
      Number of Processors: 1
      Total Number of Cores: 4
      L2 Cache (per Core): 256 KB
      L3 Cache: 6 MB
      Hyper-Threading Technology: Enabled
      Memory: 16 GB
      Boot ROM Version: 429.0.0.0.0
      SMC Version (system): 2.8f0
```

# 전략

- linux usb 확보 후 리눅스 설치
- k8s 를 사용해서 소형 홈클라우드 배포환경 구축
- virtualbox 사용가능 여부 파악
  - 구형이라 virtualbox 사용에 제약이 있음. 난이도가 증가할 위험이 있으므로 k3s를 활용하여 소형 배포환경 구축

# 트러블슈팅

1. 맥이 워낙 구형이라 MacOS를 사용하는데 제약이 있었고 macOS를 사용하지 않고 linux를 설치해서 설치하는 방법이 최선으로 보여짐.

# 정리

결론적으로 macOS의 한계를 극복하고 현재 장비의 이점을 최대한 활용하는 방안으로 Linux를 설치해서 홈 클라우드를 시작할 수 있는 준비를 마쳤다.

2012년형 구형 맥미니지만 Linux를 설치함으로써 굉장히 효율적으로 Intel i7 CPU와 16GB RAM그리고 1TB의 하드디스크의 성능을 가진 홈서버를 사용할 수 있는 초기 환경을 구축했다.
