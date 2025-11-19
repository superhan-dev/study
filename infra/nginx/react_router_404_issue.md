# 작성일

- 2025-11-18

# react routing 404 issue

발생 원인
아래 코드가 빠져있었고

```
location / {
    try_files $uri $uri/ /index.html?$query_string;
}
```

# 이전 파일 (잘못되었던 설정)

```
server {
    listen 8080;
    # listen [::]:8080;

    root /usr/share/nginx/html;
    index index.html;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    # location / {
    #    try_files $uri $uri/ /index.html?$query_string;
    # }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.html;

#     location ~ /\.(?!well-known).* {
#         deny all;
#     }

# 아래 설정은 웹소켓 프록시인데 이 설정은 인그레스 단에서 처리하도록 하는게 좋다.
# 또한 현재 설정은 무한루프를 발생시킬 위험이 있는 구조로
# 현재 nginx 서버 자체가 listen 8080; 로 설정되어있는 상태에서
# /socket.io 들어오면 다시 http://localhost:8080으로 보낸다
# → 결국 자기 자신(같은 nginx)한테 다시 보내는 구조라서,
# 다음과 같은 무한 루프가 발생한다.
# /socket.io → nginx → /socket.io → nginx → … 무한 루프(or 바로 502/504).
  location /socket.io {
      proxy_pass http://localhost:8080;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection 'upgrade';
      proxy_set_header Host $host;
      proxy_cache_bypass $http_upgrade;
    }
}
```

전체 아키텍처 기준으로 보면 WebSocket/socket.io 서버는 백엔드(Nest, lh-cs-be-prd) 쪽에 있어야 하고, Ingress에서 /socket.io를 백엔드 서비스로 라우팅하는 것이 더 자연스러운 설정이므로 FE nginx가 /socket.io를 처리할 필요가 원래 없다.
