import { createHash } from "node:crypto";
import type { Store } from "../store.js";
import type { Installation } from "../hub/types.js";
import { WecomClient } from "./client.js";
import { registerWecomEvents } from "./event.js";
import type { WecomMessageData } from "./event.js";

export interface WecomCredentialFallback {
  botId?: string;
  botSecret?: string;
  corpId?: string;
  corpSecret?: string;
  agentId?: string;
}

export type WecomMessageCallback = (
  installation: Installation,
  accountId: string,
  client: WecomClient,
  message: WecomMessageData,
) => Promise<void>;

export interface WecomConnectionManagerOptions {
  store: Pick<Store, "getAllInstallations" | "getInstallation" | "getConfig">;
  onMessage: WecomMessageCallback;
  fallback?: WecomCredentialFallback;
  createClient?: (
    botId: string, botSecret: string,
    corpId?: string, corpSecret?: string, agentId?: string,
  ) => WecomClient;
  registerEvents?: (
    wsClient: any,
    callback: (message: WecomMessageData) => void | Promise<void>,
  ) => void;
}

interface ActiveConnection {
  client: WecomClient;
  botId: string;
  secretFingerprint: string;
}

export class WecomConnectionManager {
  private readonly store: WecomConnectionManagerOptions["store"];
  private readonly onMessage: WecomMessageCallback;
  private readonly fallback: WecomCredentialFallback;
  private readonly createClient: NonNullable<WecomConnectionManagerOptions["createClient"]>;
  private readonly registerEvents: NonNullable<WecomConnectionManagerOptions["registerEvents"]>;
  private readonly active = new Map<string, ActiveConnection>();

  constructor(options: WecomConnectionManagerOptions) {
    this.store = options.store;
    this.onMessage = options.onMessage;
    this.fallback = options.fallback ?? {};
    this.createClient = options.createClient ?? (
      (botId, secret, corpId, corpSecret, agentId) =>
        new WecomClient(botId, secret, corpId, corpSecret, agentId)
    );
    this.registerEvents = options.registerEvents ?? registerWecomEvents;
  }

  async startAll(): Promise<{ connected: number; skipped: number }> {
    let connected = 0;
    let skipped = 0;
    for (const installation of this.store.getAllInstallations()) {
      const result = await this.startInstallation(installation.id);
      if (result) connected += 1;
      else skipped += 1;
    }
    return { connected, skipped };
  }

  async startInstallation(installationId: string): Promise<boolean> {
    const installation = this.store.getInstallation(installationId);
    if (!installation) throw new Error("WECOM_INSTALLATION_NOT_FOUND");

    const saved = this.store.getConfig(installationId, installation.appToken) ?? {};
    const botId = saved.wecom_bot_id || this.fallback.botId || "";
    const botSecret = saved.wecom_bot_secret || this.fallback.botSecret || "";
    if (!botId || !botSecret) {
      await this.stopInstallation(installationId);
      return false;
    }

    const secretFingerprint = createHash("sha256").update(botSecret).digest("hex");
    const existing = this.active.get(installationId);
    if (existing && existing.botId === botId &&
        existing.secretFingerprint === secretFingerprint) {
      return true;
    }
    await this.stopInstallation(installationId);

    const client = this.createClient(
      botId,
      botSecret,
      saved.wecom_corp_id || this.fallback.corpId,
      saved.wecom_corp_secret || this.fallback.corpSecret,
      saved.wecom_agent_id || this.fallback.agentId,
    );

    this.registerEvents(client.getWSClient(), async (message) => {
      try {
        await this.onMessage(installation, botId, client, message);
      } catch (error) {
        // Never log message bodies, credentials, or Core bearer material.
        console.error(
          "[wecom] Digital Life message handling failed; installation=%s code=%s",
          installationId,
          error instanceof Error ? error.message : "UNKNOWN",
        );
      }
    });

    try {
      await client.start();
      this.active.set(installationId, { client, botId, secretFingerprint });
      console.log("[wecom] Bot connection ready; installation=%s", installationId);
      return true;
    } catch (error) {
      await client.stop().catch(() => {});
      throw error;
    }
  }

  async restartInstallation(installationId: string): Promise<boolean> {
    await this.stopInstallation(installationId);
    return this.startInstallation(installationId);
  }

  async stopInstallation(installationId: string): Promise<void> {
    const current = this.active.get(installationId);
    if (!current) return;
    this.active.delete(installationId);
    await current.client.stop();
  }

  async stopAll(): Promise<void> {
    const ids = [...this.active.keys()];
    for (const id of ids) await this.stopInstallation(id);
  }

  getClient(installationId: string): WecomClient | undefined {
    return this.active.get(installationId)?.client;
  }

  getStatus(): Array<{ installationId: string; botId: string; connected: boolean }> {
    return [...this.active.entries()].map(([installationId, value]) => ({
      installationId,
      botId: value.botId,
      connected: true,
    }));
  }
}
