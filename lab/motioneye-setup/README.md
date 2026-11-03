# motionEye setup

Ubuntu에 motionEye를 설치하고 USB 웹캠(ABKO APC930 QHD)을 연결한 설정 모음입니다.

## 구성

| 경로 | 설명 | 설치 위치 |
|---|---|---|
| `install-motioneye.sh` | 의존 패키지, motionEye(pip), systemd 서비스 설치 | - |
| `systemd/motioneye.service` | systemd 유닛 | `/etc/systemd/system/` |
| `config/motioneye.conf` | motionEye 서버 설정 (포트 8765) | `/etc/motioneye/` |
| `config/motion.conf` | motion 데몬 설정 (비밀값은 `<REDACTED>`) | `/etc/motioneye/` |
| `config/camera-1.conf` | 카메라 1 설정 (1280x720, 15fps) | `/etc/motioneye/` |

## 설치

```bash
./install-motioneye.sh
```

설치 후 브라우저에서 http://localhost:8765 에 접속합니다.

## 설정 복원

```bash
sudo install -o motion -g motion -m 600 config/camera-1.conf /etc/motioneye/
sudo install -o root -g motion -m 640 config/motioneye.conf /etc/motioneye/
sudo systemctl restart motioneye
```

> `config/motion.conf`의 `relay_secret`, `client_secret`, 비밀번호 해시는 저장소에 올리지 않았습니다.
> 그래서 `motion.conf`는 참고용이며 덮어쓰지 마세요. 서버의 기존 파일을 그대로 두고, 필요한 항목만 손으로 옮기세요.
