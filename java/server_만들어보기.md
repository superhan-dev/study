# 간단한 http서버 만들어보기

# 작성일

- 2025-11-08

# 개요

자바를 이용해 브라우저에서 요청이 들어오면 어떻게 요청들을 파싱해서 처리하는지 정리해보자.

## 서버 클래스 구현

서버란 요청이 오기를 계속해서 대기하면서 계속해서 켜져있는 동작을 하는 프로그램이다.
때문에 특정 신호들이나 에러가 발생해 꺼지기 전까지는 지속적으로 동작한다.
이를 위해 while문을 사용해서 서버를 동작시키는 로직을 구현해 보았다.

먼저 구조먼저 만들어 보자.
다음과 같이 클래스를 구현했고 서버의 상태와 포트 번호를 속성으로 가진 클래스를 만들었다.

```java

public class Server {
    public int port;
    /**
     * 서버의 상태를 제어하는 속성이다.
     * 서버를 멈추길 원할때 false로 바꾸면 서버가 멈춘다.
     *
     * why volatile?
     * - 멀티스레드가 동작하는 자바는 여러 쓰레드에서 서버의 isRunning 상태를 바라볼 수 있게 된다.
     *
     *  메모리에 적재되어있는 값을 바로 플로시해서 바라보기 위해 volatile을 사용한다.
     *
     * volatile 키워드를 사용하면 1,2,3차 캐시의 일관성을 보장하고 메인 메모리 값으로 즉시 교체한다.
     *
     *  */
    private volatile boolean isRunning = true;

    Server(int port){
        this.port = port;
    }

    /**
     * 서버가 요청을 기다리는 동안 계속해서 서버를 실행시키는 역할을 하고 isRunning값이 true라면 계속해서 서버를 실행시킨다.
     */
    public void listen() throws IOException {}
    /**
     * socket 이 들어오면 요청을 핸들하는 핸들러 함수이다.
     * 스트림을 값을 읽고 HTTP 헤더와 값들을 읽어 응답을 하기 전에 선 처리 후 응답 메소드를 호출한다.
     */
    public void handle(Socket client) throws IOException {}
    /**
     * 응답을 하기위한 처리들이 완료되면 상태를 응답한다.
     */
    private void writeResponse(OutputStream out, int status, String statusMessage, String contentType, String body){}
}

```

자, 이제 하나씩 메소드를 구현해보면서 정리해보자.
브라우저에서 요청이 들어오면 어떻게 값을 받는지 확인할 수 있는 시간이다.
BufferedReader를 사용해서 한줄씩 요청을 받아 처리할 예정이다. 기본 동작 방식은 간단하다. buffer를 한줄씩 계속해서 읽고 다음 라인이 없을때 까지 반복하면서 파싱한다.

HTTP 는 정보를 `key:value`로 한줄에 하나씩 보내는 특징을 가지고 있다. 때문에 한줄씩 읽어 값에 대한 처리를 해주는데 보통 웹서버를 구현할 때 SpringBoot와 같은 프레임워크에서 이 처리들을 모두 해주고 메소드마다 다르게 구현할 수 있도록 분기 처리를 할 수 있는 메소드들도 모두 구현해두었기 때문에 서버 개발자는 이런 귀찮은 처리를 덜 신경쓰게 된다.

###

```java
public void handle(Socket client) throws IOException {
    /**
     * 읽기 타임아웃을 따로 설정하여 정해진 만큼 readLine이 대기한다.
     * 보통은 소켓은 닫지 않고 무한정 대기하지만 시간을 정해 적절한 별도 처리를 할 수 있다.
     * 기본 값은 SO_TIMEOUT으로 4초 정도 된다.
     *  */
    client.setSoTimeout(10000);
    BufferedReader br = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
    OutputStream out = client.getOutputStream();

    String request = br.readLine();
    if(request == null){
        return;
    }

    String data = null;
    int contentLength = 0;
    boolean keepAlive = false;
    while((data = br.readLine())!=null){
        String lower = data.toLowerCase();
        // 이렇게 한줄씩 잘라 요청에 대한 속성들을 읽었다가 이 요청이 어떤 요청인지 식별하는데 사용되기도 한다.
        // 서버의 상황에 따라 요청이 너무 길면 잘라서 처리하는 방식도 구현을 고려할 수 있다.
        if(lower.startsWith("content-length:")){
            contentLength = Integer.parseInt(data.substring("content-length:".length()).trim());
        } else if(lower.startsWith("connection:keep-alive")){
            keepAlive = true;
        }
        if(data.isEmpty()){
            break;
        }
    }

    char[] bodyChars = null;
    if(contentLength > 0){
        bodyChars = new char[contentLength];
        int read = 0;
        while(read < contentLength){
            int r = br.read(bodyChars, read, contentLength - read);
            if(r == -1){
                break;
            }
            read += r;
        }

        System.out.println("body: " + Arrays.toString(bodyChars));

    }


    /**
     * 라우팅(아주 간단히)
     * exit을 pathVariable로 보내면 서버를 중단시켜주는 라우팅을 처리해보았다.
     *  */
    String path = request.split(" ")[1];
    if ("/exit".equals(path)) {
        writeResponse(out, 200, "OK", "text/plain; charset=UTF-8", "bye");
        isRunning = false;
        return;
    }

    // 실제 응답 쓰기: 상태줄 + 헤더 + 빈줄 + 바디
    String responseBody = "hello from server.";
    writeResponse(out, 200, "OK", "text/plain; charset=UTF-8", responseBody);
    // keep-alive를 진짜로 유지하려면 루프 돌며 같은 소켓을 계속 처리해야 합니다.
    // 여기서는 단순화를 위해 Connection: close 로 처리.
    br.close();
    out.close();
}
```

### writeResponse

바디로 응답하는것도 일일이 문자열을 커스텀하는 연산을 통해 이쁘게 응답하도록 되어있지만 실제는 이렇게 한 땀, 한 땀 만들어서 응답을 해야하는 것을 경험해볼 수 있다.

```java
private void writeResponse(OutputStream out, int status, String statusMessage, String contentType, String body) throws IOException {
    byte[] bodyBytes = body.getBytes(StandardCharsets.UTF_8);
    String response = "HTTP/1.1 " + status + " " + statusMessage + "\r\n" +
            "Content-Type: " + contentType + "\r\n" +
            "Content-Length: " + bodyBytes.length + "\r\n" +
            "Connection: close\r\n" +
            "\r\n" +
            body;
    out.write(response.getBytes(StandardCharsets.UTF_8));
    out.write(bodyBytes);
    out.flush();
}
```

# 결론

프레임워크가 다 해주는 동작이지만 한 번은 구현을 해보고 정리를 해보면 실제 어떤식으로 서버가 동작할지 유추하는데 있어 좋은 연습이 되는것 같다.
