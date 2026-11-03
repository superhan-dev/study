# Home Assistant + motionEye

motionEye(CCTV 서버)를 Home Assistant(스마트홈 허브) UI 에서 보고 제어하기 위한 설정.

## motionEye 와의 관계

| | motionEye | Home Assistant |
|---|---|---|
| 역할 | 카메라 캡처·움직임 감지·녹화 | 여러 기기를 한 화면에서 제어·자동화 |
| 이 서버 | pip + systemd 로 설치 (`../motioneye-setup`) | Docker 컨테이너 |

motionEye 는 그대로 두고, HA 의 **motionEye 통합**으로 연결한다.

## 설치

```bash
./install-home-assistant.sh
```

- 설정 데이터: `~/homeassistant` (컨테이너의 `/config`)
- `--network=host` 라서 포트 매핑 없이 `8123` 으로 바로 열림
- `--restart=unless-stopped` 라서 재부팅 후 자동 시작
- Container 방식은 애드온이 없다 (애드온이 필요하면 VM 에 Home Assistant OS)

## motionEye 연동

1. `http://<서버IP>:8123` 접속 → 계정 생성 (온보딩)
2. 설정 → 기기 및 서비스 → 통합 추가 → **motionEye**
3. 입력값
   - URL: `http://<서버IP>:8765`
   - Admin: `admin` / 비밀번호
   - Surveillance: `user` / 비밀번호

연동 후 사용 가능한 것

- 대시보드 카메라 카드 (모바일 앱으로 외부에서도 확인)
- 움직임 감지 / 동영상 / 사진 저장 스위치
- 미디어 브라우저에서 녹화 파일 확인
- 자동화: 움직임 감지 시 알림·스냅샷, 외출 모드 시 녹화 켜기 등

## 관리

```bash
docker ps                          # 상태
docker logs -f homeassistant       # 로그
docker restart homeassistant       # 재시작
docker pull ghcr.io/home-assistant/home-assistant:stable \
  && docker rm -f homeassistant && ./install-home-assistant.sh   # 업데이트
```
