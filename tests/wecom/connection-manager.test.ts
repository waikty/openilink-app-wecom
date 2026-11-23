import { describe, expect, it, vi } from "vitest";
import { WecomConnectionManager } from "../../src/wecom/connection-manager.js";

function installation(id: string) {
  return {
    id, hubUrl: "https://hub.example", appId: "app",
    botId: "hub-bot", appToken: "hub-token-" + id,
    webhookSecret: "hub-webhook-secret",
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function fakeClient() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getWSClient: vi.fn().mockReturnValue({ ws: true }),
  } as any;
}

describe("WecomConnectionManager", () => {
  it("loads each installation's encrypted Bot credentials and starts its own connection", async () => {
    const inst = installation("install-1");
    const store = {
      getAllInstallations: () => [inst],
      getInstallation: (id: string) => id === inst.id ? inst : undefined,
      getConfig: vi.fn().mockReturnValue({
        wecom_bot_id: "wecom-bot-1",
        wecom_bot_secret: "wecom-secret-1",
      }),
    };
    const client = fakeClient();
    const onMessage = vi.fn().mockResolvedValue(undefined);
    let eventHandler: ((message: any) => Promise<void>) | undefined;
    const manager = new WecomConnectionManager({
      store: store as any,
      onMessage,
      createClient: vi.fn().mockReturnValue(client),
      registerEvents: vi.fn((_ws, callback) => { eventHandler = callback; }),
    });

    expect(await manager.startAll()).toEqual({ connected: 1, skipped: 0 });
    expect(store.getConfig).toHaveBeenCalledWith(inst.id, inst.appToken);
    expect(client.start).toHaveBeenCalledOnce();
    expect(manager.getStatus()).toEqual([{
      installationId: inst.id, botId: "wecom-bot-1", connected: true,
    }]);

    const message = { msgType: "text", messageScope: "direct" };
    await eventHandler?.(message);
    expect(onMessage).toHaveBeenCalledWith(inst, "wecom-bot-1", client, message);
  });

  it("does not start a Bot when encrypted credentials are absent", async () => {
    const inst = installation("install-empty");
    const client = fakeClient();
    const manager = new WecomConnectionManager({
      store: {
        getAllInstallations: () => [inst],
        getInstallation: () => inst,
        getConfig: () => ({}),
      } as any,
      onMessage: vi.fn(),
      createClient: vi.fn().mockReturnValue(client),
    });
    expect(await manager.startAll()).toEqual({ connected: 0, skipped: 1 });
    expect(client.start).not.toHaveBeenCalled();
    expect(manager.getStatus()).toEqual([]);
  });

  it("restarts only the changed installation after settings are saved", async () => {
    const inst = installation("install-rotate");
    let secret = "secret-old";
    const clients: any[] = [];
    const manager = new WecomConnectionManager({
      store: {
        getAllInstallations: () => [inst],
        getInstallation: () => inst,
        getConfig: () => ({
          wecom_bot_id: "wecom-bot-1",
          wecom_bot_secret: secret,
        }),
      } as any,
      onMessage: vi.fn(),
      createClient: () => {
        const client = fakeClient();
        clients.push(client);
        return client;
      },
      registerEvents: () => {},
    });
    await manager.startInstallation(inst.id);
    secret = "secret-new";
    await manager.restartInstallation(inst.id);
    expect(clients).toHaveLength(2);
    expect(clients[0].stop).toHaveBeenCalledOnce();
    expect(clients[1].start).toHaveBeenCalledOnce();
  });

  it("uses environment fallback only when the installation has no saved credential", async () => {
    const inst = installation("install-fallback");
    const createClient = vi.fn().mockReturnValue(fakeClient());
    const manager = new WecomConnectionManager({
      store: {
        getAllInstallations: () => [inst],
        getInstallation: () => inst,
        getConfig: () => ({}),
      } as any,
      onMessage: vi.fn(),
      fallback: { botId: "env-bot", botSecret: "env-secret" },
      createClient,
      registerEvents: () => {},
    });
    expect(await manager.startInstallation(inst.id)).toBe(true);
    expect(createClient).toHaveBeenCalledWith(
      "env-bot", "env-secret", undefined, undefined, undefined,
    );
  });
});
