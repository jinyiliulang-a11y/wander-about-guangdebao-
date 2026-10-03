# 逛道宝官网
版本：1.0.2；最后更新：2026-10-04。

固定官网：https://your-server.example.com/official/ 。产品入口：https://your-server.example.com/ 。
React 18 + TypeScript + Vite 6 + React Router + Tailwind 静态前端，沿用 npm 锁文件。

## 运行和配置
运行 npm ci、npm run check、npm run build。
开发 npm run dev；预览 npm run preview -- --host 127.0.0.1；访问输出地址的 /official/。
本机 Vite 配置加载权限受限时可用 node node_modules/vite/bin/vite.js build --configLoader runner；
本次实际构建采用该命令，未替换原插件、包管理器或生产配置。
.env.example 中 VITE_SITE_BASE 默认 /official/，VITE_PRODUCT_URL 默认 HTTPS 产品根入口。
VITE_PRODUCT_VIDEO_URL 为空时没有播放器；用户的视频稍后提供，VITE_PRODUCT_VIDEO_POSTER 可选。
所有 VITE_ 变量公开到浏览器，禁止存放私有凭据。

## 页面和交互
/ 首页；/product 功能；/product/detail 落地准备；/team 团队和个人邮箱；
/contact 重定向 /team#contact。以上路径均带 /official/ 前缀。
首页用单次错峰入场与原生桌面滚动视差；手机不持续视差，减少动画或不支持相关 API 时完整显示。
团队介绍为独立模态抽屉，不推动同排卡片；姚宇轩照片裁切对准人脸，原照片不变。
简介整块连续滑入、滑出，照片文字保持一体且没有延迟显现；背景同时柔和变暗，减少动态效果时直接打开/关闭。
1.0.3 修正原生弹层自动焦点滚动：外层不滚动，关闭按钮聚焦不改变视口，正文仍可独立滚动。四位成员共享这一处理。
产品提供返回官网入口，不注销会话。设计截图标为设计展示，不代表线上业务数据。

## 部署和验证
将 dist 内容更新到 /www/wwwroot/guangdaobao-static/official/。
当前 Nginx 已配置该静态路径与 SPA 回退，本次更新无需修改 Nginx、HTTPS 或产品路由。
备份原静态目录；先部署资源，最后原子替换 index.html；保留旧哈希资源照顾缓存客户端。
官网更新不运行 db:local，不重置数据库，也不重启产品进程。
类型检查、构建、本地和真实 HTTPS 浏览器验证已完成，证据见同批 reports。
本轮产品 v2.3.48 已独立构建与部署，备份、迁移和账号核验与官网验证分别记录。
本交付备份提供已部署产品UI源码快照；高德由另一个窗口并行处理，不包含其当前源码或整份产品dist。
完整测试边界及版本说明见 技术架构.md；不得把本轮浏览器检查扩展为现场硬件闭环通过。
已知后置项：正式视频、高德 Key 类型配置、SMTP 真实投递及手机实物领取核销验收。

## 产品门店搜索更新的交付边界

本批追加产品 v2.3.49 源码与标准构建。门店搜索由独立REST服务及AMAP_REST_KEY提供，JS地图凭据与SDK代理保持；本地接口和实际组件隔离验收通过，真实搜索依赖正确Web服务Key和后续部署，尚未确认通过。官网1.0.2已部署到原固定URL；本次产品补丁不修改官网静态内容、URL或Nginx配置。
