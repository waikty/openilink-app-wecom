import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type DigitalLifeChannel = "wecom_bot" | "wecom_agent";

export interface AstrBotSocialClientOptions {
  webhookUrl: string;
  bridgeSecret: string;
  tenantId: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

export interface SocialInboundMessage {
  channel: DigitalLifeChannel;
  accountId: string;
  conversationId: string;
  externalUserId: string;
  platformMessageId: string;
  text: string;
}

export interface SocialReplyResult {
  status: "reply-authorized" | "reply-blocked" | "duplicate";
  channel: DigitalLifeChannel;
  messageId: string;
  ownerCode?: string;
  replyText?: string;
  grantId?: string;
}

const TRANSPORT_SCHEMA = "LANVIA_SOCIAL_TRANSPORT_EVENT_V1";
const DONE_SCHEMA = "LANVIA_SOCIAL_NATIVE_DRAFT_PROCESSED_V1";
const DUPLICATE_SCHEMA = "LANVIA_SOCIAL_DUPLICATE_ACK_V1";
const HEX_64 = /^[0-9a-f]{64}$/;
const OWNER_CODE = /^U[0-9]{3,32}$/;
const GRANT_ID = /^[A-Za-z0-9._:-]{1,256}$/;

function requiredText(value: unknown, code: string, max = 4096): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max ||
      value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(code);
  }
  return value;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) =>
    JSON.stringify(key) + ":" + stableJson(record[key])
  ).join(",") + "}";
}

function signature(secret: string, timestamp: string, nonce: string,
                   requestPath: string, body: string): string {
  const canonical = Buffer.from(
    timestamp + ":" + nonce + ":" + requestPath + ":" + body,
    "utf8",
  );
  return "sha256=" + createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(canonical).digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function eventKey(message: SocialInboundMessage, tenantId: string): string {
  return createHash("sha256")
    .update(JSON.stringify([
      tenantId, message.channel, message.accountId, message.platformMessageId,
    ]), "utf8")
    .digest("hex");
}

export class AstrBotSocialClient {
  private readonly webhookUrl: string;
  private readonly webhookPath: string;
  private readonly secret: string;
  private readonly tenantId: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: AstrBotSocialClientOptions) {
    if (typeof options.webhookUrl !== "string" ||
        !/^https?:\/\//i.test(options.webhookUrl)) {
      throw new Error("ASTRBOT_SOCIAL_WEBHOOK_URL_REQUIRED");
    }
    const url = new URL(options.webhookUrl);
    if (!url.pathname.startsWith("/api/platform/webhook/") ||
        url.pathname.length <= "/api/platform/webhook/".length ||
        url.search || url.hash || url.username || url.password) {
      throw new Error("ASTRBOT_SOCIAL_WEBHOOK_PATH_INVALID");
    }
    if (typeof options.bridgeSecret !== "string" ||
        Buffer.byteLength(options.bridgeSecret, "utf8") < 32) {
      throw new Error("ASTRBOT_SOCIAL_BRIDGE_SECRET_TOO_SHORT");
    }
    this.tenantId = requiredText(options.tenantId, "ASTRBOT_SOCIAL_TENANT_REQUIRED", 128);
    this.webhookUrl = url.toString();
    this.webhookPath = url.pathname;
    this.secret = options.bridgeSecret;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1000 ||
        this.timeoutMs > 120_000) {
      throw new Error("ASTRBOT_SOCIAL_TIMEOUT_INVALID");
    }
    this.fetcher = options.fetcher ?? fetch;
  }

  async dispatch(message: SocialInboundMessage): Promise<SocialReplyResult> {
    if (message.channel !== "wecom_bot" && message.channel !== "wecom_agent") {
      throw new Error("SOCIAL_CHANNEL_NOT_SUPPORTED");
    }
    const accountId = requiredText(message.accountId, "SOCIAL_ACCOUNT_REQUIRED", 256);
    const conversationId = requiredText(message.conversationId, "SOCIAL_CONVERSATION_REQUIRED", 256);
    const externalUserId = requiredText(message.externalUserId, "SOCIAL_SENDER_REQUIRED", 256);
    const platformMessageId = requiredText(message.platformMessageId, "SOCIAL_PLATFORM_MESSAGE_ID_REQUIRED", 512);
    const text = requiredText(message.text, "SOCIAL_TEXT_REQUIRED", 4096);
    const messageId = eventKey(message, this.tenantId);

    const payload = {
      schema: TRANSPORT_SCHEMA,
      channel: message.channel,
      message_scope: "direct",
      tenant_id: this.tenantId,
      account_id: accountId,
      conversation_id: conversationId,
      external_user_id: externalUserId,
      message_id: platformMessageId,
      text,
    };
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(24).toString("base64url");
    const requestSignature = signature(
      this.secret, timestamp, nonce, this.webhookPath, body,
    );

    const response = await this.fetcher(this.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lanvia-Source": "wecom",
        "X-Lanvia-Social-Timestamp": timestamp,
        "X-Lanvia-Social-Nonce": nonce,
        "X-Lanvia-Social-Signature": requestSignature,
        "X-Lanvia-Webhook-Path": this.webhookPath,
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error("ASTRBOT_SOCIAL_INGRESS_HTTP_" + response.status);
    }

    const result = await response.json() as {
      ok?: boolean;
      receipt?: Record<string, unknown>;
      response_signature?: string;
    };
    if (result?.ok !== true || !result.receipt ||
        typeof result.response_signature !== "string" ||
        !/^sha256=[0-9a-f]{64}$/.test(result.response_signature)) {
      throw new Error("ASTRBOT_SOCIAL_RESPONSE_INVALID");
    }

    const responseBody = stableJson(result.receipt);
    const expectedResponseSignature = signature(
      this.secret, timestamp, nonce, this.webhookPath, responseBody,
    );
    if (!secureEqual(result.response_signature, expectedResponseSignature)) {
      throw new Error("ASTRBOT_SOCIAL_RESPONSE_SIGNATURE_INVALID");
    }

    const receipt = result.receipt;
    if (receipt.channel !== message.channel || receipt.message_id !== messageId ||
        receipt.platform_sent !== false || receipt.runner_executed !== false ||
        receipt.memory_written !== false) {
      throw new Error("ASTRBOT_SOCIAL_RECEIPT_SCOPE_MISMATCH");
    }

    if (receipt.schema === DUPLICATE_SCHEMA && receipt.duplicate === true &&
        receipt.digital_life_invocations === 0) {
      return { status: "duplicate", channel: message.channel, messageId };
    }

    if (receipt.schema !== DONE_SCHEMA ||
        receipt.native_pipeline_completed !== true ||
        receipt.digital_life_invocations !== 1 ||
        typeof receipt.owner_code !== "string" ||
        !OWNER_CODE.test(receipt.owner_code) ||
        typeof receipt.reply_authorized !== "boolean") {
      throw new Error("ASTRBOT_SOCIAL_COMPLETION_RECEIPT_REQUIRED");
    }

    if (receipt.reply_authorized !== true) {
      return {
        status: "reply-blocked",
        channel: message.channel,
        messageId,
        ownerCode: receipt.owner_code,
      };
    }

    if (typeof receipt.reply_grant_id !== "string" ||
        !GRANT_ID.test(receipt.reply_grant_id) ||
        typeof receipt.reply_text !== "string" ||
        !receipt.reply_text.trim() || receipt.reply_text.length > 4096) {
      throw new Error("CORE_SIGNED_SOCIAL_REPLY_GRANT_REQUIRED");
    }

    return {
      status: "reply-authorized",
      channel: message.channel,
      messageId,
      ownerCode: receipt.owner_code,
      replyText: receipt.reply_text,
      grantId: receipt.reply_grant_id,
    };
  }
}
