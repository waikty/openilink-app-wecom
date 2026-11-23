/**
 * 企业微信智能机器人消息归一化。
 * 优先按官方 @wecom/aibot-node-sdk WsFrame 字段解析；
 * 不认识的会话类型保持 unknown，不能默认当成单聊。
 */
export type WecomMessageScope = "direct" | "group" | "unknown";

export interface WecomMessageData {
  conversationId: string;
  msgId: string;
  msgType: string;
  content: string;
  userId: string;
  userName: string;
  messageScope: WecomMessageScope;
  /** 图片、文件、视频或未转写语音不能伪装成纯文本交给 AI。 */
  hasUnsupportedMedia: boolean;
  frame: any;
}

export type WecomMessageHandler = (
  data: WecomMessageData,
) => void | Promise<void>;

function extractMessageBase(frame: any): Omit<
  WecomMessageData,
  "msgType" | "content" | "hasUnsupportedMedia"
> {
  const body = frame?.body || {};
  const senderId = body.from?.userid || body.sender?.user_id || "";
  const chatType = body.chattype || body.chat_type || "";
  const messageScope: WecomMessageScope =
    chatType === "single" ? "direct" :
    chatType === "group" ? "group" : "unknown";

  return {
    conversationId: messageScope === "direct"
      ? senderId
      : body.chatid || body.chat_id || body.conversation_id || "",
    msgId: body.msgid || body.msg_id || body.message_id || "",
    userId: senderId,
    userName: body.from?.name || body.sender?.name || "",
    messageScope,
    frame,
  };
}

async function deliver(
  onMessage: WecomMessageHandler,
  message: WecomMessageData,
): Promise<void> {
  try {
    await onMessage(message);
  } catch (error) {
    // Do not allow one failed delivery to become an unhandled WS callback.
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("[WecomEvent] Digital Life delivery failed:", code);
  }
}

export function registerWecomEvents(
  wsClient: any,
  onMessage: WecomMessageHandler,
): void {
  wsClient.on("message.text", (frame: any) => {
    void deliver(onMessage, {
      ...extractMessageBase(frame),
      msgType: "text",
      content: frame.body?.text?.content || "",
      hasUnsupportedMedia: false,
    });
  });

  wsClient.on("message.voice", (frame: any) => {
    const transcript = frame.body?.voice?.content || frame.body?.voice?.text || "";
    void deliver(onMessage, {
      ...extractMessageBase(frame),
      msgType: "voice",
      content: transcript,
      hasUnsupportedMedia: !transcript.trim(),
    });
  });

  wsClient.on("message.mixed", (frame: any) => {
    const items = frame.body?.mixed?.msg_item || [];
    const text = items
      .filter((item: any) => item?.msgtype === "text")
      .map((item: any) => item?.text?.content || "")
      .filter(Boolean)
      .join("\n");
    const containsMedia = items.some((item: any) => item?.msgtype !== "text");
    void deliver(onMessage, {
      ...extractMessageBase(frame),
      msgType: "mixed",
      content: text,
      hasUnsupportedMedia: containsMedia || !text.trim(),
    });
  });

  wsClient.on("message.image", (frame: any) => {
    void deliver(onMessage, {
      ...extractMessageBase(frame),
      msgType: "image",
      content: "",
      hasUnsupportedMedia: true,
    });
  });

  wsClient.on("message.file", (frame: any) => {
    void deliver(onMessage, {
      ...extractMessageBase(frame),
      msgType: "file",
      content: "",
      hasUnsupportedMedia: true,
    });
  });

  wsClient.on("message.video", (frame: any) => {
    void deliver(onMessage, {
      ...extractMessageBase(frame),
      msgType: "video",
      content: "",
      hasUnsupportedMedia: true,
    });
  });

  wsClient.on("event.enter_chat", (frame: any) => {
    const userId = frame.body?.from?.userid || frame.body?.sender?.user_id || "unknown";
    console.log("[WecomEvent] User entered direct chat:", userId === "unknown" ? "unknown" : "identified");
  });
}
