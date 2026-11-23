import { describe, expect, it } from "vitest";
import { registerWecomEvents } from "../../src/wecom/event.js";

function register() {
  const handlers = new Map<string, (frame: any) => void>();
  const received: any[] = [];
  registerWecomEvents({
    on: (name: string, handler: (frame: any) => void) => handlers.set(name, handler),
  }, (message) => received.push(message));
  return { handlers, received };
}

describe("WeCom SDK message normalization", () => {
  it("uses the official SDK single-chat fields msgid/aibotid/chattype/from.userid", () => {
    const { handlers, received } = register();
    handlers.get("message.text")?.({
      headers: { req_id: "req-1" },
      body: {
        msgid: "msg-001",
        aibotid: "bot-001",
        chattype: "single",
        from: { userid: "external-user-001" },
        msgtype: "text",
        text: { content: "你好" },
      },
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      conversationId: "external-user-001",
      msgId: "msg-001",
      botId: "bot-001",
      chatType: "single",
      msgType: "text",
      content: "你好",
      userId: "external-user-001",
    });
  });

  it("marks group chat explicitly and keeps the group chatid separate from sender", () => {
    const { handlers, received } = register();
    handlers.get("message.text")?.({
      headers: { req_id: "req-2" },
      body: {
        msgid: "msg-002",
        aibotid: "bot-001",
        chattype: "group",
        chatid: "group-001",
        from: { userid: "external-user-002" },
        msgtype: "text",
        text: { content: "群消息" },
      },
    });
    expect(received[0]).toMatchObject({
      conversationId: "group-001",
      userId: "external-user-002",
      chatType: "group",
    });
  });

  it("uses the SDK voice.content transcription, not a nonexistent voice.url", () => {
    const { handlers, received } = register();
    handlers.get("message.voice")?.({
      headers: { req_id: "req-3" },
      body: {
        msgid: "msg-003",
        aibotid: "bot-001",
        chattype: "single",
        from: { userid: "external-user-003" },
        msgtype: "voice",
        voice: { content: "这是语音转写文本" },
      },
    });
    expect(received[0]).toMatchObject({
      msgType: "voice",
      content: "这是语音转写文本",
    });
  });
});
