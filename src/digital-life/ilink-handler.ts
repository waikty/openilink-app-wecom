import type { HubClient } from "../hub/client.js";
import type { HubEvent, Installation } from "../hub/types.js";
import type { AstrBotSocialClient } from "./astrbot-social-client.js";

export type ILinkDigitalLifeResult =
  | { status: "ignored"; reason: "not-message" | "group" | "unsupported-message" | "sender-mismatch" }
  | { status: "reply-blocked" | "duplicate" }
  | { status: "replied"; grantId: string };

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Called only after /webhook has verified the original OpeniLink Hub HMAC.
 * The Hub's personal iLink account is normalized into the same AstrBot
 * Digital Life ingress used by WeCom; replies return to the same iLink user.
 */
export async function handleIlinkHubEventWithDigitalLife(
  socialClient: AstrBotSocialClient,
  hubClient: HubClient,
  event: HubEvent,
  installation: Installation,
): Promise<ILinkDigitalLifeResult> {
  const type = event.event?.type || "";
  if (event.type !== "event" || !type.startsWith("message")) {
    return { status: "ignored", reason: "not-message" };
  }
  if (event.bot?.id !== installation.botId) {
    return { status: "ignored", reason: "sender-mismatch" };
  }

  const data = event.event?.data ?? {};
  if (data.group || data.chat_type === "group" || data.chattype === "group") {
    return { status: "ignored", reason: "group" };
  }

  const senderId = firstText(
    data.user_id,
    data.from_user_id,
    data.sender_id,
    (data.sender as { id?: unknown } | undefined)?.id,
  );
  const text = firstText(data.text, data.content);
  const conversationId = firstText(data.conversation_id, senderId);
  const messageId = firstText(event.event?.id);

  if (!senderId || !conversationId || !messageId || !text) {
    return { status: "ignored", reason: "unsupported-message" };
  }

  const result = await socialClient.dispatch({
    channel: "ilink",
    messageScope: "direct",
    accountId: event.bot.id,
    conversationId,
    externalUserId: senderId,
    platformMessageId: messageId,
    text,
  });

  if (result.status === "duplicate") return { status: "duplicate" };
  if (result.status !== "reply-authorized" || !result.replyText || !result.grantId) {
    return { status: "reply-blocked" };
  }

  // The reply is sent only after AstrBot's signed receipt proves the original
  // Core Access Pass grant for this Owner and this social message.
  await hubClient.sendText(senderId, result.replyText, event.trace_id);
  return { status: "replied", grantId: result.grantId };
}
