/**
 * 企业微信消息统一数据结构
 * 将不同类型的消息（文本、图片、语音、文件）归一化为统一格式
 */
export interface WecomMessageData {
  /** 单聊用户 ID；群聊为 chatid */
  conversationId: string;
  /** 企业微信 BaseMessage.msgid */
  msgId: string;
  /** text / image / mixed / voice / file / video */
  msgType: string;
  /** 文本内容或媒体占位信息 */
  content: string;
  /** BaseMessage.from.userid */
  userId: string;
  /** SDK 未保证提供姓名，缺失时为空 */
  userName: string;
  /** 只允许 single 进入私人 Digital Life 会话 */
  messageScope: "direct" | "group" | "unknown";
  /** 原始 frame，用于回复 */
  frame: any;
}

/**
 * 消息处理函数签名
 */
export type WecomMessageHandler = (
  data: WecomMessageData,
) => void | Promise<void>;

/**
 * 从 frame.body 中提取通用字段
 */
function extractMessageBase(frame: any): Omit<WecomMessageData, "msgType" | "content"> {
  const body = frame?.body || {};
  const messageScope = body.chattype === "single"
    ? "direct"
    : body.chattype === "group" ? "group" : "unknown";
  const userId = body.from?.userid || "";
  return {
    conversationId: messageScope === "group" ? (body.chatid || "") : userId,
    msgId: body.msgid || "",
    userId,
    userName: body.from?.name || "",
    messageScope,
    frame,
  };
}

/**
 * 注册企业微信消息事件监听
 * 将 message.text / message.image / message.voice / message.file 统一回调
 *
 * @param wsClient  AiBot.WSClient 实例
 * @param onMessage 统一消息处理回调
 */
export function registerWecomEvents(
  wsClient: any,
  onMessage: WecomMessageHandler,
): void {
  /** 文本消息 */
  wsClient.on("message.text", (frame: any) => {
    const base = extractMessageBase(frame);
    const content = frame.body?.text?.content || "";
    onMessage({
      ...base,
      msgType: "text",
      content,
    });
  });

  /** 图片消息 */
  wsClient.on("message.image", (frame: any) => {
    const base = extractMessageBase(frame);
    const content = frame.body?.image?.url || "[图片]";
    onMessage({
      ...base,
      msgType: "image",
      content,
    });
  });

  /** 语音消息 */
  wsClient.on("message.voice", (frame: any) => {
    const base = extractMessageBase(frame);
    const content = frame.body?.voice?.url || "[语音]";
    onMessage({
      ...base,
      msgType: "voice",
      content,
    });
  });

  /** 图文混排消息：当前只保留事件，不把加密媒体 URL 当成 AI 可读内容 */
  wsClient.on("message.mixed", (frame: any) => {
    const base = extractMessageBase(frame);
    onMessage({ ...base, msgType: "mixed", content: "[图文混排]" });
  });

  /** 文件消息 */
  wsClient.on("message.file", (frame: any) => {
    const base = extractMessageBase(frame);
    const fileName = frame.body?.file?.name || "未知文件";
    const fileUrl = frame.body?.file?.url || "";
    const content = fileUrl ? `[文件] ${fileName}: ${fileUrl}` : `[文件] ${fileName}`;
    onMessage({
      ...base,
      msgType: "file",
      content,
    });
  });

  /** 视频消息：媒体需通过 SDK 解密后再交给视觉处理链路 */
  wsClient.on("message.video", (frame: any) => {
    const base = extractMessageBase(frame);
    const content = frame.body?.video?.url || "[视频]";
    onMessage({ ...base, msgType: "video", content });
  });

  /** 进入会话事件（仅打印日志，不触发消息回调） */
  wsClient.on("event.enter_chat", (frame: any) => {
    const userId = frame.body?.from?.userid || "unknown";
    console.log(`[WecomEvent] 用户 ${userId} 进入会话`);
  });
}
