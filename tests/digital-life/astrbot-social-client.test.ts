import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AstrBotSocialClient,
  type DigitalLifeChannel,
  type SocialInboundMessage,
} from "../../src/digital-life/astrbot-social-client.js";

const SECRET = "test-only-social-bridge-secret-which-is-long-enough";
const TENANT = "tenant-a";
const URL = "http://astrbot:6185/api/platform/webhook/0123456789abcdef0123456789abcdef";
const PATH = new URL(URL).pathname;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) =>
    JSON.stringify(key) + ":" + stableJson(record[key])
  ).join(",") + "}";
}

function sign(timestamp: string, nonce: string, body: string): string {
  return "sha256=" + createHmac("sha256", SECRET)
    .update(timestamp + ":" + nonce + ":" + PATH + ":" + body, "utf8")
    .digest("hex");
}

function message(channel: DigitalLifeChannel = "wecom_bot"): SocialInboundMessage {
  return {
    channel,
    messageScope: "direct",
    accountId: channel === "ilink" ? "hub-bot-a" : "wecom-bot-a",
    conversationId: "conversation-a",
    externalUserId: "external-user-a",
    platformMessageId: "platform-msg-a",
    text: "hello Digital Life",
  };
}

function messageId(input: SocialInboundMessage): string {
  return createHash("sha256")
    .update(JSON.stringify([
      TENANT, input.channel, input.accountId, input.platformMessageId,
    ]), "utf8")
    .digest("hex");
}

function makeReceipt(input: SocialInboundMessage, receiptOverrides: Record<string, unknown> = {}) {
  return {
    schema: "LANVIA_SOCIAL_NATIVE_DRAFT_PROCESSED_V1",
    owner_code: "U001",
    channel: input.channel,
    message_id: messageId(input),
    native_pipeline_completed: true,
    digital_life_invocations: 1,
    platform_sent: false,
    runner_executed: false,
    memory_written: false,
    reply_authorized: true,
    reply_grant_id: "core-access-pass-123",
    reply_text: "A single Digital Life reply",
    ...receiptOverrides,
  };
}

function queueSignedResponse(
  fetcher: ReturnType<typeof vi.fn>,
  receipt: Record<string, unknown>,
  overrides: { signature?: string } = {},
) {
  fetcher.mockImplementationOnce(async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const responseSignature = overrides.signature ??
      sign(
        headers["X-Lanvia-Social-Timestamp"],
        headers["X-Lanvia-Social-Nonce"],
        stableJson(receipt),
      );
    return new Response(JSON.stringify({
      ok: true, receipt, response_signature: responseSignature,
    }), { status: 200 });
  });
}

describe("AstrBotSocialClient", () => {
  let fetcher: ReturnType<typeof vi.fn>;
  let client: AstrBotSocialClient;

  beforeEach(() => {
    fetcher = vi.fn();
    client = new AstrBotSocialClient({
      webhookUrl: URL,
      bridgeSecret: SECRET,
      tenantId: TENANT,
      fetcher: fetcher as unknown as typeof fetch,
    });
  });

  it("sends signed direct WeCom messages and accepts only Core-authorized reply drafts", async () => {
    const input = message("wecom_bot");
    const receipt = makeReceipt(input);
    queueSignedResponse(fetcher, receipt);

    const reply = await client.dispatch(input);
    expect(reply).toEqual({
      status: "reply-authorized",
      channel: "wecom_bot",
      messageId: messageId(input),
      ownerCode: "U001",
      replyText: "A single Digital Life reply",
      grantId: "core-access-pass-123",
    });

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL);
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      schema: "LANVIA_SOCIAL_TRANSPORT_EVENT_V1",
      channel: "wecom_bot",
      message_scope: "direct",
      tenant_id: TENANT,
      account_id: "wecom-bot-a",
      conversation_id: "conversation-a",
      external_user_id: "external-user-a",
      message_id: "platform-msg-a",
      text: "hello Digital Life",
    });
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Lanvia-Source"]).toBe("wecom");
    expect(headers["X-Lanvia-Social-Signature"]).toBe(
      sign(headers["X-Lanvia-Social-Timestamp"], headers["X-Lanvia-Social-Nonce"], String(init.body)),
    );
  });

  it("uses the verified OpeniLink source for personal iLink messages", async () => {
    const input = message("ilink");
    const receipt = makeReceipt(input);
    queueSignedResponse(fetcher, receipt);
    const reply = await client.dispatch(input);
    expect(reply.status).toBe("reply-authorized");
    const headers = fetcher.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Lanvia-Source"]).toBe("openilink");
  });

  it("never returns a sendable reply when Core has not granted the social Access Pass", async () => {
    const input = message();
    const receipt = makeReceipt(input, {
      reply_authorized: false,
      reply_grant_id: null,
      reply_text: null,
    });
    queueSignedResponse(fetcher, receipt);
    expect(await client.dispatch(input)).toEqual({
      status: "reply-blocked",
      channel: "wecom_bot",
      messageId: messageId(input),
      ownerCode: "U001",
    });
  });

  it("acknowledges duplicate delivery without sending a second reply", async () => {
    const input = message();
    const receipt = {
      schema: "LANVIA_SOCIAL_DUPLICATE_ACK_V1",
      channel: input.channel,
      message_id: messageId(input),
      duplicate: true,
      digital_life_invocations: 0,
      platform_sent: false,
      runner_executed: false,
      memory_written: false,
    };
    queueSignedResponse(fetcher, receipt);
    expect(await client.dispatch(input)).toEqual({
      status: "duplicate",
      channel: "wecom_bot",
      messageId: messageId(input),
    });
  });

  it("rejects forged response signatures", async () => {
    const input = message();
    const receipt = makeReceipt(input);
    queueSignedResponse(fetcher, receipt, {
      signature: "sha256=" + "0".repeat(64),
    });
    await expect(client.dispatch(input)).rejects.toThrow(
      "ASTRBOT_SOCIAL_RESPONSE_SIGNATURE_INVALID",
    );
  });

  it("rejects a response for another channel or another message", async () => {
    const input = message();
    for (const override of (
      [{ channel: "wecom_agent" }, { message_id: "f".repeat(64) }]
    )) {
      const receipt = makeReceipt(input, override);
      queueSignedResponse(fetcher, receipt);
      await expect(client.dispatch(input)).rejects.toThrow(
        "ASTRBOT_SOCIAL_RECEIPT_SCOPE_MISMATCH",
      );
    }
  });

  it("rejects group conversations before sending to the private memory pipeline", async () => {
    await expect(client.dispatch({
      ...message(),
      messageScope: "group",
    })).rejects.toThrow("SOCIAL_DIRECT_MESSAGE_REQUIRED");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires a strong bridge secret and an exact AstrBot webhook path", () => {
    expect(() => new AstrBotSocialClient({
      webhookUrl: URL, bridgeSecret: "short", tenantId: TENANT,
    })).toThrow("ASTRBOT_SOCIAL_BRIDGE_SECRET_TOO_SHORT");
    expect(() => new AstrBotSocialClient({
      webhookUrl: "http://astrbot:6185/other/path",
      bridgeSecret: SECRET, tenantId: TENANT,
    })).toThrow("ASTRBOT_SOCIAL_WEBHOOK_PATH_INVALID");
  });
});
