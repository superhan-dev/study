# GitHub SSH 연결 설정 (Ubuntu)

로컬 Ubuntu PC에서 GitHub 레포에 push 하기 위한 SSH 키 설정 기록입니다.

## 1. Git 설치 및 사용자 설정

```bash
sudo apt update && sudo apt install -y git
git config --global user.name "superhan-dev"
git config --global user.email "superhan.dev@gmail.com"
git config --global init.defaultBranch main
```

## 2. SSH 키 생성

```bash
ssh-keygen -t ed25519 -C "superhan.dev@gmail.com"
```

- 기본 경로 `~/.ssh/id_ed25519` 사용
- passphrase 를 걸면 `ssh-add ~/.ssh/id_ed25519` 로 agent 에 등록해서 사용

## 3. `~/.ssh/config`

```
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519
    AddKeysToAgent yes
```

```bash
chmod 600 ~/.ssh/config
```

> 22번 포트가 막힌 네트워크에서는 `HostName ssh.github.com`, `Port 443` 으로 바꾼다.

## 4. GitHub 에 공개키 등록

```bash
cat ~/.ssh/id_ed25519.pub
```

출력된 한 줄을 GitHub → Settings → SSH and GPG keys → New SSH key (Authentication Key) 에 등록한다.

## 5. 연결 확인

```bash
ssh -T git@github.com
# Hi superhan-dev! You've successfully authenticated, but GitHub does not provide shell access.
```

GitHub ED25519 호스트 키 fingerprint 는 `SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU` 이다.

## 6. 레포 clone / remote 설정

```bash
git clone git@github.com:superhan-dev/study.git ~/study
# 기존 HTTPS remote 를 SSH 로 바꿀 때
git remote set-url origin git@github.com:superhan-dev/study.git
```

## 참고: 토큰(PAT) 방식

SSH 대신 HTTPS 를 쓸 경우 Fine-grained token(Contents: Read and write)을 발급하고,
push 할 때 비밀번호 자리에 토큰을 입력한다. (`git config --global credential.helper store` 로 저장 가능, 평문 저장 주의)

## 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| `git: command not found` | git 미설치 → `sudo apt install -y git` |
| `Permission denied (publickey)` | 공개키가 GitHub 에 미등록 → 4번 수행 |
| `Repository not found` | 레포 이름/owner 오타, 또는 레포를 아직 만들지 않음 |
| `fatal: not a git repository` | 레포 폴더 밖에서 실행 → `cd ~/study` 후 실행 |
| `nothing to commit, working tree clean` | 오류 아님, 변경 사항이 없음 |
