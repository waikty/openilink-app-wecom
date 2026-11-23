# @openilink/app-wecom

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)](Dockerfile)

**企业微信消息接入统一 Digital Life + 18 项企业微信工具能力** — 企业微信不再维护第二个 AI 回复入口。

> 本项目是 [OpeniLink Hub](https://github.com/openilink/openilink-hub) 的官方 App。Hub 是开源的微信 Bot 管理平台 + App 应用市场。

## 功能亮点

- **智能机器人长连接** — 基于 `@wecom/aibot-node-sdk` WebSocket 协议，无需公网回调即可接收消息
- **流式回复** — 支持 Markdown 流式回复，用户体验流畅
- **统一 AI 入站** — 企业微信单聊经签名通道进入 AstrBot 的同一个 Digital Life 会话；不再转发给个人微信形成第二条对话
- **18 项企业工具能力** — 消息发送、通讯录、日程、审批、打卡、微盘、客户联系；它们是工具，不是另一套 AI
- **OAuth 自动安装** — 支持 PKCE 安全授权流程
- **SQLite 持久化** — 安装记录与消息关联可靠存储
- **Docker 一键部署** — 一键容器化部署，数据持久化

## 统一 Digital Life 模式

1. 企业微信智能机器人通过官方 WebSocket 收到消息。
2. 只接受已识别的单聊；消息使用独立桥接密钥签名后，送入现有 AstrBot webhook。
3. AstrBot 校验签名、企业微信账号和原 Core Owner 绑定，再写入现有消息库。
4. 所有渠道共用同一个 `lanvia_digital_life` 会话和同一个 Digital Life 插件。
5. 只有原 Core 返回有效的社交回复 Access Pass，企业微信机器人才能发送回复。

**不会回退到 Hub AI，也不会把企业微信消息转发给个人微信充当 AI。** Hub 内置 AI 应保持关闭。未配置统一桥接时，消息会安全停在入口，不会启动另一套机器人回复。

当前 0.2.0 候选只把文本和企业微信语音转写文本接入统一 AI。群聊、图片、文件、视频及未转写语音会被明确拦截，不会把加密媒体 URL 假装成文字交给模型。

### 当前边界

- 18 项企业微信工具仍是工具能力，不是第二个 AI。
- 这些工具尚未全部注册到 Digital Life 的统一工具目录；当前候选不会声称 Digital Life 已能自动调用全部 18 项工具。
- 微信 iLink、微信客服 KF、QQ 和 HomeVoice 由 Memory-life-stack 的统一入口接入；各渠道身份仍须先由原 Core 绑定。

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
| `LANVIA_DIGITAL_LIFE_WEBHOOK_URL` | 统一模式必填 | — | AstrBot 私网 webhook 完整 URL |
| `LANVIA_SOCIAL_TENANT_ID` | 统一模式必填 | — | 原 Core 登记的 Owner 租户 ID |
| `LANVIA_SOCIAL_CHANNEL` | 否 | `wecom_bot` | `wecom_bot` 或 `wecom_agent` |
| `LANVIA_SOCIAL_ACCOUNT_ID` | 统一模式必填 | BotID | 必须与 Core 渠道绑定中的账号一致 |
| `LANVIA_SOCIAL_BRIDGE_SECRET_FILE` | 统一模式必填 | — | 只读 Docker Secret 文件路径；密钥至少 32 字节 |
| `LANVIA_SOCIAL_BRIDGE_SECRET` | 否 | — | 仅本地开发使用；生产优先 Secret 文件 |

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
    WX[微信用户] -->|消息| HUB[OpeniLink Hub]
    HUB -->|Webhook| APP["@openilink/app-wecom"]
    APP -->|OpenAPI| WECOM[企业微信]
    WECOM -->|WebSocket| APP
    APP -->|签名私网事件| ASTRBOT[现有 AstrBot]
    ASTRBOT --> LIFE[唯一 Digital Life]
    LIFE -->|Core 授权的回复草稿| APP

    subgraph APP
        direction TB
        IDX[index.ts 主入口]
        RT[Router 命令路由]
        DL[Digital Life 签名客户端]
        B1[旧转发不用于 AI 入站]
        TL[18 AI Tools]
        ST[Store SQLite]
    end
```

</details>

## 安全与隐私

- **消息内容不落盘** — 消息内容仅在内存中中转，不会存储到数据库或磁盘
- **仅保存消息 ID 映射** — 数据库中只保存消息 ID 对应关系（用于回复路由），不保存消息正文
- **用户数据严格隔离** — 所有查询均按 `installation_id` + `user_id` 双重过滤，不同用户之间完全隔离
- **统一模式** — 消息正文会按 AstrBot 既有消息历史策略保存；企业微信桥接本身不额外保存正文。签名密钥只用于私网通道校验
- **自部署** — 如需更高隐私保障，可自行部署，所有数据仅在您自己的服务器上流转

## License

MIT
