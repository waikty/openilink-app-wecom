import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { WecomMessageData } from "../wecom/event.js";

const TRANSPORT_SCHEMA = "LANVIA_SOCIAL_TRANSPORT_EVENT_V1";
const DONE_SCHEMA = "LANVIA_SOCIAL_NATIVE_DRAFT_PROCESSED_V1";
const DUPLICATE_SCHEMA = "LANVIA_SOCIAL_DUPLICATE_ACK_V1";
const LINKED_SCHEMA = "LANVIA_SOCIAL_IDENTITY_LINKED_ACK_V1";
const CHANNELS = new Set(["wecom_bot", "wecom_agent"]);
const MESSAGE_ID = /^[0-9a-f]{64}$/;
const GRANT_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;

export interface DigitalLifeBridgeConfig {
  webhookUrl: string;
  tenantId: string;
  accountId: string;
  channel: "wecom_bot" | "wecom_agent";
  secret: string;
  timeoutMs?: number;
}

export interface DigitalLifeBridgeResult {
  status: "replied" | "received" | "duplicate" | "linked" | "ignored";
  messageId?: string;
  replyText?: string;
  replyGrantId?: string;
  reason?: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("SOCIAL_RESPONSE_VALUE_INVALID");
    return encoded;
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableJson).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) =>
    JSON.stringify(key) + ":" + stableJson(record[key])
  ).join(",") + "}";
}

function hmac(secret: Buffer, timestamp: string, nonce: string, path: string, body: string): string {
  const canonical = Buffer.concat([
    Buffer.from(timestamp + ":" + nonce + ":" + path + ":", "utf8"),
    Buffer.from(body, "utf8"),
  ]);
  return "sha256=" + createHmac("sha256", secret).update(canonical).digest("hex");
}

export function signDigitalLifeResponse(
  payload: Record<string, unknown>,
  secret: string,
  timestamp: string,
  nonce: string,
  path: string,
): string {
  return hmac(Buffer.from(secret, "utf8"), timestamp, nonce, path, stableJson(payload));
}

function verifySignature(
  provided: unknown,
  expected: string,
): boolean {
  if (typeof provided !== "string" || !/^sha256=[0-9a-f]{64}$/.test(provided)) return false;
  const left = Buffer.from(provided.slice(7), "hex");
  const right = Buffer.from(expected.slice(7), "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertConfig(config: DigitalLifeBridgeConfig): URL {
  if (!config || !CHANNELS.has(config.channel)) throw new Error("SOCIAL_CHANNEL_INVALID");
  for (const [name, value] of [
    ["tenantId", config.tenantId],
    ["accountId", config.accountId],
  ] as const) {
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
      throw new Error("SOCIAL_" + name.toUpperCase() + "_INVALID");
    }
  }
  if (typeof config.secret !== "string" || Buffer.byteLength(config.secret, "utf8") < 32) {
    throw new Error("SOCIAL_BRIDGE_SECRET_TOO_SHORT");
  }
  let url: URL;
  try {
    url = new URL(config.webhookUrl);
  } catch {
    throw new Error("DIGITAL_LIFE_WEBHOOK_URL_INVALID");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/api\/platform\/webhook\/[A-Za-z0-9_-]{16,128}$/.test(url.pathname)
  ) {
    throw new Error("DIGITAL_LIFE_WEBHOOK_URL_INVALID");
  }
  const timeout = config.timeoutMs ?? 8000;
  if (!Number.isInteger(timeout) || timeout < 500 || timeout > 30000) {
    throw new Error("DIGITAL_LIFE_TIMEOUT_INVALID");
  }
  return url;
}

export class DigitalLifeBridgeClient {
  private readonly config: DigitalLifeBridgeConfig;
  private readonly url: URL;
  private readonly secret: Buffer;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly makeNonce: () => string;

  constructor(
    config: DigitalLifeBridgeConfig,
    dependencies: {
      fetchImpl?: FetchLike;
      now?: () => number;
      makeNonce?: () => string;
    } = {},
  ) {
    this.url = assertConfig(config);
    this.config = { ...config, timeoutMs: config.timeoutMs ?? 8000 };
    this.secret = Buffer.from(config.secret, "utf8");
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.makeNonce = dependencies.makeNonce ?? (() => randomBytes(24).toString("base64url"));
  }

  async dispatch(message: WecomMessageData): Promise<DigitalLifeBridgeResult> {
    if (message.messageScope !== "direct") {
      return { status: "ignored", reason: "DIRECT_MESSAGE_ONLY" };
    }
    if (message.hasUnsupportedMedia) {
      return { status: "ignored", reason: "MEDIA_PAYLOAD_NOT_CONNECTED" };
    }
    if (
      typeof message.userId !== "string" || !message.userId.trim() ||
      typeof message.msgId !== "string" || !message.msgId.trim() ||
      typeof message.conversationId !== "string" || !message.conversationId.trim() ||
      typeof message.content !== "string" || !message.content.trim() ||
      message.content.length > 4096
    ) {
      throw new Error("WECOM_MESSAGE_FIELDS_INVALID");
    }

    const timestamp = String(Math.floor(this.now() / 1000));
    const nonce = this.makeNonce();
    if (!NONCE.test(nonce)) throw new Error("SOCIAL_NONCE_INVALID");
    const path = this.url.pathname;
    const payload = {
      schema: TRANSPORT_SCHEMA,
      channel: this.config.channel,
      message_scope: "direct",
      tenant_id: this.config.tenantId,
      account_id: this.config.accountId,
      conversation_id: message.conversationId,
      external_user_id: message.userId,
      message_id: message.msgId,
      text: message.content,
    };
    const raw = JSON.stringify(payload);
    const signature = hmac(this.secret, timestamp, nonce, path, raw);

    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lanvia-Source": "wecom",
        "X-Lanvia-Social-Timestamp": timestamp,
        "X-Lanvia-Social-Nonce": nonce,
        "X-Lanvia-Social-Signature": signature,
        "X-Lanvia-Webhook-Path": path,
      },
      body: raw,
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 8000),
    });
    const responseText = await response.text();
    if (responseText.length > 32768) throw new Error("DIGITAL_LIFE_RESPONSE_TOO_LARGE");
    if (!response.ok) throw new Error("DIGITAL_LIFE_INGRESS_HTTP_" + response.status);

    let envelope: unknown;
    try {
      envelope = JSON.parse(responseText);
    } catch {
      throw new Error("DIGITAL_LIFE_RESPONSE_INVALID_JSON");
    }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw new Error("DIGITAL_LIFE_RESPONSE_INVALID");
    }
    const outer = envelope as Record<string, unknown>;
    const receipt = outer.receipt;
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      throw new Error("DIGITAL_LIFE_SIGNED_RECEIPT_REQUIRED");
    }
    const signedReceipt = receipt as Record<string, unknown>;
    const expected = signDigitalLifeResponse(
      signedReceipt, this.config.secret, timestamp, nonce, path,
    );
    if (
      outer.ok !== true ||
      !verifySignature(outer.response_signature, expected) ||
      signedReceipt.channel !== this.config.channel ||
      typeof signedReceipt.message_id !== "string" ||
      !MESSAGE_ID.test(signedReceipt.message_id)
    ) {
      throw new Error("DIGITAL_LIFE_RESPONSE_SIGNATURE_INVALID");
    }

    if (signedReceipt.schema === LINKED_SCHEMA) {
      if (
        signedReceipt.linked !== true ||
        signedReceipt.digital_life_invocations !== 0 ||
        signedReceipt.platform_sent !== false ||
        signedReceipt.runner_executed !== false ||
        signedReceipt.memory_written !== false
      ) throw new Error("DIGITAL_LIFE_LINK_RECEIPT_INVALID");
      return { status: "linked", messageId: signedReceipt.message_id };
    }

    if (signedReceipt.schema === DUPLICATE_SCHEMA) {
      if (
        signedReceipt.duplicate !== true ||
        signedReceipt.digital_life_invocations !== 0 ||
        signedReceipt.platform_sent !== false ||
        signedReceipt.runner_executed !== false ||
        signedReceipt.memory_written !== false
      ) throw new Error("DIGITAL_LIFE_DUPLICATE_RECEIPT_INVALID");
      return { status: "duplicate", messageId: signedReceipt.message_id };
    }

    if (
      signedReceipt.schema !== DONE_SCHEMA ||
      signedReceipt.native_pipeline_completed !== true ||
      signedReceipt.digital_life_invocations !== 1 ||
      signedReceipt.platform_sent !== false ||
      signedReceipt.runner_executed !== false ||
      signedReceipt.memory_written !== false ||
      typeof signedReceipt.reply_authorized !== "boolean"
    ) {
      throw new Error("DIGITAL_LIFE_COMPLETION_RECEIPT_INVALID");
    }

    if (signedReceipt.reply_authorized !== true) {
      if (signedReceipt.reply_text != null || signedReceipt.reply_grant_id != null) {
        throw new Error("UNAUTHORIZED_SOCIAL_REPLY_PAYLOAD");
      }
      return { status: "received", messageId: signedReceipt.message_id };
    }

    const replyText = signedReceipt.reply_text;
    const grantId = signedReceipt.reply_grant_id;
    if (
      typeof replyText !== "string" || !replyText.trim() || replyText.length > 4096 ||
      typeof grantId !== "string" || !GRANT_ID.test(grantId)
    ) {
      throw new Error("CORE_SOCIAL_REPLY_GRANT_INVALID");
    }
    return {
      status: "replied",
      messageId: signedReceipt.message_id,
      replyText,
      replyGrantId: grantId,
    };
  }
}
