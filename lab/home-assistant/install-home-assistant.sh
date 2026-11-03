#!/usr/bin/env bash
# Home Assistant (Container) 설치 스크립트 (Ubuntu)
set -euo pipefail

echo "== 1/2 Docker 설치 =="
sudo apt install -y docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # 재로그인 후 sudo 없이 docker 사용

echo "== 2/2 Home Assistant 컨테이너 실행 =="
sudo docker run -d \
  --name homeassistant \
  --restart=unless-stopped \
  -e TZ=Asia/Seoul \
  -v "$HOME/homeassistant:/config" \
  -v /run/dbus:/run/dbus:ro \
  --network=host \
  ghcr.io/home-assistant/home-assistant:stable

echo
echo "완료: 1~2분 뒤 브라우저에서 http://localhost:8123 접속"
