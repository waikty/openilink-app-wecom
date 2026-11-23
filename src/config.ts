import { readFileSync } from "node:fs";

/**
 * 应用配置接口定义
 * 注意：wecomBotId / wecomBotSecret 等企微凭证在云端托管模式下为可选，
 * 用户会在 OAuth setup 页面自行填写并加密存储到本地数据库。
 */
export interface Config {
  /** HTTP 监听端口，默认 "8085" */
  port: string;
  /** OpeniLink Hub 地址，必填 */
  hubUrl: string;
  /** 本应用对外可访问的基础 URL，必填 */
  baseUrl: string;
  /** SQLite 数据库文件路径，默认 "data/wecom.db" */
  dbPath: string;
  /** 企业微信智能机器人 BotID（可选，云端托管模式下由用户在安装时填写） */
  wecomBotId: string;
  /** 企业微信智能机器人 Secret（可选，云端托管模式下由用户在安装时填写） */
  wecomBotSecret: string;
  /** 企业 ID（用于 OpenAPI 调用，可选） */
  wecomCorpId: string;
  /** 应用 Secret（用于 OpenAPI 调用，可选） */
  wecomCorpSecret: string;
  /** 应用 AgentId（用于发送应用消息，可选） */
  wecomAgentId: string;
  /** AstrBot 已注册的统一 Digital Life webhook URL */
  digitalLifeWebhookUrl: string;
  /** Core 已登记的 Owner 租户 ID */
  socialTenantId: string;
  /** 按渠道签名的内部桥接密钥；优先从只读 secret 文件读取 */
  socialBridgeSecret: string;
  /** 当前企业微信 Bot 在 Digital Life 中的渠道标识 */
  socialChannel: "wecom_bot" | "wecom_agent";
  /** 必须与 Core 侧渠道绑定记录中的 account_id 一致 */
  socialAccountId: string;
}

/** 必填配置项清单 — 只有 Hub 和 BaseURL 是必填，企微凭证在云端托管模式下由用户安装时填写 */
const REQUIRED_KEYS: (keyof Config)[] = [
  "hubUrl",
  "baseUrl",
];

/**
 * 从环境变量加载配置
 * @param getenv 环境变量读取函数，默认使用 process.env
 */
export function loadConfig(
  getenv: (key: string) => string | undefined = (k) => process.env[k],
): Config {
  const cfg: Config = {
    port: getenv("PORT")?.trim() || "8085",
    hubUrl: getenv("HUB_URL")?.trim() || "",
    baseUrl: getenv("BASE_URL")?.trim() || "",
    dbPath: getenv("DB_PATH")?.trim() || "data/wecom.db",
    wecomBotId: getenv("WECOM_BOT_ID")?.trim() || "",
    wecomBotSecret: getenv("WECOM_BOT_SECRET")?.trim() || "",
    wecomCorpId: getenv("WECOM_CORP_ID")?.trim() || "",
    wecomCorpSecret: getenv("WECOM_CORP_SECRET")?.trim() || "",
    wecomAgentId: getenv("WECOM_AGENT_ID")?.trim() || "",
    digitalLifeWebhookUrl: getenv("LANVIA_DIGITAL_LIFE_WEBHOOK_URL")?.trim() || "",
    socialTenantId: getenv("LANVIA_SOCIAL_TENANT_ID")?.trim() || "",
    socialBridgeSecret: readSocialBridgeSecret(getenv),
    socialChannel: (getenv("LANVIA_SOCIAL_CHANNEL")?.trim() || "wecom_bot") as "wecom_bot" | "wecom_agent",
    socialAccountId: getenv("LANVIA_SOCIAL_ACCOUNT_ID")?.trim() || getenv("WECOM_BOT_ID")?.trim() || "",
  };

  if (!["wecom_bot", "wecom_agent"].includes(cfg.socialChannel)) {
    throw new Error("LANVIA_SOCIAL_CHANNEL must be wecom_bot or wecom_agent");
  }

  /** 校验必填项 */
  const missing = REQUIRED_KEYS.filter((k) => !cfg[k]);
  if (missing.length > 0) {
    throw new Error(`缺少必填配置项: ${missing.join(", ")}`);
  }

  return cfg;
}


function readSocialBridgeSecret(
  getenv: (key: string) => string | undefined,
): string {
  const secretPath = getenv("LANVIA_SOCIAL_BRIDGE_SECRET_FILE")?.trim();
  if (secretPath) {
    try {
      return readFileSync(secretPath, "utf8").trim();
    } catch {
      throw new Error("LANVIA_SOCIAL_BRIDGE_SECRET_FILE cannot be read");
    }
  }
  return getenv("LANVIA_SOCIAL_BRIDGE_SECRET")?.trim() || "";
}
