# 逛道宝 · 产品源码（mall-quest）

「逛道宝 wander about」商场寻宝项目的产品端源码 —— 玩家端、商家端、运营端三端页面与共享后端。

- 完整项目介绍、官网地址、产品入口与运行方法：见**仓库根目录 [`README.md`](../README.md)**
- 官网源码：见 [`../official`](../official)
- 项目协作规则：见 [`AGENTS.md`](./AGENTS.md)

## 快速开始

```bash
npm run install:ci          # 安装依赖
cp .env.example .env        # 生成本地配置
npm run db:local            # 初始化本地数据库（应用全部迁移）
npm run dev                 # 启动开发服务，默认 http://127.0.0.1:5173/
```

常用命令：

```bash
npm run check    # TypeScript 类型检查
npm run build    # 生产构建
npm run lint     # ESLint
```

## 目录

| 目录 | 内容 |
| --- | --- |
| `app/` | 页面与 API 路由（`client` / `merchant` / `staff` / `ops`） |
| `components/` | 共享 UI 组件 |
| `lib/` | 业务逻辑（账号鉴权、电子围栏、发券、设备同步等） |
| `db/` `drizzle/` | 数据库 schema 与迁移脚本 |
| `scripts/` | 构建、初始化、测试脚本 |
| `public/` `vendor/` | 静态资源与第三方库 |

## 技术栈

React + TypeScript · Cloudflare Workers 运行时 · Cloudflare D1（SQLite）+ Drizzle ORM · 高德地图 JS API（服务端代理）· SMTP 邮件验证码

## 私有配置

以下变量不随源码提供，需自行配置（本地放在 `.env` 或被忽略的 `.dev.vars`）：

`AMAP_WEB_KEY`、`AMAP_SECURITY_JS_CODE`、`MAIL_HOST`、`MAIL_PORT`、`MAIL_SECURE`、`MAIL_USER`、`MAIL_PASS`、`DEMO_ADMIN_PASSWORD`

## 数据库迁移

迁移位于 `drizzle/`，按序号顺序增量应用，执行 `npm run db:local`。更新已有环境前请先备份持久化数据库，不要用空库替换已有数据。

> 演示项目，未做生产级安全加固。手机端定位 / 网页内 NFC / 相机需 HTTPS 环境。
