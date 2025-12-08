# 작성일

- 2025-12-06

# 수많은 if문을 효과적으로 나누기

# 1. 코드의 문제점

하나의 메세지에 너무 많은 하위 타입이 있다보니 문제가 발생했다. 한번의 커넥션을 맺고 그 안에서 타입으로 분기해 로직을 핸들링하고자 이와같이 초기 구조가 잡혔다.

돌아보면 그렇게 좋은 구조는 아니나 프론트엔드가 복잡해질수록 불가피하게 메세지 하위 타입이 늘어나고 그때그때 커넥션을 맺을 수 없기 때문에 이와 같은 코드를 만들게 되었다.

## 1.1. 리팩터링 전 코드

```typescript
// ... import 생략
@WebSocketGateway({
  namespace: "",
  cors: {
    origin: process.env.CORS_ORIGINS?.split(",").map((origin) =>
      origin.trim()
    ) || ["http://localhost:8888"], // 개발환경 기본값 추가
    methods: ["GET", "POST"],
    credentials: true, // credentials를 true로 변경
  },
  allowEIO4: true,
  transports: ["websocket", "polling"],
})
export class WsInteractionGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(WsInteractionGateway.name);
  @WebSocketServer() io: Server;

  constructor(
    private readonly consultationRoomManager: ConsultationRoomManagerService,
    private readonly broadcastManager: BroadcastManagerService,
    private readonly whiteboardManager: WhiteboardManagerService,
    private readonly statisticsService: StatisticsService // private readonly textModelManager: TextModelManagerService,
  ) {}

  afterInit() {
    this.logger.log("WS Initialized");
    // BroadcastManager에 Socket.IO 서버 설정
    this.broadcastManager.setSocketServer(this.io);
    // ConsultationRoomManager에 Socket.IO 서버 설정
    this.consultationRoomManager.setSocketServer(this.io);
  }

  private readonly SIMPLE_BROADCAST_TOPICS = new Set<WsEmitEventsEnum>([
    WsEmitEventsEnum.SCENE_CHANGE,
    WsEmitEventsEnum.USER_PRESENCE,
    WsEmitEventsEnum.VIEWPORT_SYNC,
    WsEmitEventsEnum.CAMERA_ROTATION,
    WsEmitEventsEnum.CAMERA_FOV,
    WsEmitEventsEnum.DEVICE_INFO,
    WsEmitEventsEnum.RTC_SCREEN_SHARE_START,
    WsEmitEventsEnum.RTC_SCREEN_SHARE_END,
    WsEmitEventsEnum.RTC_CONNECTION_STATE,
    WsEmitEventsEnum.ZOOM_SHARE_CLICK,
  ]);

  private readonly FORWARD_TO_OTHER_PARTICIPANTS = new Set<WsEmitEventsEnum>([
    WsEmitEventsEnum.WEBRTC_OFFER,
    WsEmitEventsEnum.WEBRTC_ANSWER,
    WsEmitEventsEnum.WEBRTC_ICE_CANDIDATE,
  ]);

  private getSessionIdFromClient(client: Socket) {
    const query = client.handshake.query.sessionId;
    return Array.isArray(query) ? query[0] : query; // Helper function to retrieve sessionId
  }

  private assignClientMetadata(
    client: Socket,
    metadata: Record<string, unknown>
  ) {
    client.data = {
      ...(client.data || {}),
      ...metadata,
    };
  }

  async handleConnection(client: Socket, ...args: any[]) {
    const sessionId = this.getSessionIdFromClient(client); // Get sessionId from query

    const { sockets } = this.io.sockets;

    if (sessionId) {
      client.join(sessionId);
    }

    this.logger.log(
      `Client id: ${client.id} connected to session: ${sessionId}`
    );
    this.logger.debug(`Number of connected clients: ${sockets.size}`);

    // 새로 접속한 클라이언트에게 현재 세션 데이터 전송
    if (this.whiteboardManager.checkWhiteboardExists(sessionId as string)) {
      this.whiteboardManager.shareCurrentWhiteboard(
        sessionId as string,
        client
      );
    }
  }

  async handleDisconnect(client: Socket) {
    const sessionId = this.getSessionIdFromClient(client); // Helper function to get sessionId
    if (sessionId) {
      if (Array.isArray(sessionId)) {
        client.leave(sessionId[0]); // Leave room based on sessionId
      } else {
        client.leave(sessionId); // Leave room based on sessionId
      }
    }

    // 상담방 연결 해제 처리
    const { consultationId, userType } = client.data || {};

    if (consultationId && userType) {
      // 고객 퇴장 로그 수집 (고객인 경우)
      if (userType === "visitor") {
        try {
          await this.statisticsService.createConsultationLog({
            actionType: ConsultationLogActionTypeEnum.VISITOR_EXIT,
            actionValue: client.data?.visitorId || null,
            consultationId: consultationId,
            counselorId: null,
            device: client.handshake.headers["user-agent"] as string,
            ipAddress: client.handshake.address,
          });
        } catch (error) {
          this.logger.error("Failed to log visitor exit:", error);
          // 로깅 실패는 메인 작업을 막지 않음
        }
      }

      // ConsultationRoomManager에서 사용자 제거
      this.consultationRoomManager.removeConnectedUser(
        consultationId,
        client.id
      );
    }

    this.logger.log(`Client id:${client.id} disconnected`);
  }

  @SubscribeMessage("lh-live-chat")
  async handleLhLiveChatMessage(client: Socket, data: any) {
    const sessionId = this.getSessionIdFromClient(client);

    this.logger.log(`Message received from client id: ${client.id}`);

    try {
      const parsedData = JSON.parse(data);

      if (!parsedData.data && !sessionId) {
        throw new Error("Invalid message format or missing sessionId");
      }

      // slideList 타입의 메시지인 경우 세션 데이터 저장
      if (parsedData.type === WsEmitEventsEnum.WHITEBOARD_UPDATE) {
        this.whiteboardManager.updateWhiteboard(sessionId, parsedData.data);

        this.sendMessageToRoom(sessionId, data); // Send message to room based on sessionId
      }

      if (parsedData.type === WsEmitEventsEnum.CHECK_MANAGER_JOIN) {
        this.handleCheckManagerJoin(parsedData, sessionId, client);
      }

      if (parsedData.type === WsEmitEventsEnum.CHECK_VISITOR_JOIN) {
        this.handleCheckVisitorJoin(parsedData, sessionId, client);
      }

      if (parsedData.type === WsEmitEventsEnum.VISITOR_READY) {
        this.handleVisitorReady(parsedData, sessionId, client, data);
      }

      if (parsedData.type === WsEmitEventsEnum.MANAGER_END) {
        this.handleManagerEnd(parsedData, sessionId, client);
      }

      if (parsedData.type === WsEmitEventsEnum.VISITOR_END) {
        this.handleVisitorEnd(parsedData, sessionId, client);
      }

      if (parsedData.type === WsEmitEventsEnum.MANAGER_READY) {
        this.handleManagerReady(parsedData, sessionId, client, data);
      }

      if (parsedData.type === WsEmitEventsEnum.GET_ROOM_INFO) {
        this.handleGetRoomInfo(parsedData, sessionId, client);
      }

      if (parsedData.type === WsEmitEventsEnum.VIEW_SYNC) {
        // 그리기 모드 시작/종료 로그 수집
        this.handleViewSyncEvent(parsedData, sessionId as string, client, data);
      }

      if (this.FORWARD_TO_OTHER_PARTICIPANTS.has(parsedData.type)) {
        this.forwardToOtherParticipants(sessionId, client.id, data);
      }

      if (this.SIMPLE_BROADCAST_TOPICS.has(parsedData.type)) {
        this.sendMessageToRoom(sessionId, data); // 다른 클라이언트들에게 브로드캐스트
      }
    } catch (error) {
      this.logger.warn("Failed to parse message data:", error);
    }

    return {
      event: data.type,
      data,
    };
  }

  private sendMessageToRoom(room: string, message: string) {
    this.broadcastManager.sendMessageToRoom(room, message);
  }

  // WebRTC 시그널링을 위한 P2P 메시지 전달 (발신자 제외)
  private forwardToOtherParticipants(
    roomId: string,
    senderId: string,
    message: string
  ) {
    // 같은 방의 다른 참여자에게만 전달 (1:1 또는 1:N 구조)
    this.io.to(roomId).except(senderId).emit("lh-live-chat", message);
  }

  private handleCheckManagerJoin(
    parsedData: any,
    sessionId: string,
    client: Socket
  ) {
    this.consultationRoomManager.checkManagerCanJoin(
      sessionId,
      parsedData.data.managerId,
      client
    );
    const managerId = parsedData.data?.managerId ?? parsedData.userId;
    const consultationIdForClient =
      parsedData.data?.consultationId ?? (sessionId as string | undefined);

    if (consultationIdForClient && managerId) {
      this.assignClientMetadata(client, {
        consultationId: consultationIdForClient,
        userType: "counselor",
        counselorId: managerId,
      });
    }
  }

  private handleViewSyncEvent(
    parsedData: any,
    sessionId: string,
    client: Socket,
    data: any
  ) {
    try {
      const actionType = parsedData.data.isDrawingMode
        ? ConsultationLogActionTypeEnum.DRAWING_MODE_START
        : ConsultationLogActionTypeEnum.DRAWING_MODE_END;

      this.statisticsService.createConsultationLog({
        actionType: actionType,
        actionValue: parsedData.data.sceneId || null, // 씬 ID
        consultationId: parsedData.data.consultationId,
        counselorId: parsedData.userId,
        device: client.handshake.headers["user-agent"] as string,
        ipAddress: client.handshake.address,
      });
    } catch (error) {
      this.logger.error("Failed to log drawing mode change:", error);
      // 로깅 실패는 메인 작업을 막지 않음
    }

    if (sessionId) {
      this.sendMessageToRoom(sessionId, data); // 다른 클라이언트들에게 브로드캐스트
    }
  }

  private async handleManagerReady(
    parsedData: any,
    sessionId: string,
    client: Socket,
    data: any
  ) {
    const managerId =
      parsedData.data?.managerId ??
      parsedData.userId ??
      client.data?.counselorId;
    const consultationIdForClient =
      parsedData.data?.consultationId ?? (sessionId as string | undefined);

    if (consultationIdForClient && managerId) {
      this.assignClientMetadata(client, {
        consultationId: consultationIdForClient,
        userType: "counselor",
        counselorId: managerId,
      });
    }

    try {
      await this.statisticsService.createConsultationLog({
        actionType: ConsultationLogActionTypeEnum.COUNSELOR_ENTER,
        actionValue: null,
        consultationId: consultationIdForClient,
        counselorId: managerId,
        device: client.handshake.headers["user-agent"] as string,
        ipAddress: client.handshake.address,
      });
    } catch (error) {
      this.logger.error("Failed to log counselor enter:", error);
      // 로깅 실패는 메인 작업을 막지 않음
    }

    if (sessionId) {
      this.sendMessageToRoom(sessionId, data);
    }
  }

  private handleCheckVisitorJoin(
    parsedData: any,
    sessionId: string,
    client: Socket
  ) {
    this.consultationRoomManager.checkVisitorCanJoin(
      sessionId,
      parsedData.data.visitorId,
      client
    );
    const visitorId = parsedData.data?.visitorId ?? parsedData.userId;
    const consultationIdForClient =
      parsedData.data?.consultationId ?? (sessionId as string | undefined);

    if (consultationIdForClient && visitorId) {
      this.assignClientMetadata(client, {
        consultationId: consultationIdForClient,
        userType: "visitor",
        visitorId,
      });
    }
  }

  private handleVisitorReady(
    parsedData: any,
    sessionId: string,
    client: Socket,
    data: any
  ) {
    this.consultationRoomManager.setVisitorReadyState(
      sessionId,
      parsedData.data.visitorId,
      client
    );

    const visitorId = parsedData.data?.visitorId ?? parsedData.userId;
    const consultationIdForClient =
      parsedData.data?.consultationId ?? (sessionId as string | undefined);

    if (consultationIdForClient && visitorId) {
      this.assignClientMetadata(client, {
        consultationId: consultationIdForClient,
        userType: "visitor",
        visitorId,
      });
    }

    this.sendMessageToRoom(sessionId, data);
  }

  private handleManagerEnd(parsedData: any, sessionId: string, client: Socket) {
    const managerId = parsedData.userId ?? parsedData.data?.managerId;
    const consultationIdForClient =
      parsedData.data?.consultationId ?? (sessionId as string | undefined);

    if (consultationIdForClient && managerId) {
      this.assignClientMetadata(client, {
        consultationId: consultationIdForClient,
        userType: "counselor",
        counselorId: managerId,
      });
    }

    this.consultationRoomManager.endConsultation(sessionId, client);
  }

  private handleVisitorEnd(parsedData: any, sessionId: string, client: Socket) {
    const visitorId = parsedData.data?.visitorId ?? parsedData.userId;
    const consultationIdForClient =
      parsedData.data?.consultationId ?? (sessionId as string | undefined);

    if (consultationIdForClient && visitorId) {
      this.assignClientMetadata(client, {
        consultationId: consultationIdForClient,
        userType: "visitor",
        visitorId,
      });
    }
    this.consultationRoomManager.exitVisitor(sessionId, client);
  }

  private handleGetRoomInfo(
    parsedData: any,
    sessionId: string,
    client: Socket
  ) {
    // 특정 상담실 정보 요청인지 전체 정보 요청인지 확인
    if (parsedData.data?.requestAll) {
      this.consultationRoomManager.getAllRoomsInfo(client);
    } else {
      this.consultationRoomManager.getRoomInfo(sessionId, client);
    }
  }
}
```

정리가 좀 필요해 보인다.

if문을 통해 특정 행동을 정의하게되면 수도없이 많은 행위들이 어지럽게 나열될 수 있다. 이때는 각 행위들에 대한 전략을 클래스로 만들고 동적으로 행동의 변경이 필요한 경우를 대응하는 방법이 있다.
이에 적합한 디자인 패턴 중 전략 패턴을 가지고 문제를 해결해 보자.

---

# 2. 전략 패턴 예시

전략 패턴을 사용하면 if/switch가 비대해지면서 거대해지는 구조를 심플하게 잡을 수 있게 된다.

## 2.1. 공통 인터페이스 정의

이벤트를 넘겨주는 파라미터를 타입(type)과 동작(handle)으로 나눌 수 있다. 또한 공통적으로 넘겨주는 파라미터를 context로 그루핑 하고이를 핸들링하는 함수를 받아 처리하면 기본적인 틀을 잡을 수 있다.

```typescript
import { WsEmitEventsEnum } from "@/common/enum/ws-emit-events.enum";
import type { Socket } from "socket.io";

export interface WsEventContext {
  parsedData: any;
  raw: any;
  client: Socket;
  sessionId?: number;
}

export interface WsEventHandler {
  readonly type: WsEmitEventsEnum;
  handle(ctx: WsEventContext): Promise<void> | void;
}
```

## 2.2. 이벤트 핸들러 작성 예시

앞서 작성한 인터페이스를 구현한 구현체를 다음과 같이 정의하여 하나의 행위를 클래스로 만들 수 있게 된다.

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { WsEventHandler, WsEventContext } from "./ws-event-handler.interface";
import { WsEmitEventsEnum } from "@/common/enum/ws-emit-events.enum";
import { StatisticsService } from "@/application/service/statistics.service";
import { ConsultationLogActionTypeEnum } from "@/presentation/dto/request/create-consultation-log.request";

@Injectable()
export class ManagerReadyHandler implements WsEventHandler {
  readonly type = WsEmitEventEnum.MANAGER_READY;
  // 로거도 이벤트 핸들러 별로 나눠지는 부수적인 효과가 따라온다.
  private readonly logger = new Logger(ManagerReadyHandler.name);

  constructor(private readonly statisticsService: StatisticsService) {}

  async handle({ parsedData, client, sessionId, raw }: WsEventContext) {
    // ... 기존 전체 로직을 여기로 가져오면 된다.
  }
}
```

## 2.3. 핸들러 등록용 레지스트리/팩토리

Nest에서 "타입 -> 핸들러 객체" 매핑을 만들려면, 레지스트리 서비스를 하나 만들어서 처리할 수 있다.

```typescript
// ws-event-handler.registry.ts
import { Injectable } from "@nestjs/common";
import { WsEmitEventsEnum } from "@/common/enum/ws-emit-events.enum";
import { WsEventHandler } from "./ws-event-handler.interface";
import { ManagerReadyHandler } from "./manager-ready.handler";
import { VisitorReadyHandler } from "./visitor-ready.handler";
import { ViewSyncHandler } from "./view-sync.handler";
// ... 다른 핸들러들 import

@Injectable()
export class WsEventHandlerRegistry {
  private readonly handlers = new Map<WsEmitEventsEnum, WsEventHandler>();

  constructor(
    managerReadHandler: ManagerReadyHandler,
    visitorReadHandler: VisitorReadHandler
    // ... 다른 핸들러 생성자 DI
  ) {
    this.register(managerReadHandler);
    this.register(visitorReadHandler);
    // ... 다른 핸들러 등록
  }

  private register(handler: WsEventHandler) {
    this.handlers.set(handler.type, handler);
  }

  get(type: WsEmitEventsEnum): WsEventHandler | undefined {
    return this.handlers.get(type);
  }
}
```

## 2.4. Gateway에서 전략 선택 및 위임

```typescript

constructor(
  private readonly handlerRegistry: WsEventHandlerRegistry,
  // 기존 서비스들...
) {}

@SubscribeMessage('lh-live-chat')
async handleLhLiveChatMessage(client: Socket, raw: any) {
  const sessionId = this.getSessionIdFromClient(client);
  this.logger.log(`Message received from client id: ${client.id}`);

  let parsedData: any;
  try {
    parsedData = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    this.logger.warn('Failed to parse message data:', error);
    return;
  }

  // type 이 몇개가 되도 받아서 위임만 할 수 있도록 처리하면 타입별로 Strategy만 정의해주면 되기때문에 유연하고 견고하게 구조가 형성된다.
  const type = parsedData.type as WsEmitEventsEnum;

  const handler = this.handlerRegistry.get(type);
  if (!handler) {
    this.logger.debug(`No handler registered for type ${type}`);
    return;
  }

  await handler.handle({
    parsedData,
    raw,
    client,
    sessionId: sessionId as string | undefined,
  });
}

```
