# 逛道宝官网
版本：1.0.4；最后更新：2026-10-04（Asia/Shanghai）。

固定官网：https://123.60.8.174/official/ 。产品入口：https://123.60.8.174/ 。
React 18 + TypeScript + Vite 6 + React Router + Tailwind 静态前端，沿用 npm 锁文件。

## 运行和配置
运行 npm ci、npm run check、npm run build。
要复现本次已接入视频的生产构建，先复制 .env.production.example 为 .env.production；模板仅含4个公开VITE配置，不含私有配置或凭据。
开发 npm run dev；预览 npm run preview -- --host 127.0.0.1；访问输出地址的 /official/。
本机 Vite 配置加载权限受限时可用 node node_modules/vite/bin/vite.js build --configLoader runner；
本次实际构建采用 npm run build -- --configLoader runner，未替换原插件、包管理器或生产配置。
.env.example 中 VITE_SITE_BASE 默认 /official/，VITE_PRODUCT_URL 默认 HTTPS 产品根入口。
VITE_PRODUCT_VIDEO_URL 为空时没有播放器；本次接入用户提供的 captioned.mp4。
最终视频配置为VITE_PRODUCT_VIDEO_URL=/official/media/product-demo-20261004-web.mp4；封面配置为VITE_PRODUCT_VIDEO_POSTER=/official/media/product-demo-20261004.jpg。
上述资源分别位于public/media/product-demo-20261004-web.mp4与public/media/product-demo-20261004.jpg；Vite构建会复制到dist/media/，部署必须同时保留这两项。原captioned.mp4及首轮product-demo-20261004.mp4保留；最终视频只重封装网页MP4容器，不重新编码画面/字幕。沿用Nginx已有/official/media/静态资源规则，缺失文件返回404，无需改配置或重载。
所有 VITE_ 变量公开到浏览器，禁止存放私有凭据。

## 页面和交互
/ 首页；/product 功能；/product/detail 落地准备；/team 团队和个人邮箱；
/contact 重定向 /team#contact。以上路径均带 /official/ 前缀。
首页用单次错峰入场与原生桌面滚动视差；手机不持续视差，减少动画或不支持相关 API 时完整显示。
团队介绍为独立模态抽屉，不推动同排卡片；姚宇轩照片裁切对准人脸，原照片不变。
简介整块连续滑入、滑出，照片文字保持一体且没有延迟显现；背景同时柔和变暗，减少动态效果时直接打开/关闭。
1.0.3 修正原生弹层自动焦点滚动：外层不滚动，关闭按钮聚焦不改变视口，正文仍可独立滚动。四位成员共享这一处理。
产品提供返回官网入口，不注销会话。设计截图标为设计展示，不代表线上业务数据。
首页“从屏幕，走进门店”展示真实视频封面；点击播放并实际开始后，封面以420ms透明度过渡移除。原生播放器控制暂停、进度和全屏，结束后可重播；手机支持内嵌播放，画面完整显示不裁剪。原生控制条暂停或交互时可能暂时覆盖画面下缘。减少动态效果取消封面过渡与加载旋转，不自动播放。
加载/暂停/结束/错误均有可读提示；失败或慢加载可重新加载。素材无音轨，不提供音频或旁白。

## 部署和验证
将 dist 内容更新到 /www/wwwroot/guangdaobao-static/official/。
当前 Nginx 已配置该静态路径与 SPA 回退，本次更新无需修改 Nginx、HTTPS 或产品路由。
备份原静态目录；先部署资源，最后原子替换 index.html；保留旧哈希资源照顾缓存客户端。
官网更新不运行 db:local，不重置数据库，也不重启产品进程。
此前官网版本的验证按原批次保留。本次首轮原文件核对、check/build、本地12场景、静态部署18文件及公网HTTP6项通过；随后公网长诊断发现fragmented MP4需先完整下载13.3MB才播放，约32秒完成下载，属于首播等待体验问题。最终改用-c copy -movflags +faststart网页容器版本，915个编码包SHA/大小与PTS/DTS完全一致，没有重编码或改变画面/字幕；原片保留。
最终check与两次build退出0；最终19文件部署逐项SHA核对通过，HTTP6项通过，最终网页容器版本地及正常TLS公网真实Chromium各12/12项通过，覆盖真实解码/播放、暂停/seek/重播、布局、过渡、键盘、减少动态、错误重试及Range206/缺失404。公网390px/1440px封面、播放与暂停的6张截图实际审查无横溢或相邻文案重叠。手机为视口仿真，未声称用户实机或实际全屏/投屏通过；首轮证据独立保留。证据见work/official-video-v104/check-build-report.json及work/qa-official-video-v104/下的browser-report.json、live-browser-report.json与visual-review.json。
最终部署前备份于/home/mallquest/backups/official-v104-web-video-20261004-095812/before；首轮备份/home/mallquest/backups/official-v104-video-20261004-090948/before亦保留。旧哈希资源及原片保留，Nginx、产品数据库与GitHub未改，产品进程无重启。
此前产品 v2.3.48 已独立构建与部署，备份、迁移和账号核验与官网验证分别记录。本批不更新产品源码、账号、数据库或地图。
完整测试边界及版本说明见 技术架构.md；不得把本轮浏览器检查扩展为现场硬件闭环通过。
正式视频已收到并进入本批接入；高德配置、SMTP 真实投递及手机实物领取核销不属于本次视频更新，不在此新增通过结论。
本次只部署官网，不推送 GitHub 新提交、标签或 Release；仓库保持用户要求的回退状态。

## 产品门店搜索更新的交付边界

此段保留此前产品 v2.3.49 交付边界，非本次视频更新的验收：当时追加产品源码与标准构建。门店搜索由独立REST服务及AMAP_REST_KEY提供，JS地图凭据与SDK代理保持；本地接口和实际组件隔离验收通过，真实搜索依赖正确Web服务Key和后续部署，当时尚未确认通过。官网1.0.2已部署到原固定URL；该产品补丁不修改官网静态内容、URL或Nginx配置。
