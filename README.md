# @openilink/app-wecom

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)](Dockerfile)

**企业微信 → AstrBot → 同一个 Lanvia Digital Life + 18 个企业微信 AI Tools** — 企业微信单聊进入统一 AI；不再默认转发到个人微信 iLink。

> 本项目是 [OpeniLink Hub](https://github.com/openilink/openilink-hub) 的官方 App。Hub 是开源的微信 Bot 管理平台 + App 应用市场。

## 功能亮点

- **智能机器人长连接** — 基于 `@wecom/aibot-node-sdk` WebSocket 协议，无需公网回调即可接收消息
- **流式回复** — 支持 Markdown 流式回复，用户体验流畅
- **统一 AI 入站** — 企业微信单聊经签名验证进入 AstrBot，与个人 iLink、微信客服、QQ 共用同一个 Digital Life 会话身份
- **授权回复** — 只有 AstrBot 返回同请求签名回执且原 Core Access Pass 明确允许时，才回复原企业微信会话
- **旧转发停用** — 普通企业微信消息不再转发到个人微信 iLink，避免出现两个 AI 或重复消息
- **18 个 AI Tools** — 覆盖消息发送、通讯录、日程、审批、打卡、微盘、客户联系等核心场景
- **OAuth 自动安装** — 支持 PKCE 安全授权流程
- **SQLite 持久化** — 安装记录与消息关联可靠存储
- **Docker 一键部署** — 一键容器化部署，数据持久化

## 使用方式

安装到 Bot 后，支持三种方式调用：

### 自然语言（推荐）

直接在企业微信单聊中向 Digital Life 发消息；Hub 内置 AI 必须保持关闭，避免第二个 AI 抢答。企业微信工具仍由同一个 Digital Life 通过已授权工具链调用：

- "用企业微信通知全组明天开会"
- "查一下打卡记录"

### 命令调用

使用 `/命令名 参数` 的格式直接调用：

- `/send_wecom_message --to_user xxx --text 你好`

### AI 自动调用

Hub AI 在多轮对话中会自动判断是否需要调用本 App 的功能，无需手动触发。

## AI Tools（18 个）

### 消息发送 — 4 个

| 工具名 | 说明 |
|--------|------|
| `send_wecom_message` | 发送企业微信应用文本消息 |
| `send_wecom_markdown` | 发送企业微信 Markdown 消息 |
| `send_wecom_card` | 发送企业微信模板卡片消息 |
| `send_wecom_news` | 发送企业微信图文消息 |

### 通讯录 — 3 个

| 工具名 | 说明 |
|--------|------|
| `get_user_info` | 获取企业微信成员详细信息 |
| `list_department_users` | 获取部门成员列表 |
| `list_departments` | 获取部门列表 |

### 日程 — 3 个

| 工具名 | 说明 |
|--------|------|
| `list_schedule` | 查看指定成员在时间范围内的日程 |
| `create_schedule` | 创建企业微信日程 |
| `get_free_busy` | 查询成员忙闲状态 |

### 审批 — 2 个

| 工具名 | 说明 |
|--------|------|
| `list_approvals` | 查询企业微信审批列表 |
| `get_approval_detail` | 查询企业微信审批单详情 |

### 打卡 — 2 个

| 工具名 | 说明 |
|--------|------|
| `get_checkin_data` | 查询企业微信打卡记录 |
| `get_checkin_rules` | 查询企业微信打卡规则 |

### 微盘 — 2 个

| 工具名 | 说明 |
|--------|------|
| `list_spaces` | 列出企业微信微盘空间列表 |
| `list_files` | 列出企业微信微盘空间中的文件 |

### 客户联系 — 2 个

| 工具名 | 说明 |
|--------|------|
| `list_external_contacts` | 列出成员的外部联系人列表 |
| `get_external_contact` | 查询外部联系人详情 |

## 快速开始 — 应用市场一键安装

1. 打开 [OpeniLink Hub](https://github.com/openilink/openilink-hub) 管理后台
2. 进入 **应用市场**，找到 **企业微信桥接**
3. 点击 **安装**，按提示填入企业微信 BotID / Secret
4. 安装完成后即可在微信中使用

<details>
<summary><strong>自部署 — Docker</strong></summary>

```bash
# 使用 docker-compose
docker compose up -d
```

或源码运行：

```bash
git clone https://github.com/openilink/openilink-app-wecom.git
cd openilink-app-wecom
npm install
cp .env.example .env   # 编辑 .env 填入实际值
npm run dev             # 开发模式
npm run build && npm start  # 生产模式
```

</details>

<details>
<summary><strong>环境变量</strong></summary>

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `HUB_URL` | 是 | — | OpeniLink Hub 地址 |
| `BASE_URL` | 是 | — | 本应用对外可访问的基础 URL |
| `WECOM_BOT_ID` | 是 | — | 企业微信智能机器人 BotID |
| `WECOM_BOT_SECRET` | 是 | — | 企业微信智能机器人 Secret |
| `WECOM_CORP_ID` | 否 | — | 企业 ID（OpenAPI 调用需要） |
| `WECOM_CORP_SECRET` | 否 | — | 应用 Secret（OpenAPI 调用需要） |
| `PORT` | 否 | `8085` | HTTP 监听端口 |
| `DB_PATH` | 否 | `data/wecom.db` | SQLite 数据库文件路径 |
| `LANVIA_ASTRBOT_WEBHOOK_URL` | Digital Life 模式必填 | — | AstrBot 现有社交 Webhook 的完整 HTTPS 地址 |
| `LANVIA_ASTRBOT_TENANT_ID` | Digital Life 模式必填 | — | Core 可信租户 ID |
| `LANVIA_ASTRBOT_ACCOUNT_ID` | 否 | 安装配置中的 BotID | Core 绑定的企业微信 Bot accountId |
| `LANVIA_ASTRBOT_SECRET_FILE` | Digital Life 模式必填 | — | AstrBot 共用的内部签名密钥文件绝对路径；至少 32 字节，Linux 权限 0600/0400 |

</details>

<details>
<summary><strong>企业微信配置指南</strong></summary>

### 创建企业微信智能机器人

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 进入 **应用管理** → **创建应用** → **智能机器人**
3. 获取 **BotID** 和 **Secret**
4. 智能机器人使用 WebSocket 长连接，无需配置回调地址

### （可选）创建自建应用

如需使用通讯录、审批、打卡等 OpenAPI 功能：

1. 在管理后台创建 **自建应用**
2. 获取 **CorpID**（企业信息页面）和 **CorpSecret**（应用详情页面）
3. 在应用权限中开启以下 API 权限：
   - **通讯录管理** — 成员读取、部门读取
   - **OA** — 审批、打卡
   - **日程** — 日程读写
   - **微盘** — 空间和文件读取
   - **客户联系** — 外部联系人读取
4. 设置应用可见范围

### Digital Life 接入要求

- Hub App 安装后会从加密的安装配置中读取 BotID / Secret，并启动对应 WebSocket 客户端；设置页保存凭证后会重启客户端。
- Digital Life 模式只接受企业微信 **single 单聊** 的文本和语音转写文本；群聊、图片、文件暂不进入私人会话。
- AstrBot 必须预先创建 `wecom_bot` 平台实例，并注入原 Core 身份验证、现有 AstrBot SQLite inbox、统一 Digital Life 调度器及 Core 社交回复授权检查。
- `LANVIA_ASTRBOT_SECRET_FILE` 必须以只读方式挂载到容器；不要把密钥放进 Hub 安装表单、URL、日志或 SQLite。
- Core 未返回有效的 `digital-life:social:reply` Access Pass 回执时，Bridge 只接收，不回复。此 App 不创建授权、不写长期记忆、不执行 Runner。

### HTTP 路由

| 路径 | 方法 | 说明 |
|------|------|------|
| `/healthz` | GET | 健康检查 |
| `/manifest` | GET | 应用清单 |
| `/oauth/setup` | GET | OAuth 安装发起 |
| `/oauth/redirect` | GET | OAuth 回调 |
| `/webhook` | POST | Hub 事件接收 |

</details>

<details>
<summary><strong>开发指南</strong></summary>

### 架构

```mermaid
graph LR
    WECOM[企业微信单聊] -->|WebSocket| APP["@openilink/app-wecom 0.2.0"]
    APP -->|HMAC signed ingress| ASTRBOT[AstrBot]
    ASTRBOT --> DL[唯一 Digital Life]
    DL -->|Core Access Pass reply receipt| ASTRBOT
    ASTRBOT -->|signed reply receipt| APP
    APP -->|原消息流式回复| WECOM
    WX[个人微信 iLink] -->|独立原生入口| ASTRBOT

    subgraph APP
        direction TB
        IDX[index.ts 主入口]
        RT[显式命令 / 工具路由]
        DLIngress[DigitalLifeIngress 签名适配器]
        TL[18 企业微信 Tools]
        ST[安装凭证加密存储]
    end
```

</details>

## 安全与隐私

- **消息内容不落盘** — 消息内容仅在内存中中转，不会存储到数据库或磁盘
- **仅保存消息 ID 映射** — 数据库中只保存消息 ID 对应关系（用于回复路由），不保存消息正文
- **用户数据严格隔离** — 所有查询均按 `installation_id` + `user_id` 双重过滤，不同用户之间完全隔离
- **应用市场安装（托管模式）** — Bridge 自身不保存消息正文；消息由 AstrBot 现有 SQLite durable inbox 接收并去重，长期记忆仍由既有 Memory Hub/Workbench 权威负责
- **自部署** — 如需更高隐私保障，可自行部署，所有数据仅在您自己的服务器上流转

## License

MIT
