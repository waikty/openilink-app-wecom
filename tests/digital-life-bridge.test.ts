import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  DigitalLifeBridgeClient,
  signDigitalLifeResponse,
  type DigitalLifeBridgeConfig,
} from "../src/lanvia/digital-life.js";
import type { WecomMessageData } from "../src/wecom/event.js";

const SECRET = "isolated-test-social-bridge-secret-0123456789";
const NOW = 1_800_000_000_000;
const NONCE = "test_nonce_0123456789abcdef";
const WEBHOOK = "http://astrbot:6185/api/platform/webhook/0123456789abcdef0123456789abcdef";

const config: DigitalLifeBridgeConfig = {
  webhookUrl: WEBHOOK,
  tenantId: "tenant-owner-001",
  accountId: "wecom-bot-001",
  channel: "wecom_bot",
  secret: SECRET,
};

const message: WecomMessageData = {
  conversationId: "wecom-user-001",
  msgId: "wxwork-message-001",
  msgType: "text",
  content: "你好，小兰",
  userId: "wecom-user-001",
  userName: "",
  messageScope: "direct",
  hasUnsupportedMedia: false,
  frame: {},
};

function response(receipt: Record<string, unknown>, signature = true) {
  const responseSignature = signDigitalLifeResponse(
    receipt, SECRET, String(NOW / 1000), NONCE,
    new URL(WEBHOOK).pathname,
  );
  return new Response(JSON.stringify({
    ok: true,
    receipt,
    response_signature: signature ? responseSignature : "sha256=" + "0".repeat(64),
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function completed(overrides: Record<string, unknown> = {}) {
  return {
    schema: "LANVIA_SOCIAL_NATIVE_DRAFT_PROCESSED_V1",
    owner_code: "U001",
    channel: "wecom_bot",
    message_id: "a".repeat(64),
    native_pipeline_completed: true,
    digital_life_invocations: 1,
    platform_sent: false,
    runner_executed: false,
    memory_written: false,
    reply_authorized: true,
    reply_grant_id: "access-pass-social-001",
    reply_text: "你好，我是统一的 Digital Life。",
    digital_life_receipt: {
      schema: "LANVIA_DIGITAL_LIFE_ASTRBOT_HANDLED_V1",
      brain: "Digital Life",
    },
    ...overrides,
  };
}

describe("DigitalLifeBridgeClient", () => {
  it("posts the normalized direct message to the existing AstrBot webhook and accepts a Core-signed reply", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const raw = String(init?.body || "");
      const expected = createHmac("sha256", SECRET)
        .update(Buffer.from(
          headers.get("X-Lanvia-Social-Timestamp") + ":" +
          headers.get("X-Lanvia-Social-Nonce") + ":" +
          new URL(WEBHOOK).pathname + ":" + raw,
          "utf8",
        ))
        .digest("hex");
      expect(headers.get("X-Lanvia-Social-Signature")).toBe("sha256=" + expected);
      expect(headers.get("X-Lanvia-Source")).toBe("wecom");
      expect(JSON.parse(raw)).toEqual({
        schema: "LANVIA_SOCIAL_TRANSPORT_EVENT_V1",
        channel: "wecom_bot",
        message_scope: "direct",
        tenant_id: "tenant-owner-001",
        account_id: "wecom-bot-001",
        conversation_id: "wecom-user-001",
        external_user_id: "wecom-user-001",
        message_id: "wxwork-message-001",
        text: "你好，小兰",
      });
      return response(completed());
    });
    const client = new DigitalLifeBridgeClient(config, {
      fetchImpl,
      now: () => NOW,
      makeNonce: () => NONCE,
    });
    const result = await client.dispatch(message);
    expect(result).toEqual({
      status: "replied",
      messageId: "a".repeat(64),
      replyText: "你好，我是统一的 Digital Life。",
      replyGrantId: "access-pass-social-001",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never sends a group message to the Owner's private Digital Life session", async () => {
    const fetchImpl = vi.fn();
    const client = new DigitalLifeBridgeClient(config, { fetchImpl: fetchImpl as any });
    const result = await client.dispatch({ ...message, messageScope: "group" });
    expect(result).toEqual({ status: "ignored", reason: "DIRECT_MESSAGE_ONLY" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not pretend image/file/video payloads are plain text", async () => {
    const fetchImpl = vi.fn();
    const client = new DigitalLifeBridgeClient(config, { fetchImpl: fetchImpl as any });
    const result = await client.dispatch({ ...message, msgType: "image", hasUnsupportedMedia: true });
    expect(result).toEqual({ status: "ignored", reason: "MEDIA_PAYLOAD_NOT_CONNECTED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a signed durable receipt but does not send when Core denies outbound reply", async () => {
    const fetchImpl = vi.fn(async () => response(completed({
      reply_authorized: false,
      reply_grant_id: null,
      reply_text: null,
    })));
    const client = new DigitalLifeBridgeClient(config, {
      fetchImpl: fetchImpl as any, now: () => NOW, makeNonce: () => NONCE,
    });
    expect(await client.dispatch(message)).toMatchObject({ status: "received" });
  });

  it("acknowledges a duplicate without sending a second reply", async () => {
    const fetchImpl = vi.fn(async () => response({
      schema: "LANVIA_SOCIAL_DUPLICATE_ACK_V1",
      duplicate: true,
      channel: "wecom_bot",
      message_id: "b".repeat(64),
      digital_life_invocations: 0,
      platform_sent: false,
      runner_executed: false,
      memory_written: false,
    }));
    const client = new DigitalLifeBridgeClient(config, {
      fetchImpl: fetchImpl as any, now: () => NOW, makeNonce: () => NONCE,
    });
    expect(await client.dispatch(message)).toMatchObject({ status: "duplicate" });
  });

  it("acknowledges Core-verified account linking without invoking the AI", async () => {
    const fetchImpl = vi.fn(async () => response({
      schema: "LANVIA_SOCIAL_IDENTITY_LINKED_ACK_V1",
      linked: true,
      channel: "wecom_bot",
      message_id: "c".repeat(64),
      digital_life_invocations: 0,
      platform_sent: false,
      runner_executed: false,
      memory_written: false,
    }));
    const client = new DigitalLifeBridgeClient(config, {
      fetchImpl: fetchImpl as any, now: () => NOW, makeNonce: () => NONCE,
    });
    expect(await client.dispatch(message)).toMatchObject({ status: "linked" });
  });

  it("rejects unsigned or altered response receipts", async () => {
    const fetchImpl = vi.fn(async () => response(completed(), false));
    const client = new DigitalLifeBridgeClient(config, {
      fetchImpl: fetchImpl as any, now: () => NOW, makeNonce: () => NONCE,
    });
    await expect(client.dispatch(message)).rejects.toThrow(
      "DIGITAL_LIFE_RESPONSE_SIGNATURE_INVALID",
    );
  });

  it("rejects reply text if the Core grant is missing or malformed", async () => {
    const fetchImpl = vi.fn(async () => response(completed({ reply_grant_id: null })));
    const client = new DigitalLifeBridgeClient(config, {
      fetchImpl: fetchImpl as any, now: () => NOW, makeNonce: () => NONCE,
    });
    await expect(client.dispatch(message)).rejects.toThrow("CORE_SOCIAL_REPLY_GRANT_INVALID");
  });

  it("fails closed on incomplete webhook or secret configuration", () => {
    expect(() => new DigitalLifeBridgeClient({ ...config, secret: "short" }))
      .toThrow("SOCIAL_BRIDGE_SECRET_TOO_SHORT");
    expect(() => new DigitalLifeBridgeClient({
      ...config, webhookUrl: "https://example.com/webhook",
    })).toThrow("DIGITAL_LIFE_WEBHOOK_URL_INVALID");
    expect(() => new DigitalLifeBridgeClient({
      ...config, channel: "kf" as any,
    })).toThrow("SOCIAL_CHANNEL_INVALID");
  });

  it("rejects provider HTTP failures without fallback", async () => {
    const fetchImpl = vi.fn(async () => new Response("blocked", { status: 503 }));
    const client = new DigitalLifeBridgeClient(config, {
      fetchImpl: fetchImpl as any, now: () => NOW, makeNonce: () => NONCE,
    });
    await expect(client.dispatch(message)).rejects.toThrow("DIGITAL_LIFE_INGRESS_HTTP_503");
  });
});
