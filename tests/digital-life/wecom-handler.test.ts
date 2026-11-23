import { describe, expect, it, vi } from "vitest";
import { handleWecomMessageWithDigitalLife } from "../../src/digital-life/wecom-handler.js";
import type { WecomMessageData } from "../../src/wecom/event.js";

function msg(overrides: Partial<WecomMessageData> = {}): WecomMessageData {
  return {
    conversationId: "wecom-user-1",
    msgId: "wecom-msg-1",
    msgType: "text",
    content: "hello",
    userId: "wecom-user-1",
    userName: "",
    messageScope: "direct",
    frame: { headers: { req_id: "req-1" } },
    ...overrides,
  };
}

describe("WeCom → Digital Life handler", () => {
  it("sends the private message to the shared brain and replies only with a Core grant", async () => {
    const social = {
      dispatch: vi.fn().mockResolvedValue({
        status: "reply-authorized",
        channel: "wecom_bot",
        messageId: "a".repeat(64),
        ownerCode: "U001",
        replyText: "Digital Life answer",
        grantId: "core-access-pass-1",
      }),
    };
    const wecom = { replyStream: vi.fn().mockResolvedValue(undefined) };
    const result = await handleWecomMessageWithDigitalLife(
      social as any, wecom as any, "wecom-bot-1", msg(),
    );
    expect(social.dispatch).toHaveBeenCalledWith({
      channel: "wecom_bot",
      messageScope: "direct",
      accountId: "wecom-bot-1",
      conversationId: "wecom-user-1",
      externalUserId: "wecom-user-1",
      platformMessageId: "wecom-msg-1",
      text: "hello",
    });
    expect(wecom.replyStream).toHaveBeenCalledWith(
      { headers: { req_id: "req-1" } }, "Digital Life answer",
    );
    expect(result).toEqual({ status: "replied", grantId: "core-access-pass-1" });
  });

  it("does not send private messages from group conversations into Owner memory", async () => {
    const social = { dispatch: vi.fn() };
    const wecom = { replyStream: vi.fn() };
    const result = await handleWecomMessageWithDigitalLife(
      social as any, wecom as any, "wecom-bot-1",
      msg({ messageScope: "group", conversationId: "group-1" }),
    );
    expect(result).toEqual({ status: "ignored", reason: "group" });
    expect(social.dispatch).not.toHaveBeenCalled();
    expect(wecom.replyStream).not.toHaveBeenCalled();
  });

  it("does not treat media URLs or placeholders as ordinary text", async () => {
    const social = { dispatch: vi.fn() };
    const wecom = { replyStream: vi.fn() };
    const result = await handleWecomMessageWithDigitalLife(
      social as any, wecom as any, "wecom-bot-1",
      msg({ msgType: "image", content: "https://encrypted-media.invalid/image" }),
    );
    expect(result).toEqual({ status: "ignored", reason: "unsupported-message" });
    expect(social.dispatch).not.toHaveBeenCalled();
  });

  it("does not reply when Core has not granted the social Access Pass", async () => {
    const social = {
      dispatch: vi.fn().mockResolvedValue({
        status: "reply-blocked",
        channel: "wecom_bot",
        messageId: "a".repeat(64),
        ownerCode: "U001",
      }),
    };
    const wecom = { replyStream: vi.fn() };
    const result = await handleWecomMessageWithDigitalLife(
      social as any, wecom as any, "wecom-bot-1", msg(),
    );
    expect(result).toEqual({ status: "reply-blocked" });
    expect(wecom.replyStream).not.toHaveBeenCalled();
  });

  it("does not reply twice when AstrBot acknowledges a duplicate", async () => {
    const social = {
      dispatch: vi.fn().mockResolvedValue({
        status: "duplicate", channel: "wecom_bot", messageId: "a".repeat(64),
      }),
    };
    const wecom = { replyStream: vi.fn() };
    const result = await handleWecomMessageWithDigitalLife(
      social as any, wecom as any, "wecom-bot-1", msg(),
    );
    expect(result).toEqual({ status: "duplicate" });
    expect(wecom.replyStream).not.toHaveBeenCalled();
  });
});
