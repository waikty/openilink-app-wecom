import type { WecomClient } from "../wecom/client.js";
import type { WecomMessageData } from "../wecom/event.js";
import type { AstrBotSocialClient } from "./astrbot-social-client.js";

export type WecomDigitalLifeResult =
  | { status: "ignored"; reason: "group" | "unsupported-message" | "missing-frame" }
  | { status: "reply-blocked" | "duplicate" }
  | { status: "replied"; grantId: string };

export async function handleWecomMessageWithDigitalLife(
  socialClient: AstrBotSocialClient,
  wecomClient: WecomClient,
  accountId: string,
  message: WecomMessageData,
): Promise<WecomDigitalLifeResult> {
  // A private Owner conversation is not the same as a group chat. Never
  // leak private memory or a reply into a group without a separate policy.
  if (message.messageScope !== "direct") {
    return { status: "ignored", reason: "group" };
  }
  if (message.msgType !== "text" || !message.content.trim()) {
    return { status: "ignored", reason: "unsupported-message" };
  }
  if (!message.frame || !message.msgId || !message.userId || !message.conversationId) {
    return { status: "ignored", reason: "missing-frame" };
  }

  const result = await socialClient.dispatch({
    channel: "wecom_bot",
    messageScope: "direct",
    accountId,
    conversationId: message.conversationId,
    externalUserId: message.userId,
    platformMessageId: message.msgId,
    text: message.content,
  });

  if (result.status === "duplicate") return { status: "duplicate" };
  if (result.status !== "reply-authorized" || !result.replyText || !result.grantId) {
    return { status: "reply-blocked" };
  }

  // The client verifies the signed Core Access Pass receipt before this line.
  await wecomClient.replyStream(message.frame, result.replyText);
  return { status: "replied", grantId: result.grantId };
}
