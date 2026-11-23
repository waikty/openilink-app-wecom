import { describe, expect, it } from "vitest";
import { registerWecomEvents } from "../src/wecom/event.js";

function capture() {
  const handlers = new Map<string, (frame: any) => void>();
  let resolve!: (value: any) => void;
  const received = new Promise<any>((done) => { resolve = done; });
  const ws = {
    on(name: string, handler: (frame: any) => void) {
      handlers.set(name, handler);
    },
  };
  registerWecomEvents(ws, async (message) => resolve(message));
  return { handlers, received };
}

describe("WeCom SDK frame normalization", () => {
  it("uses the official single-chat frame fields and preserves the sender identity", async () => {
    const { handlers, received } = capture();
    handlers.get("message.text")?.({
      headers: { req_id: "req-1" },
      body: {
        msgid: "message-1",
        aibotid: "bot-1",
        chattype: "single",
        from: { userid: "user-1" },
        text: { content: "hello" },
        msgtype: "text",
      },
    });
    const message = await received;
    expect(message).toMatchObject({
      conversationId: "user-1",
      msgId: "message-1",
      userId: "user-1",
      messageScope: "direct",
      msgType: "text",
      content: "hello",
      hasUnsupportedMedia: false,
    });
  });

  it("marks official group-chat frames as group instead of treating them as private Owner messages", async () => {
    const { handlers, received } = capture();
    handlers.get("message.text")?.({
      body: {
        msgid: "message-2",
        chattype: "group",
        chatid: "group-1",
        from: { userid: "user-1" },
        text: { content: "hello group" },
      },
    });
    const message = await received;
    expect(message).toMatchObject({
      conversationId: "group-1",
      userId: "user-1",
      messageScope: "group",
    });
  });

  it("uses only WeCom's transcribed voice content, never an encrypted voice URL", async () => {
    const { handlers, received } = capture();
    handlers.get("message.voice")?.({
      body: {
        msgid: "message-3",
        chattype: "single",
        from: { userid: "user-1" },
        voice: { content: "请帮我查一下日程", url: "https://invalid.example/encrypted" },
      },
    });
    const message = await received;
    expect(message.content).toBe("请帮我查一下日程");
    expect(message.hasUnsupportedMedia).toBe(false);
  });

  it("fails closed for an unknown chat type", async () => {
    const { handlers, received } = capture();
    handlers.get("message.text")?.({
      body: {
        msgid: "message-4",
        chattype: "unknown",
        from: { userid: "user-1" },
        text: { content: "hello" },
      },
    });
    expect((await received).messageScope).toBe("unknown");
  });

  it("does not leak encrypted media URLs to the text-only Digital Life path", async () => {
    const { handlers, received } = capture();
    handlers.get("message.image")?.({
      body: {
        msgid: "message-5",
        chattype: "single",
        from: { userid: "user-1" },
        image: { url: "https://invalid.example/encrypted", aeskey: "encrypted-key" },
      },
    });
    const message = await received;
    expect(message.hasUnsupportedMedia).toBe(true);
    expect(message.content).toBe("");
  });
});
