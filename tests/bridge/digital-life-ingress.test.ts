import { afterEach, describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DigitalLifeIngress } from "../../src/bridge/digital-life-ingress.js";
import type { WecomMessageData } from "../../src/wecom/event.js";

const SECRET = Buffer.from("lanvia-social-bridge-secret-material-0123456789");
const NOW = 1_800_000_000_000;
const TIMESTAMP = String(Math.floor(NOW / 1000));
const NONCE = "nonce_0123456789abcdef";
const WEBHOOK_URL = "https://astrbot.example.test/api/platform/webhook/0123456789abcdef0123456789abcdef";
const PATH = new URL(WEBHOOK_URL).pathname;
const TEMP_DIRS: string[] = [];

function secretFile(mode = 0o600): string {
  const dir = mkdtempSync(join(tmpdir(), "wecom-digital-life-"));
  TEMP_DIRS.push(dir);
  const file = join(dir, "social-bridge.secret");
  writeFileSync(file, SECRET, { mode });
  chmodSync(file, mode);
  return file;
}

function message(overrides: Partial<WecomMessageData> = {}): WecomMessageData {
  return {
    conversationId: "wx-user-001",
    msgId: "wecom-msg-001",
    botId: "wecom-bot-001",
    chatType: "single",
    msgType: "text",
    content: "你好，Digital Life",
    userId: "wx-user-001",
    userName: "wx-user-001",
    frame: { headers: { req_id: "req-1" } },
    ...overrides,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map((key) =>
    JSON.stringify(key) + ":" + stableJson(obj[key])
  ).join(",") + "}";
}

function expectedMessageId(msgId = "wecom-msg-001"): string {
  return createHash("sha256").update(JSON.stringify([
    "tenant-a", "wecom_bot", "wecom-bot-001", msgId,
  ])).digest("hex");
}

function signReceipt(receipt: Record<string, unknown>, timestamp = TIMESTAMP,
                     nonce = NONCE, requestPath = PATH): string {
  const canonical = timestamp + ":" + nonce + ":" + requestPath + ":" + stableJson(receipt);
  return "sha256=" + createHmac("sha256", SECRET).update(canonical, "utf8").digest("hex");
}

function doneReceipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "LANVIA_SOCIAL_NATIVE_DRAFT_PROCESSED_V1",
    owner_code: "U001",
    channel: "wecom_bot",
    message_id: expectedMessageId(),
    native_pipeline_completed: true,
    digital_life_invocations: 1,
    platform_sent: false,
    runner_executed: false,
    memory_written: false,
    reply_authorized: true,
    reply_grant_id: "access-pass-record-001",
    reply_text: "你好，我是同一个 Digital Life。",
    ...overrides,
  };
}

function createIngress(receiptFactory: (request: {
  url: string; init: RequestInit; payload: Record<string, unknown>;
}) => Record<string, unknown>, options: {
  secretMode?: number; accountId?: string; fetchCalls?: { count: number };
} = {}) {
  const file = secretFile(options.secretMode ?? 0o600);
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (options.fetchCalls) options.fetchCalls.count++;
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const receipt = receiptFactory({
      url: String(input), init: init ?? {}, payload,
    });
    return new Response(JSON.stringify({
      ok: true,
      receipt,
      response_signature: signReceipt(receipt),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const ingress = new DigitalLifeIngress({
    webhookUrl: WEBHOOK_URL,
    tenantId: "tenant-a",
    accountId: options.accountId ?? "wecom-bot-001",
    secretFile: file,
    channel: "wecom_bot",
    fetchImpl: fetchImpl as typeof fetch,
    now: () => NOW,
    nonceFactory: () => NONCE,
  });
  return ingress;
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("DigitalLifeIngress", () => {
  it("sends a signed direct WeCom message to the AstrBot webhook and accepts only the Core-authorized reply", async () => {
    const calls = { count: 0 };
    const ingress = createIngress(({ url, init, payload }) => {
      expect(url).toBe(WEBHOOK_URL);
      expect(payload).toEqual({
        schema: "LANVIA_SOCIAL_TRANSPORT_EVENT_V1",
        channel: "wecom_bot",
        tenant_id: "tenant-a",
        account_id: "wecom-bot-001",
        conversation_id: "wx-user-001",
        external_user_id: "wx-user-001",
        message_id: "wecom-msg-001",
        text: "你好，Digital Life",
      });
      const headers = new Headers(init.headers);
      expect(headers.get("X-Lanvia-Source")).toBe("wecom");
      expect(headers.get("X-Lanvia-Social-Timestamp")).toBe(TIMESTAMP);
      expect(headers.get("X-Lanvia-Social-Nonce")).toBe(NONCE);
      const raw = String(init.body);
      const canonical = TIMESTAMP + ":" + NONCE + ":" + PATH + ":" + raw;
      const expected = "sha256=" + createHmac("sha256", SECRET).update(canonical, "utf8").digest("hex");
      expect(headers.get("X-Lanvia-Social-Signature")).toBe(expected);
      return doneReceipt();
    }, { fetchCalls: calls });

    const result = await ingress.dispatch(message());
    expect(calls.count).toBe(1);
    expect(result.replyAuthorized).toBe(true);
    expect(result.replyText).toBe("你好，我是同一个 Digital Life。");
    expect(result.replyGrantId).toBe("access-pass-record-001");
    expect(result.duplicate).toBe(false);
  });

  it("preserves multiline text and accepts the SDK's voice transcription", async () => {
    const ingress = createIngress(({ payload }) => {
      const messageId = createHash("sha256").update(JSON.stringify([
        "tenant-a", String(payload.channel), String(payload.account_id),
        String(payload.message_id),
      ])).digest("hex");
      return doneReceipt({
        message_id: messageId,
        reply_authorized: false,
        reply_grant_id: null,
        reply_text: null,
      });
    });
    const multiline = await ingress.dispatch(message({ content: "第一行\n第二行" }));
    expect(multiline.replyAuthorized).toBe(false);
    const voice = await ingress.dispatch(message({
      msgId: "wecom-msg-voice",
      msgType: "voice",
      content: "这是企业微信语音识别出来的文字",
    }));
    expect(voice.replyAuthorized).toBe(false);
  });

  it("acknowledges a duplicate without asking the channel to reply again", async () => {
    const ingress = createIngress(() => ({
      schema: "LANVIA_SOCIAL_DUPLICATE_ACK_V1",
      channel: "wecom_bot",
      message_id: expectedMessageId(),
      duplicate: true,
      digital_life_invocations: 0,
      platform_sent: false,
      runner_executed: false,
      memory_written: false,
    }));
    const result = await ingress.dispatch(message());
    expect(result.duplicate).toBe(true);
    expect(result.replyAuthorized).toBe(false);
    expect(result.replyText).toBeNull();
  });

  it("accepts a Core identity-link receipt without sending a reply", async () => {
    const ingress = createIngress(() => ({
      schema: "LANVIA_SOCIAL_IDENTITY_LINKED_ACK_V1",
      channel: "wecom_bot",
      message_id: expectedMessageId(),
      linked: true,
      digital_life_invocations: 0,
      platform_sent: false,
      runner_executed: false,
      memory_written: false,
    }));
    const result = await ingress.dispatch(message({ content: "LINK CODE" }));
    expect(result.linked).toBe(true);
    expect(result.replyAuthorized).toBe(false);
  });

  it("does not send a reply when Core has not authorized the draft", async () => {
    const ingress = createIngress(() => doneReceipt({
      reply_authorized: false,
      reply_grant_id: null,
      reply_text: null,
    }));
    const result = await ingress.dispatch(message());
    expect(result.replyAuthorized).toBe(false);
    expect(result.replyText).toBeNull();
    expect(result.replyGrantId).toBeNull();
  });

  it("rejects group chat, unknown media, and a mismatched BotID before network access", async () => {
    const calls = { count: 0 };
    const ingress = createIngress(() => doneReceipt(), { fetchCalls: calls });
    await expect(ingress.dispatch(message({ chatType: "group" })))
      .rejects.toThrow("WECOM_DIRECT_MESSAGE_REQUIRED");
    await expect(ingress.dispatch(message({ msgType: "image", content: "[图片]" })))
      .rejects.toThrow("WECOM_MESSAGE_TYPE_NOT_SUPPORTED");
    await expect(ingress.dispatch(message({ botId: "foreign-bot" })))
      .rejects.toThrow("WECOM_BOT_ACCOUNT_MISMATCH");
    expect(calls.count).toBe(0);
  });

  it("rejects a forged AstrBot response signature", async () => {
    const file = secretFile();
    const fetchImpl = async () => new Response(JSON.stringify({
      ok: true,
      receipt: doneReceipt(),
      response_signature: "sha256=" + "0".repeat(64),
    }), { status: 200 });
    const ingress = new DigitalLifeIngress({
      webhookUrl: WEBHOOK_URL, tenantId: "tenant-a", accountId: "wecom-bot-001",
      secretFile: file, fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW, nonceFactory: () => NONCE,
    });
    await expect(ingress.dispatch(message()))
      .rejects.toThrow("DIGITAL_LIFE_RESPONSE_SIGNATURE_INVALID");
  });

  it("rejects a secret file with group or world permissions", () => {
    const file = secretFile(0o644);
    expect(() => new DigitalLifeIngress({
      webhookUrl: WEBHOOK_URL, tenantId: "tenant-a", accountId: "wecom-bot-001",
      secretFile: file,
    })).toThrow("DIGITAL_LIFE_SECRET_FILE_PERMISSIONS");
  });
});
