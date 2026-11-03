#!/usr/bin/env bash
# motionEye 설치 스크립트 (Ubuntu)
set -euo pipefail

echo "== 1/3 의존 패키지 설치 =="
sudo apt update
sudo apt --no-install-recommends install -y \
  ca-certificates curl python3 python3-dev python3-pip gcc \
  libjpeg-dev libcurl4-openssl-dev libssl-dev v4l-utils

echo "== 2/3 motionEye 설치 =="
sudo python3 -m pip install --break-system-packages --pre motioneye

echo "== 3/3 motionEye 초기화 (motion 설치 + systemd 서비스 등록) =="
sudo motioneye_init

sudo systemctl enable --now motioneye
systemctl --no-pager status motioneye | head -5
echo
echo "완료: 브라우저에서 http://localhost:8765 접속 (기본 계정 admin / 비밀번호 없음)"
