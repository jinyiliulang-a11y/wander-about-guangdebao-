# 逛道宝 · wander about

> 结合手机网页与实物金币的**商场寻宝**项目。把楼层地图、店铺线索、NFC 领奖与奖励收集串成一条完整体验链路，让顾客带着一个小目标探索商场，同时为商家与运营方提供组织互动活动的工具。

当前源码版本：**v2.3.49**（官网 v1.0.2）· 2026-10-04

---

## 项目介绍

逛道宝是一套「手机网页 + 实物金币」的商场寻宝玩法：

- **玩家**在手机网页上查看楼层地图、接收店铺线索，到店后通过定位完成电子围栏范围校验；
- 使用手机碰触**实物金币**（NFC 标签）打开领奖窗口，提交待领申请；
- **商家**扫描金币固定设备码，核对玩家身份、确认交付实物金币后发放奖励；
- 奖励以**电子券**形式进入玩家卡包并累计积分，日后凭个人券二维码到店核销；
- **运营方**通过后台管理门店、电子围栏、任务、账号审核与数据统计。

v2.3.49 变更：将门店名称搜索（POI 联想）从地图 JS API 凭据中**独立出来**，走专用服务端 Web 服务 Key（`AMAP_REST_KEY`），两类凭据不互换；未配置该 Key 时前端降级为手动填写门店名称、地址并在地图选点。

### 三端角色

| 角色 | 入口 | 说明 |
| --- | --- | --- |
| 寻宝者 / 探索者 | `/client` | 玩家端，两种角色共用一份玩家账号 |
| 商家 | `/merchant` | 商家端，注册后需运营审核，审核通过后绑定门店 |
| 运营 | `/staff`、`/ops` | 运营/后台端，审核商家与新运营申请、管理业务数据与电子围栏 |

---

## 在线地址

生产部署为单台服务器 + Nginx + Cloudflare Workers 本地运行时（wrangler `--local` + PM2 守护），数据库为本地 D1（`.wrangler/state`）。

```
官网：      https://123.60.8.174/official/
产品入口：  https://123.60.8.174/         （官网各页「体验产品」按钮的跳转目标）
```

> 仓库源码内的服务器地址均已脱敏为 `your-server.example.com`，`.env.example` 仅为空模板；上表为当前生产实际地址。

官网页面：`/official/`（首页）、`/official/product`（核心功能）、`/official/product/detail`（落地准备与试点流程）、`/official/team`（团队与联系方式）。

---

## 产品入口

| 用途 | 路径 |
| --- | --- |
| 产品首页 / 角色入口 | `/` |
| 玩家端（地图、卡包） | `/client` |
| 玩家寻宝地图 | `/client/map` |
| 金币 NFC 领取入口 | `/client/nfc/<任务ID>?device=<设备ID>` |
| 商家端 | `/merchant` |
| 运营端 | `/ops`、`/staff` |
| 官网 | `/official/` |

> 手机端**完整流程**（浏览器定位、网页内 NFC 读取、相机）需要 **HTTPS** 环境；公网 HTTP 不满足安全上下文要求。

---

## 目录结构

```
.
├── source/
│   ├── mall-quest/         # 产品源码（Next.js 风格框架 + Cloudflare Workers/D1 + Drizzle）
│   │   ├── app/            # 页面与 API 路由（client / merchant / staff / ops）
│   │   │   └── api/maps/poi/  # v2.3.49 门店 REST 搜索代理（独立 AMAP_REST_KEY）
│   │   ├── components/     # 共享组件（含 amap-poi-search 门店联想输入）
│   │   ├── lib/            # 业务逻辑（账号、围栏、发券、设备、amap-poi-service 等）
│   │   ├── db/ drizzle/    # 数据库 schema 与迁移（0000–0016，共 17 个）
│   │   ├── scripts/        # 构建 / 初始化 / 测试脚本
│   │   └── public/ vendor/ # 静态资源
│   └── official/           # 官网源码（React 18 + TS + Vite + Tailwind）
│       └── src/            # 页面、组件、数据
└── deploy/
    └── official/           # 官网已构建的静态产物（v1.0.2，可直接部署）
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

# 3. 初始化本地数据库（按顺序应用全部 17 个迁移，本地 SQLite）
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

**私有配置**（不随仓库提供，需自行在 `.env` / `.dev.vars` / 服务器 `runtime.env` 中设置）：

| 变量 | 说明 |
| --- | --- |
| `AMAP_WEB_KEY` | 高德地图 **Web 端（JS API）** 类型 Key，用于地图加载与显示 |
| `AMAP_SECURITY_JS_CODE` | 高德地图安全密钥（配合 JS API Key 使用） |
| `AMAP_REST_KEY` | v2.3.49 新增：高德 **Web 服务**类型 Key，仅服务端调用 `/api/maps/poi` 门店搜索；须在高德控制台配置服务器出口 IP 白名单；不得复用 JS API Key |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_SECURE` / `MAIL_USER` / `MAIL_PASS` | SMTP 邮件配置（邮箱验证码发送） |
| `DEMO_ADMIN_PASSWORD` | 管理员首次初始化密码（仅首次建号生效，不会覆盖已有密码） |

> 地图安全密钥与 REST Key 仅保存在服务端，**不会**返回给浏览器；未配置 `AMAP_REST_KEY` 时，门店搜索接口返回 `MAP_POI_NOT_CONFIGURED`，前端提示手动填写门店名称、地址并在地图选点。

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

`deploy/official/` 已是官网 v1.0.2 构建好的静态文件，可直接部署到 Web 服务器的 `/official/` 目录。

Nginx 需在保留原产品 `location /` 的前提下，为 `/official/` 添加静态资源与 SPA 回退规则；修改配置前先备份，`nginx -t` 通过后再重载。

---

## 数据库迁移

产品使用 **Cloudflare D1（SQLite）**，迁移文件位于 `source/mall-quest/drizzle/`（0000–0016 共 17 个），按序号顺序增量应用：

```bash
npm run db:local
```

> 更新**已有环境**时，请先备份持久化数据库，再按顺序应用尚未执行的迁移；**不要**用空库替换已有数据。

---

## v2.3.49 生产真实验收结果（2026-10-04）

以下为在 `https://123.60.8.174/`（Chrome 无头 + CDP 驱动真实浏览器）登录后的实测结论：

| 验收项 | 结果 | 实测证据 |
| --- | --- | --- |
| 部署健康 | ✅ PASS | 应用健康 PASS、迁移数 17 未变、admin 身份密码未变、官网 `/official/` 200 |
| 地图真实加载 | ✅ PASS | 高德版权行 `GS(2025)5996号` 真实显示；GPS 31.2340,121.4737 → GCJ02 31.232059,121.478223 居中精确吻合 |
| 拖动不回弹 | ✅ PASS | `panBy` 拖拽触发 mapmove，中心 121.475648,31.233527 在 12 秒后保持不变 |
| 重新定位 | ✅ PASS | 点击后地图回中 |
| 463×646 布局修复 | ✅ PASS | 定位拒绝提示、空楼层提示与定位按钮/楼层页签/缩放/关闭按钮**矩形零重叠**，全部控件可见 |
| 旧标签页 CSS 保留 | ✅ PASS | 新页面样式全部加载；旧版 v47 样式文件仍可访问（HEAD 200），刷新后升级到新样式 |
| 邮箱验证码真实投递 | ✅ PASS | 生产 SMTP 真实发信，玩家邮箱+密码注册成功并通过审核 |
| POI 接口参数校验 | ✅ PASS | `/api/maps/poi` 已上线，非法参数返回 `MAP_POI_INVALID_REQUEST` |
| POI 未配置降级 | ✅ PASS | 未配置 `AMAP_REST_KEY` 时返回 503 `MAP_POI_NOT_CONFIGURED`「可手动填写名称、地址并在地图选点」，服务端优雅降级 |
| 电子围栏（圆形+多边形）保存 | ⚠️ 部分完成 | 围栏编辑器与地图渲染正常；圆形围栏需先设置门店坐标（自动化中未先填坐标导致保存被拒）；多边形顶点绘制依赖真实鼠标事件，合成事件不触发高德内部监听。已在自动化中用表单直填坐标 + CDP 原生鼠标事件补测，见 Release 说明 |

**未验证 / 待办项**（明确标注，不夸大）：

- `AMAP_REST_KEY`（Web 服务类型）**尚未配置**：需在高德控制台创建并配置服务器出口 IP 白名单（`123.60.8.174`），写入服务器私有 `runtime.env` 后重启生效；当前真实 POI 联想无法端到端验证，前端按设计降级为手填。
- 手机实机 GPS 定位（自动化使用 CDP 地理位置模拟）。
- NFC 实物金币碰读领奖闭环、商家实物发奖核销（需真机到场）。
- 旧版 NFC 标签网址为 HTTP，需改写为最终 HTTPS 地址后重验。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 产品前端 | React + TypeScript |
| 产品运行时 | Cloudflare Workers（本地经 Wrangler 运行，PM2 守护） |
| 数据库 | Cloudflare D1（SQLite）+ Drizzle ORM |
| 邮件 | SMTP（服务端发送验证码） |
| 地图 | 高德地图 Web 端 JS API + Web 服务 REST（v2.3.49 起双 Key 分离，服务端代理） |
| 官网 | React 18 + TypeScript + Vite + React Router + Tailwind |

---

## 说明

- 本仓库为**演示项目**源码，未经过生产级安全加固（如密码恢复、短信/实名验证、生产鉴权运维）。
- 手机端定位、网页内 NFC、相机等功能需在 **HTTPS** 环境验证。
- 仓库内所有服务器地址、密钥、私有配置均已移除或脱敏；`.env.example` 仅为空模板；真实密码、数据库与备份不在仓库内。
