import { describe, expect, it, vi } from "vitest";
import { handleIlinkHubEventWithDigitalLife } from "../../src/digital-life/ilink-handler.js";
import type { HubEvent, Installation } from "../../src/hub/types.js";

const installation: Installation = {
  id: "install-1",
  hubUrl: "https://hub.example",
  appId: "app-1",
  botId: "hub-bot-1",
  appToken: "hub-app-token",
  webhookSecret: "hub-webhook-secret",
};

function event(data: Record<string, unknown> = {}): HubEvent {
  return {
    v: "1",
    type: "event",
    trace_id: "trace-1",
    installation_id: installation.id,
    bot: { id: installation.botId },
    event: {
      type: "message.text",
      id: "hub-message-1",
      timestamp: "1800000000",
      data: {
        user_id: "wx-user-1",
        conversation_id: "wx-user-1",
        text: "hello from personal WeChat",
        ...data,
      },
    },
  };
}

describe("iLink → Digital Life handler", () => {
  it("routes verified personal iLink events to the same Digital Life and returns to the same user", async () => {
    const social = {
      dispatch: vi.fn().mockResolvedValue({
        status: "reply-authorized",
        channel: "ilink",
        messageId: "a".repeat(64),
        ownerCode: "U001",
        replyText: "One shared AI answer",
        grantId: "core-access-pass-1",
      }),
    };
    const hub = { sendText: vi.fn().mockResolvedValue(undefined) };
    const result = await handleIlinkHubEventWithDigitalLife(
      social as any, hub as any, event(), installation,
    );
    expect(social.dispatch).toHaveBeenCalledWith({
      channel: "ilink",
      messageScope: "direct",
      accountId: "hub-bot-1",
      conversationId: "wx-user-1",
      externalUserId: "wx-user-1",
      platformMessageId: "hub-message-1",
      text: "hello from personal WeChat",
    });
    expect(hub.sendText).toHaveBeenCalledWith(
      "wx-user-1", "One shared AI answer", "trace-1",
    );
    expect(result).toEqual({ status: "replied", grantId: "core-access-pass-1" });
  });

  it("does not send group events into the private Owner memory", async () => {
    const social = { dispatch: vi.fn() };
    const hub = { sendText: vi.fn() };
    const result = await handleIlinkHubEventWithDigitalLife(
      social as any, hub as any, event({ group: { id: "group-1" } }), installation,
    );
    expect(result).toEqual({ status: "ignored", reason: "group" });
    expect(social.dispatch).not.toHaveBeenCalled();
    expect(hub.sendText).not.toHaveBeenCalled();
  });

  it("rejects a Hub event whose Bot identity differs from the installed Bot", async () => {
    const social = { dispatch: vi.fn() };
    const hub = { sendText: vi.fn() };
    const probe = event();
    probe.bot.id = "another-bot";
    const result = await handleIlinkHubEventWithDigitalLife(
      social as any, hub as any, probe, installation,
    );
    expect(result).toEqual({ status: "ignored", reason: "sender-mismatch" });
    expect(social.dispatch).not.toHaveBeenCalled();
  });

  it("does not send a second reply for a durable duplicate", async () => {
    const social = {
      dispatch: vi.fn().mockResolvedValue({
        status: "duplicate", channel: "ilink", messageId: "a".repeat(64),
      }),
    };
    const hub = { sendText: vi.fn() };
    const result = await handleIlinkHubEventWithDigitalLife(
      social as any, hub as any, event(), installation,
    );
    expect(result).toEqual({ status: "duplicate" });
    expect(hub.sendText).not.toHaveBeenCalled();
  });

  it("does not reply when Core has not granted social reply permission", async () => {
    const social = {
      dispatch: vi.fn().mockResolvedValue({
        status: "reply-blocked", channel: "ilink", messageId: "a".repeat(64),
        ownerCode: "U001",
      }),
    };
    const hub = { sendText: vi.fn() };
    const result = await handleIlinkHubEventWithDigitalLife(
      social as any, hub as any, event(), installation,
    );
    expect(result).toEqual({ status: "reply-blocked" });
    expect(hub.sendText).not.toHaveBeenCalled();
  });
});
