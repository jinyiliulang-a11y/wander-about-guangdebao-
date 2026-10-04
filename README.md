# 逛道宝 · Wander About

手机网页与实物金币结合的线下寻宝产品：玩家发现门店线索、到店申请奖励，商家确认收到金币后发券，玩家以后出示个人券另行核销。探索者可以创建内容，运营负责账号、门店、任务和范围配置。

当前公开源码：产品 **v2.3.54**、官网 **v1.0.4**。2026-10-04 比赛结束后按真实时间发布更新，仓库链接保持不变。本仓库是最新开发源码，不把这次更新冒称为比赛截止前内容。

## 在线入口

- [官网](https://123.60.8.174/official/)：产品介绍、团队、个人联系方式与真实产品视频。
- [正式产品](https://123.60.8.174/)：玩家、商家、运营角色入口。
- [独立演示站](https://123.60.8.174/demo/)：有单独的访问密码页、数据库、构建与会话；访问和业务凭据私下提供，不在仓库发布。

## 当前变化与验证范围

v2.3.50–54 加入独立硬件演示实例、普通网页访问密码页、金币确认局部反馈、NFC浏览器帮助与演示商家账号配置。v2.3.54 独立演示卡包允许领取标为不可实际消费的展示券，写独立展示表，不写普通claims、积分、金币或库存；NFC待领 → 商家确认收到金币 → 普通个人券 → 后续核销仍是另一条链。

已经实际验证的本批范围：

- 产品展示券真实后端模块/内存SQLite **40项通过**（22展示自领＋18原硬件链）；实际按钮组件内存mock **16项通过**。组件mock不等同真实发券。
- 独立HTTPS演示站真实自领/卡包/刷新 **10项通过**；自领恢复后NFC软件服务器链 **10项通过**，GPS为模拟、NFC为配置网址、设备码为手填，不等同实物碰读或真实手机定位/相机。
- v2.3.53 独立演示商家密码表单与本店权限 **8项通过**。私有密码不随源码提供。
- 官网v1.0.4已检查/构建并上线；真实Chromium本地和公网各 **12项通过**，含实际解码播放、暂停/seek/重播、390与1440布局、键盘、减少动态、错误重试及Range206。手机视口仿真不等同用户实机或全屏/投屏验收。

产品定点部署检查/构建使用各次服务器基线，不把历史v2.3.49整包结果算作当前v2.3.54全量源码结果。当前整包源码发布检查结果以本次发布核验记录为准。正式实例仍沿用v2.3.49业务基线和后续四文件UI定点更新，独立demo已更新至v2.3.54；公开源码版本不等同两个服务器实例全量同步。地图另线配置、SMTP实际投递和物理NFC/GPS/相机没有在这次GitHub更新中重新验收。

不存在已证实的真实商场试点或转化数据；产品设计与商业目标不作为实测业绩。详细历史通过/失败及限制保留在各项目的技术架构中。

## 目录

| 路径 | 内容 |
| --- | --- |
| source/mall-quest | 产品React19/TypeScript、Vite/Vinext、Workers/D1与Drizzle源码，包含全部17个迁移、真实业务及测试脚本 |
| source/mall-quest/build | Vite插件等编译所需源码，不是可删除构建缓存 |
| source/official | React18/TypeScript/Vite6静态官网最新源码、视频与封面；不带node_modules/dist |
| deploy/official | 官网v1.0.4已经实际验证的19个静态部署文件，含原片与网页MP4容器版本 |

## 本地运行

产品要求 **Node.js >=22.13.0** 与npm，沿用package-lock.json：

```powershell
Set-Location source/mall-quest
npm run install:ci
Copy-Item .env.example .env
# 在私有配置中填写自己的地图/SMTP/管理员初始化配置后，首次空目录初始化：
npm run db:local
npm run dev
```

仅首次全新本地目录使用db:local；既有部署先备份并按运行说明增量迁移，不清空数据。默认本地开发127.0.0.1:5173。npm run check与npm run build用于类型检查与生产构建。

完整地图需要配对的AMAP_WEB_KEY/AMAP_SECURITY_JS_CODE；门店POI使用独立Web服务AMAP_REST_KEY，不互换。MAIL_*仅服务端用于邮箱验证。管理员首次初始化密码由DEMO_ADMIN_PASSWORD配置，不会覆写既有账号。以上私有值、数据库与设备凭据均不随仓库发布。正式源码默认HARDWARE_DEMO_INSTANCE=false与空路径前缀；独立demo由隔离构建及独立部署准备，不能通过URL参数启用。

官网：

```powershell
Set-Location source/official
npm ci
Copy-Item .env.production.example .env.production
npm run check
npm run build -- --configLoader runner
```

.env.production.example只有4项公开VITE配置，复现已上线的/official/视频版本；VITE_变量会进入浏览器，不放私有密钥。播放器不自动播放，真实开始后封面连续渐隐，原画面完整显示；原片15秒/1080p带字幕但无音轨。网页版本只做faststart重封装，915个编码包与原片逐包相同，不重编码画面或字幕。

部署官网时使用deploy/official内容，固定地址/official/不变；服务器已有SPA回退与/official/media/静态路径，缺失静态资源应404而非HTML回退。先更新资源，最后原子替换index.html，保留旧哈希资源。不运行产品db:local或重启产品进程。

## 项目说明

- [产品技术架构](source/mall-quest/技术架构.md)、[运行说明](source/mall-quest/运行说明.md)、[协作规则](source/mall-quest/AGENTS.md)
- [官网技术架构](source/official/技术架构.md)、[官网运行与配置](source/official/README.md)

本仓库不含硬件固件完整工程、真实用户数据库、依赖目录、私有运行配置或访问/业务密码。固定设备码不构成密码学防复制证明；实际领取仍由服务端授权与商家确认。实物测试边界请按架构文档核对。

## 本次发布核验

比赛结束后的公开源码快照：产品 v2.3.54，官网 v1.0.4。隔离发布副本的完整产品类型检查与生产构建均退出 0；官网本地和公网播放各 12 项通过。详见 [发布验证记录](verification/latest-release.json)。保留原仓库、既有版本与真实提交时间，本次不修改服务器。
