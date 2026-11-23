import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { URL } from "node:url";
import type { WecomMessageData } from "../wecom/event.js";

const REQUEST_SCHEMA = "LANVIA_SOCIAL_TRANSPORT_EVENT_V1";
const DONE_SCHEMA = "LANVIA_SOCIAL_NATIVE_DRAFT_PROCESSED_V1";
const DUPLICATE_SCHEMA = "LANVIA_SOCIAL_DUPLICATE_ACK_V1";
const LINKED_SCHEMA = "LANVIA_SOCIAL_IDENTITY_LINKED_ACK_V1";
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const SAFE_NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const SAFE_SIGNATURE = /^sha256=[a-f0-9]{64}$/;
const OWNER_CODE = /^U[0-9]{3,32}$/;

export interface DigitalLifeIngressConfig {
  webhookUrl: string;
  tenantId: string;
  accountId: string;
  secretFile: string;
  channel?: "wecom_bot" | "wecom_agent";
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  nonceFactory?: () => string;
}

export interface DigitalLifeReply {
  replyAuthorized: boolean;
  replyText: string | null;
  replyGrantId: string | null;
  duplicate: boolean;
  linked: boolean;
  receipt: Record<string, unknown>;
}

function fail(code: string): never {
  throw new Error(code);
}

function identifier(value: unknown, code: string, max = 256): string {
  if (typeof value !== "string" || !value || value.length > max ||
      value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) {
    return fail(code);
  }
  return value;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return fail("DIGITAL_LIFE_RESPONSE_JSON_INVALID");
    return encoded;
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableJson).join(",") + "]";
  }
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map((key) =>
    JSON.stringify(key) + ":" + stableJson(object[key])
  ).join(",") + "}";
}

function loadSecret(path: string): Buffer {
  const file = identifier(path, "DIGITAL_LIFE_SECRET_FILE_REQUIRED", 1024);
  let info;
  try {
    info = lstatSync(file);
  } catch {
    return fail("DIGITAL_LIFE_SECRET_FILE_UNAVAILABLE");
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    return fail("DIGITAL_LIFE_SECRET_FILE_MUST_BE_REGULAR");
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    return fail("DIGITAL_LIFE_SECRET_FILE_PERMISSIONS");
  }
  const secret = readFileSync(file);
  if (secret.length < 32 || secret.length > 4096) {
    return fail("DIGITAL_LIFE_SECRET_LENGTH_INVALID");
  }
  return secret;
}

function messageDigest(tenantId: string, channel: string, accountId: string,
                      platformMessageId: string): string {
  return createHash("sha256").update(JSON.stringify([
    tenantId, channel, accountId, platformMessageId,
  ]), "utf8").digest("hex");
}

/**
 * Sends one already-authenticated direct WeCom message to AstrBot's existing
 * Lanvia social webhook. It never calls OpeniLink's personal-iLink sender.
 * A reply is returned to the caller only when AstrBot returns a Core-signed
 * receipt containing the original Core/UAC 3.2 reply grant.
 */
export class DigitalLifeIngress {
  private readonly url: URL;
  private readonly path: string;
  private readonly secret: Buffer;
  private readonly tenantId: string;
  private readonly accountId: string;
  private readonly channel: "wecom_bot" | "wecom_agent";
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly nonceFactory: () => string;

  constructor(config: DigitalLifeIngressConfig) {
    if (!config || typeof config !== "object") fail("DIGITAL_LIFE_CONFIG_REQUIRED");
    try {
      this.url = new URL(identifier(config.webhookUrl, "DIGITAL_LIFE_WEBHOOK_URL_REQUIRED", 2048));
    } catch {
      return fail("DIGITAL_LIFE_WEBHOOK_URL_INVALID");
    }
    if (this.url.protocol !== "https:" || this.url.username || this.url.password ||
        this.url.search || this.url.hash || !this.url.pathname.startsWith("/")) {
      fail("DIGITAL_LIFE_WEBHOOK_URL_MUST_BE_HTTPS_PATH_ONLY");
    }
    this.path = this.url.pathname;
    this.tenantId = identifier(config.tenantId, "DIGITAL_LIFE_TENANT_REQUIRED");
    this.accountId = identifier(config.accountId, "DIGITAL_LIFE_ACCOUNT_REQUIRED");
    this.channel = config.channel ?? "wecom_bot";
    if (this.channel !== "wecom_bot" && this.channel !== "wecom_agent") {
      fail("DIGITAL_LIFE_CHANNEL_INVALID");
    }
    this.secret = loadSecret(config.secretFile);
    this.timeoutMs = config.timeoutMs ?? 50000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 60000) {
      fail("DIGITAL_LIFE_TIMEOUT_INVALID");
    }
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") fail("DIGITAL_LIFE_FETCH_REQUIRED");
    this.now = config.now ?? Date.now;
    this.nonceFactory = config.nonceFactory ??
      (() => randomBytes(24).toString("base64url"));
  }

  async dispatch(message: WecomMessageData): Promise<DigitalLifeReply> {
    if (!message || typeof message !== "object") fail("WECOM_MESSAGE_REQUIRED");
    if (message.chatType !== "single") fail("WECOM_DIRECT_MESSAGE_REQUIRED");
    const botId = identifier(message.botId, "WECOM_BOT_ID_REQUIRED");
    if (botId !== this.accountId) fail("WECOM_BOT_ACCOUNT_MISMATCH");
    const userId = identifier(message.userId, "WECOM_SENDER_REQUIRED");
    const msgId = identifier(message.msgId, "WECOM_MESSAGE_ID_REQUIRED");
    if (message.conversationId !== userId) fail("WECOM_DIRECT_CONVERSATION_MISMATCH");
    if (message.msgType !== "text" && message.msgType !== "voice") {
      fail("WECOM_MESSAGE_TYPE_NOT_SUPPORTED");
    }
    const text = identifier(message.content, "WECOM_TEXT_REQUIRED", 4096);
    const messageId = messageDigest(this.tenantId, this.channel, this.accountId, msgId);
    const payload = {
      schema: REQUEST_SCHEMA,
      channel: this.channel,
      tenant_id: this.tenantId,
      account_id: this.accountId,
      conversation_id: userId,
      external_user_id: userId,
      message_id: msgId,
      text,
    };
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(this.now() / 1000));
    const nonce = this.nonceFactory();
    if (!/^\d{1,12}$/.test(timestamp) || !SAFE_NONCE.test(nonce)) {
      fail("DIGITAL_LIFE_REQUEST_BINDING_INVALID");
    }
    const canonical = Buffer.concat([
      Buffer.from(timestamp + ":" + nonce + ":" + this.path + ":", "utf8"),
      Buffer.from(raw, "utf8"),
    ]);
    const signature = "sha256=" + createHmac("sha256", this.secret)
      .update(canonical).digest("hex");

    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lanvia-Source": "wecom",
          "X-Lanvia-Social-Timestamp": timestamp,
          "X-Lanvia-Social-Nonce": nonce,
          "X-Lanvia-Social-Signature": signature,
        },
        body: raw,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
        cache: "no-store",
      });
    } catch (error) {
      throw Object.assign(new Error("DIGITAL_LIFE_WEBHOOK_UNAVAILABLE"), {
        cause: error,
      });
    }
    if (!response.ok) fail("DIGITAL_LIFE_WEBHOOK_HTTP_" + response.status);

    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      return fail("DIGITAL_LIFE_RESPONSE_JSON_INVALID");
    }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      fail("DIGITAL_LIFE_RESPONSE_INVALID");
    }
    const body = envelope as Record<string, unknown>;
    const receipt = body.receipt;
    const responseSignature = body.response_signature;
    if (body.ok !== true || !receipt || typeof receipt !== "object" ||
        Array.isArray(receipt) || typeof responseSignature !== "string" ||
        !SAFE_SIGNATURE.test(responseSignature)) {
      fail("DIGITAL_LIFE_SIGNED_RECEIPT_REQUIRED");
    }
    const responseCanonical = Buffer.concat([
      Buffer.from(timestamp + ":" + nonce + ":" + this.path + ":", "utf8"),
      Buffer.from(stableJson(receipt), "utf8"),
    ]);
    const expected = createHmac("sha256", this.secret).update(responseCanonical).digest();
    const supplied = Buffer.from(responseSignature.slice(7), "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      fail("DIGITAL_LIFE_RESPONSE_SIGNATURE_INVALID");
    }

    const result = receipt as Record<string, unknown>;
    if (result.channel !== this.channel || result.message_id !== messageId) {
      fail("DIGITAL_LIFE_RECEIPT_SCOPE_MISMATCH");
    }
    if (result.schema === DUPLICATE_SCHEMA) {
      if (result.duplicate !== true || result.digital_life_invocations !== 0 ||
          result.platform_sent !== false || result.runner_executed !== false ||
          result.memory_written !== false) {
        fail("DIGITAL_LIFE_DUPLICATE_RECEIPT_INVALID");
      }
      return {
        replyAuthorized: false, replyText: null, replyGrantId: null,
        duplicate: true, linked: false, receipt: result,
      };
    }
    if (result.schema === LINKED_SCHEMA) {
      if (result.linked !== true || result.digital_life_invocations !== 0 ||
          result.platform_sent !== false || result.runner_executed !== false ||
          result.memory_written !== false) {
        fail("DIGITAL_LIFE_LINK_RECEIPT_INVALID");
      }
      return {
        replyAuthorized: false, replyText: null, replyGrantId: null,
        duplicate: false, linked: true, receipt: result,
      };
    }
    if (result.schema !== DONE_SCHEMA || result.native_pipeline_completed !== true ||
        result.digital_life_invocations !== 1 || result.platform_sent !== false ||
        result.runner_executed !== false || result.memory_written !== false ||
        typeof result.owner_code !== "string" || !OWNER_CODE.test(result.owner_code)) {
      fail("DIGITAL_LIFE_COMPLETION_RECEIPT_INVALID");
    }
    if (result.reply_authorized !== true) {
      return {
        replyAuthorized: false, replyText: null, replyGrantId: null,
        duplicate: false, linked: false, receipt: result,
      };
    }
    const grantId = identifier(result.reply_grant_id, "DIGITAL_LIFE_REPLY_GRANT_REQUIRED");
    const replyText = identifier(result.reply_text, "DIGITAL_LIFE_REPLY_TEXT_REQUIRED", 4096);
    return {
      replyAuthorized: true, replyText, replyGrantId: grantId,
      duplicate: false, linked: false, receipt: result,
    };
  }
}
