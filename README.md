# 逛道宝 · wander about

> 结合手机网页与实物金币的**商场寻宝**项目。把楼层地图、店铺线索、NFC 领奖与奖励收集串成一条完整体验链路，让顾客带着一个小目标探索商场，同时为商家与运营方提供组织互动活动的工具。

当前源码版本：**v2.3.42**（官网 v1.0.0）· 2026-10-03

---

## 项目介绍

逛道宝是一套「手机网页 + 实物金币」的商场寻宝玩法演示：

- **玩家**在手机网页上查看楼层地图、接收店铺线索，到店后通过定位完成范围校验；
- 使用手机碰触**实物金币**（NFC 标签）打开领奖窗口，提交待领申请；
- **商家**扫描金币固定设备码，核对玩家身份、确认交付实物金币后发放奖励；
- 奖励以**电子券**形式进入玩家卡包并累计积分，日后凭个人券二维码到店核销；
- **运营方**通过后台管理门店、任务、账号审核与数据统计。

项目定位为**比赛演示**，用于展示玩法与业务流程，尚未作为正式生产环境运营。

### 三端角色

| 角色 | 入口 | 说明 |
| --- | --- | --- |
| 寻宝者 / 探索者 | `/client` | 玩家端，两种角色共用一份玩家账号 |
| 商家 | `/merchant` | 商家端，注册后需运营审核，审核通过后绑定门店 |
| 运营 | `/staff`、`/ops` | 运营/后台端，审核商家与新运营申请、管理业务数据 |

---

## 官网地址

官网为 React + Vite 静态站，部署在产品的 `/official/` 子路径下，原产品保留根路径。

```
官网：      http://<your-server>/official/
产品入口：  http://<your-server>/          （官网各页「体验产品」按钮的跳转目标）
```

> ⚠️ 部署时请把 `<your-server>` 替换为你自己的域名或服务器地址。
> 仓库中所有服务器地址均已脱敏为 `your-server.example.com`。

官网页面：`/official/`（首页）、`/official/product`（核心功能）、`/official/product/detail`（落地准备与试点流程）、`/official/team`（团队与联系方式）。

---

## 产品入口

| 用途 | 路径 |
| --- | --- |
| 产品首页 / 角色入口 | `/` |
| 玩家端（地图、卡包） | `/client` |
| 金币 NFC 领取入口 | `/client/nfc/<任务ID>?device=<设备ID>` |
| 商家端 | `/merchant` |
| 运营端 | `/ops` |
| 官网 | `/official/` |

> 手机端**完整流程**（浏览器定位、网页内 NFC 读取、相机）需要 **HTTPS** 环境；公网 HTTP 不满足安全上下文要求。

---

## 目录结构

```
.
├── source/
│   ├── mall-quest/         # 产品源码（Next.js 风格框架 + Cloudflare Workers/D1 + Drizzle）
│   │   ├── app/            # 页面与 API 路由（client / merchant / staff / ops）
│   │   ├── components/     # 共享组件
│   │   ├── lib/            # 业务逻辑（账号、围栏、发券、设备等）
│   │   ├── db/ drizzle/    # 数据库 schema 与迁移（0001–0015）
│   │   ├── scripts/        # 构建 / 初始化 / 测试脚本
│   │   └── public/ vendor/ # 静态资源
│   └── official/           # 官网源码（React 18 + TS + Vite + Tailwind）
│       └── src/            # 页面、组件、数据
└── deploy/
    └── official/           # 官网已构建的静态产物（可直接部署）
```

---

## 运行方法

### 环境要求

- Node.js 20+（建议 22 LTS）
- npm

### 一、产品源码（`source/mall-quest`）

```bash
cd source/mall-quest

# 1. 安装依赖（沿用 package-lock.json）
npm run install:ci

# 2. 生成本地配置（首次运行）
cp .env.example .env

# 3. 初始化本地数据库（按顺序应用全部迁移，本地 SQLite）
npm run db:local

# 4. 启动开发服务
npm run dev
```

默认访问 `http://127.0.0.1:5173/`。

本地数据保存在项目的 `.wrangler/state` 目录，**保留该目录**即可在重启后继续使用。

其他常用命令：

```bash
npm run check    # TypeScript 类型检查
npm run build    # 生产构建
npm run lint     # ESLint
npm run start    # 以本地 Workers 运行时启动构建产物
```

**私有配置**（不随仓库提供，需自行在 `.env` / `.dev.vars` 中设置）：

| 变量 | 说明 |
| --- | --- |
| `AMAP_WEB_KEY` | 高德地图 **Web 端（JS API）** 类型 Key，用于服务端地图代理 |
| `AMAP_SECURITY_JS_CODE` | 高德地图安全密钥 |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_SECURE` / `MAIL_USER` / `MAIL_PASS` | SMTP 邮件配置（邮箱验证码发送） |
| `DEMO_ADMIN_PASSWORD` | 管理员首次初始化密码（仅首次建号生效，不会覆盖已有密码） |

> 安全密钥仅保存在服务端，**不会**返回给浏览器；地图请求统一走服务端代理。

### 二、官网源码（`source/official`）

```bash
cd source/official

npm ci
npm run check    # 类型检查
npm run build    # 构建，产物在 dist/
npm run dev      # 本地开发，访问输出的 /official/
```

公开配置参见 `.env.example`：

| 变量 | 说明 |
| --- | --- |
| `VITE_SITE_BASE` | 部署前缀，默认 `/official/` |
| `VITE_PRODUCT_URL` | 产品入口地址（「体验产品」按钮跳转目标） |
| `VITE_PRODUCT_VIDEO_URL` | 产品视频地址，留空则不展示播放器 |
| `VITE_PRODUCT_VIDEO_POSTER` | 可选视频封面 |

> `VITE_` 前缀的变量会进入浏览器，请勿填写私有凭据。

### 三、直接部署官网静态产物

`deploy/official/` 已是官网构建好的静态文件，可直接部署到 Web 服务器的 `/official/` 目录。

Nginx 需在保留原产品 `location /` 的前提下，为 `/official/` 添加静态资源与 SPA 回退规则；修改配置前先备份，`nginx -t` 通过后再重载。

---

## 数据库迁移

产品使用 **Cloudflare D1（SQLite）**，迁移文件位于 `source/mall-quest/drizzle/`，按序号顺序增量应用：

```bash
npm run db:local
```

> 更新**已有环境**时，请先备份持久化数据库，再按顺序应用尚未执行的迁移；**不要**用空库替换已有数据。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 产品前端 | React + TypeScript |
| 产品运行时 | Cloudflare Workers（本地经 Wrangler 运行） |
| 数据库 | Cloudflare D1（SQLite）+ Drizzle ORM |
| 邮件 | SMTP（Nodemailer 风格，服务端发送验证码） |
| 地图 | 高德地图 Web 端 JS API（服务端代理） |
| 官网 | React 18 + TypeScript + Vite + React Router + Tailwind |

---

## 说明

- 本仓库为**演示项目**源码，未经过生产级安全加固（如密码恢复、短信/实名验证、生产鉴权运维）。
- 手机端定位、网页内 NFC、相机等功能需在 **HTTPS** 环境验证。
- 仓库内所有服务器地址、密钥、私有配置均已移除或脱敏；`.env.example` 仅为空模板。
