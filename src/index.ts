import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { Router } from "./router.js";
import { WecomClient } from "./wecom/client.js";
import { registerWecomEvents } from "./wecom/event.js";
import { collectAllTools } from "./tools/index.js";
import { handleOAuthSetup, handleOAuthRedirect } from "./hub/oauth.js";
import { handleSettingsPage, handleSettingsVerify, handleSettingsSave } from "./hub/settings.js";
import { handleWebhook, readBody } from "./hub/webhook.js";
import { getManifestJSON, manifest } from "./hub/manifest.js";
import { HubClient } from "./hub/client.js";
import { DigitalLifeIngress } from "./bridge/digital-life-ingress.js";
import type { WecomMessageData } from "./wecom/event.js";
import type { HubEvent, Installation, ToolResult } from "./hub/types.js";

function toolDefinitionsForHub(definitions: Array<{
  name: string; description: string; command: string; parameters?: Record<string, unknown> | Record<string, unknown>[];
}>): Record<string, unknown>[] {
  return definitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    command: tool.command,
    parameters: tool.parameters,
  }));
}

/** 应用主入口 */
async function main(): Promise<void> {
  const config = loadConfig();
  console.log("[wecom] 配置加载完成, port=%s", config.port);

  const store = new Store(config.dbPath);
  console.log("[wecom] 数据库已连接: %s", config.dbPath);

  // 只收集清单定义；实际工具 Handler 必须绑定到已配置的 WecomClient。
  const definitionsClient = new WecomClient("", "");
  const definitions = collectAllTools(definitionsClient).definitions;
  const toolsForHub = toolDefinitionsForHub(definitions);
  manifest.tools = definitions;
  manifest.oauth_setup_url = `${config.baseUrl}/oauth/setup`;
  manifest.oauth_redirect_url = `${config.baseUrl}/oauth/redirect`;
  manifest.webhook_url = `${config.baseUrl}/webhook`;

  let wecomClient: WecomClient | null = null;
  let activeRouter: Router | null = null;
  let activeHandlers = new Map<string, any>();
  let activeInstallation: Installation | null = null;
  let activeBotId = "";
  let digitalLifeIngress: DigitalLifeIngress | null = null;

  async function syncToolsToInstallation(
    hubUrl: string,
    appToken: string,
    tools: Record<string, unknown>[] = toolsForHub,
  ): Promise<void> {
    const client = new HubClient(hubUrl, appToken);
    await client.syncTools(tools);
  }

  async function stopWecomRuntime(): Promise<void> {
    if (wecomClient) {
      await wecomClient.stop().catch(() => {});
    }
    wecomClient = null;
    activeRouter = null;
    activeHandlers = new Map();
    activeInstallation = null;
    activeBotId = "";
    digitalLifeIngress = null;
  }

  async function startWecomRuntime(preferredInstallationId?: string): Promise<void> {
    await stopWecomRuntime();

    const installations = store.getAllInstallations();
    let selected: Installation | null = null;
    let localConfig: Record<string, string> = {};

    if (preferredInstallationId) {
      selected = store.getInstallation(preferredInstallationId) ?? null;
      if (!selected) throw new Error("WECOM_INSTALLATION_NOT_FOUND");
      localConfig = store.getConfig(selected.id, selected.appToken) ?? {};
    } else {
      const configured = installations.map((installation) => ({
        installation,
        config: store.getConfig(installation.id, installation.appToken) ?? {},
      })).filter(({ config: saved }) =>
        Boolean(saved.wecom_bot_id || config.wecomBotId) &&
        Boolean(saved.wecom_bot_secret || config.wecomBotSecret)
      );
      if (configured.length > 1) {
        console.error("[wecom] 检测到多个企业微信 Bot 安装；当前单 Bot 运行模式拒绝猜测目标");
        return;
      }
      if (configured.length === 1) {
        selected = configured[0].installation;
        localConfig = configured[0].config;
      }
    }

    const botId = localConfig.wecom_bot_id || config.wecomBotId;
    const botSecret = localConfig.wecom_bot_secret || config.wecomBotSecret;
    if (!botId || !botSecret) {
      console.log("[wecom] 尚无可用企业微信 Bot 凭证；等待 Hub 安装或设置页保存，不启动空凭证连接");
      return;
    }

    const client = new WecomClient(
      botId,
      botSecret,
      localConfig.wecom_corp_id || config.wecomCorpId || undefined,
      localConfig.wecom_corp_secret || config.wecomCorpSecret || undefined,
      localConfig.wecom_agent_id || config.wecomAgentId || undefined,
    );
    await client.start();

    const { definitions: runtimeDefinitions, handlers } = collectAllTools(client);
    const runtimeRouter = new Router();
    runtimeRouter.register(runtimeDefinitions, handlers);

    wecomClient = client;
    activeRouter = runtimeRouter;
    activeHandlers = handlers;
    activeInstallation = selected;
    activeBotId = botId;

    if (config.digitalLifeWebhookUrl && config.digitalLifeTenantId && config.digitalLifeSecretFile) {
      digitalLifeIngress = new DigitalLifeIngress({
        webhookUrl: config.digitalLifeWebhookUrl,
        tenantId: config.digitalLifeTenantId,
        accountId: config.digitalLifeAccountId || botId,
        secretFile: config.digitalLifeSecretFile,
        channel: "wecom_bot",
      });
      console.log("[wecom] Digital Life 入站已配置；回复仍须通过 Core Access Pass");
    } else {
      console.log("[wecom] Digital Life 入站尚未配置；普通消息不会转发到个人 iLink，也不会触发第二个 AI");
    }

    registerWecomEvents(client.getWSClient(), async (message: WecomMessageData) => {
      if (message.botId !== botId) {
        console.warn("[wecom] 拒绝 BotID 不匹配的消息");
        return;
      }
      if (message.chatType !== "single") {
        console.log("[wecom] 群聊消息暂不进入私人 Digital Life");
        return;
      }

      // 显式命令仍走本安装绑定的企业微信工具；普通聊天只进入 Digital Life。
      const commandResult = await runtimeRouter.handleCommand(message.content, {
        installationId: selected?.id ?? "",
        botId,
        userId: message.userId,
        traceId: message.msgId,
      });
      if (commandResult !== null) {
        const replyText = typeof commandResult === "string" ? commandResult : commandResult.reply;
        await client.replyStream(message.frame, replyText);
        return;
      }

      if (!digitalLifeIngress) {
        console.log("[wecom] DIGITAL_LIFE_INGRESS_NOT_CONFIGURED; 已拒绝旧的个人 iLink 转发路线");
        return;
      }

      try {
        const result = await digitalLifeIngress.dispatch(message);
        if (result.duplicate) {
          console.log("[wecom] 重复消息已确认，不重复调用 Digital Life");
          return;
        }
        if (result.linked) {
          console.log("[wecom] Core 身份绑定已确认，不发送平台回复");
          return;
        }
        if (result.replyAuthorized && result.replyText) {
          // 只有 AstrBot 回传的同请求签名回执 + 原 Core Access Pass 才能触发回复。
          await client.replyStream(message.frame, result.replyText);
        } else {
          console.log("[wecom] Digital Life 已处理消息，但 Core 未签发回复权限；不发送回复");
        }
      } catch (err) {
        const code = err instanceof Error ? err.message : "DIGITAL_LIFE_INGRESS_FAILED";
        console.warn("[wecom] Digital Life 消息未进入可回复状态:", code);
      }
    });

    console.log("[wecom] 企业微信 Bot 长连接已启动: account=%s", botId);
    if (selected) {
      await syncToolsToInstallation(selected.hubUrl, selected.appToken,
        toolDefinitionsForHub(runtimeDefinitions)).catch((err) => {
          console.error("[wecom] 同步工具定义失败:", err);
        });
    }
  }

  async function syncToolsOnStartup(): Promise<void> {
    const installations = store.getAllInstallations();
    if (installations.length === 0) {
      console.log("[wecom] 暂无 Hub 安装记录，跳过工具同步");
      return;
    }
    for (const installation of installations) {
      try {
        await syncToolsToInstallation(installation.hubUrl, installation.appToken);
      } catch (err) {
        console.error("[wecom] 同步工具到安装 %s 失败:", installation.id, err);
      }
    }
  }

  async function onCommand(event: HubEvent, installationId: string): Promise<string | ToolResult> {
    const installation = store.getInstallation(installationId);
    if (!installation) return `未找到安装: ${installationId}`;
    if (!activeRouter || (activeInstallation && activeInstallation.id !== installationId)) {
      return "当前安装尚未连接已配置的企业微信 Bot";
    }

    const data = event.event?.data;
    if (!data) return "缺少事件数据";
    const command = data.command as string;
    const args = (data.args as Record<string, any>) ?? {};
    const userId = data.user_id as string;
    const handler = activeHandlers.get(command);
    if (!handler) return `未知指令或企业微信客户端未就绪: ${command}`;

    try {
      return await handler({
        installationId,
        botId: activeBotId || event.bot.id,
        userId,
        traceId: event.trace_id,
        args,
      });
    } catch (err) {
      console.error("[wecom] 工具调用失败:", command, err);
      const hubClient = new HubClient(installation.hubUrl, installation.appToken);
      const to =
        (data.group as { id?: string })?.id ??
        (data.sender as { id?: string })?.id ??
        userId ??
        (data.from as string) ??
        "";
      await hubClient.sendText(to, `工具 ${command} 执行失败`, event.trace_id).catch(() => {});
      return `工具 ${command} 执行失败`;
    }
  }

  async function onHubEvent(event: HubEvent): Promise<void> {
    // Hub 的个人 iLink 消息由 Hub 自己的 iLink → AstrBot 原生通道处理。
    // 企业微信 App 不再把这些消息转发到企业微信，避免形成第二条 AI 路线。
    const type = event.event?.type || "unknown";
    console.log("[wecom] Hub event received and left to the canonical channel router: type=%s", type);
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {
      if (pathname === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          wecomConnected: Boolean(wecomClient),
          digitalLifeIngressConfigured: Boolean(digitalLifeIngress),
          digitalLifeReplyGrantRequired: true,
        }));
        return;
      }

      if (pathname === "/manifest" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(getManifestJSON());
        return;
      }

      if (pathname === "/oauth/setup" && (req.method === "GET" || req.method === "POST")) {
        await handleOAuthSetup(req, res, config);
        return;
      }

      if (req.method === "GET" && pathname === "/settings") {
        handleSettingsPage(req, res);
        return;
      }

      if (req.method === "POST" && pathname === "/settings/verify") {
        await handleSettingsVerify(req, res, config, store);
        return;
      }

      if (req.method === "POST" && pathname === "/settings/save") {
        await handleSettingsSave(req, res, config, store, async (installationId) => {
          await startWecomRuntime(installationId);
        });
        return;
      }

      if (pathname === "/oauth/redirect") {
        if (req.method === "GET") {
          await handleOAuthRedirect(
            req, res, config, store, toolsForHub,
            async (installation) => { await startWecomRuntime(installation.id); },
          );
        } else if (req.method === "POST") {
          const body = await readBody(req);
          const data = JSON.parse(body);
          const installation: Installation = {
            id: data.installation_id,
            hubUrl: data.hub_url || config.hubUrl,
            appId: "",
            botId: data.bot_id || "",
            appToken: data.app_token,
            webhookSecret: data.webhook_secret,
          };
          store.saveInstallation(installation);
          const mode2Hub = new HubClient(installation.hubUrl, installation.appToken);
          try {
            const remoteConfig = await mode2Hub.fetchConfig();
            if (Object.keys(remoteConfig).length > 0) {
              store.saveConfig(installation.id, remoteConfig, installation.appToken);
            }
          } catch (err) {
            console.error("[wecom] 模式2: 拉取配置失败:", err);
          }
          await startWecomRuntime(installation.id).catch((err) => {
            console.error("[wecom] 模式2: 企业微信客户端启动失败:", err);
          });
          await mode2Hub.syncTools(toolsForHub).catch((err) => {
            console.error("[wecom] 模式2: 同步工具失败:", err);
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ webhook_url: `${config.baseUrl}/webhook` }));
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method Not Allowed" }));
        }
        return;
      }

      if (pathname === "/webhook" && req.method === "POST") {
        await handleWebhook(req, res, store, onHubEvent, onCommand);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    } catch (err) {
      console.error("[wecom] 未捕获的异常:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  });

  server.listen(Number(config.port), () => {
    console.log("[wecom] HTTP 服务已启动: http://0.0.0.0:%s", config.port);
    startWecomRuntime().catch((err) => {
      console.error("[wecom] 已保存的企业微信配置启动失败:", err);
    });
    syncToolsOnStartup().catch((err) => {
      console.error("[wecom] 启动时同步工具异常:", err);
    });
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log("[wecom] 收到 %s 信号，正在关闭...", signal);
    server.close();
    await stopWecomRuntime();
    store.close();
    console.log("[wecom] 已安全关闭");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[wecom] 启动失败:", err);
  process.exit(1);
});
