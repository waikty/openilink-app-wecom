/**
 * 企业微信智能机器人 SDK 的真实消息结构。
 * SDK 字段为 msgid / aibotid / chattype / from.userid；
 * 不能使用旧桥接误写的 message_id / sender.user_id / conversation_id。
 */
export interface WecomMessageData {
  /** 单聊使用发送者 userid；群聊使用 chatid（群聊不会进入私人 Digital Life） */
  conversationId: string;
  /** SDK 的 msgid，用于 AstrBot 幂等去重 */
  msgId: string;
  /** SDK 的 aibotid，用于绑定 Core 中的企业微信 Bot 账号 */
  botId: string;
  /** SDK 的 chattype：single / group */
  chatType: "single" | "group" | "unknown";
  /** 消息类型：text / image / voice / file / mixed */
  msgType: string;
  /** 文本内容；语音使用 SDK 已转写的 voice.content */
  content: string;
  /** SDK 的 from.userid */
  userId: string;
  /** SDK 不提供可信展示名时，使用 userid，不猜测姓名 */
  userName: string;
  /** 原始 frame，仅用于回复同一条企业微信消息 */
  frame: any;
}

export type WecomMessageHandler = (
  data: WecomMessageData,
) => void | Promise<void>;

function extractMessageBase(frame: any): Omit<WecomMessageData, "msgType" | "content"> {
  const body = frame?.body || {};
  const userId = typeof body.from?.userid === "string" ? body.from.userid : "";
  const chatType = body.chattype === "single" || body.chattype === "group"
    ? body.chattype : "unknown";
  return {
    conversationId: chatType === "single"
      ? userId
      : (typeof body.chatid === "string" ? body.chatid : ""),
    msgId: typeof body.msgid === "string" ? body.msgid : "",
    botId: typeof body.aibotid === "string" ? body.aibotid : "",
    chatType,
    userId,
    userName: userId,
    frame,
  };
}

export function registerWecomEvents(
  wsClient: any,
  onMessage: WecomMessageHandler,
): void {
  wsClient.on("message.text", (frame: any) => {
    const base = extractMessageBase(frame);
    onMessage({
      ...base,
      msgType: "text",
      content: typeof frame.body?.text?.content === "string"
        ? frame.body.text.content : "",
    });
  });

  wsClient.on("message.image", (frame: any) => {
    const base = extractMessageBase(frame);
    onMessage({
      ...base,
      msgType: "image",
      content: "[图片]",
    });
  });

  wsClient.on("message.voice", (frame: any) => {
    const base = extractMessageBase(frame);
    onMessage({
      ...base,
      msgType: "voice",
      content: typeof frame.body?.voice?.content === "string"
        ? frame.body.voice.content : "",
    });
  });

  wsClient.on("message.file", (frame: any) => {
    const base = extractMessageBase(frame);
    onMessage({
      ...base,
      msgType: "file",
      content: "[文件]",
    });
  });

  wsClient.on("message.mixed", (frame: any) => {
    const base = extractMessageBase(frame);
    const items = Array.isArray(frame.body?.mixed?.msg_item)
      ? frame.body.mixed.msg_item : [];
    const content = items.map((item: any) =>
      item?.msgtype === "text" && typeof item.text?.content === "string"
        ? item.text.content
        : item?.msgtype === "image" ? "[图片]" : ""
    ).filter(Boolean).join("\n");
    onMessage({
      ...base,
      msgType: "mixed",
      content,
    });
  });

  wsClient.on("event.enter_chat", (frame: any) => {
    const userId = frame.body?.from?.userid || "unknown";
    console.log("[WecomEvent] 用户进入会话，sender=%s", userId);
  });
}
