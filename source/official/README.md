# 逛道宝官网
版本：1.0.0；最后更新：2026-10-03。

官网为 React 18 + TypeScript + Vite + React Router + Tailwind 静态前端。
默认部署 /official/，原产品保留根路径。所有“体验产品”链接使用公开配置 VITE_PRODUCT_URL，默认 http://your-server.example.com/ 。

运行：npm ci → npm run check → npm run build。
本地：npm run dev，访问服务输出地址的 /official/ 。
生产预览：npm run preview -- --host 127.0.0.1，访问 /official/ 。
沿用原 package-lock.json，不替换包管理器。

公开配置参见 .env.example：
VITE_SITE_BASE 默认 /official/；VITE_PRODUCT_URL 为产品入口；
VITE_PRODUCT_VIDEO_URL 留空时不展示假播放器，视频稍后提供；
VITE_PRODUCT_VIDEO_POSTER 为可选封面。VITE_ 配置会进入浏览器，不放私有凭据。

页面：/ 首页；/product 核心功能；/product/detail 落地准备与试点流程；
/team 团队与个人邮箱；/contact 重定向到 /team#contact。
官网路径均带 /official/ 部署前缀。官网不保存咨询，不发送邮件，不提供资讯订阅。

金币 NFC 领取流程：
地图与线索 → 碰金币 NFC、通过到店范围校验保存申请 →
商家识别设备、核对玩家并接收实物、确认奖励 →
正式券进入卡包（积分记入账户）→ 日后凭个人券二维码核销。
设备码可重复用于识别金币，不会因扫码自动发券。普通观察题任务保留独立答题领奖流程。
PPT 截图标明“设计展示”，不代表线上实测数据。商业效果由实际试点验证。

源码与静态构建分目录、合为一个压缩包；若同包附产品源码，则来自用户提供的 v2.3.42 ZIP，产品没有因此重新构建或修复。
执行报告记录本次官网安装、类型检查、构建和 ZIP 一致性结果。
浏览器验收与服务器部署另行核实，不提前声明通过。

部署 dist 内容到 /www/wwwroot/guangdaobao-static/official/。
Nginx 在保留原产品 location / 的前提下添加：
location = /official { return 302 /official/; }
location = /official/index.html { root /www/wwwroot/guangdaobao-static; add_header Cache-Control "no-cache"; try_files $uri =404; }
location ^~ /official/assets/ { root /www/wwwroot/guangdaobao-static; try_files $uri =404; }
location ^~ /official/images/ { root /www/wwwroot/guangdaobao-static; try_files $uri =404; }
location ^~ /official/brand/ { root /www/wwwroot/guangdaobao-static; try_files $uri =404; }
location ^~ /official/media/ { root /www/wwwroot/guangdaobao-static; try_files $uri =404; }
location ^~ /official/ { root /www/wwwroot/guangdaobao-static; try_files $uri $uri/ /official/index.html; }
修改前备份实际配置，nginx -t 通过再重载。静态资源缺失应返回 404，页面刷新回退到官网 index。
官网更新不执行产品数据库初始化，不为了静态文件重启产品进程。

验收：各页面直接访问及刷新、手机布局、图片与样式、个人介绍键盘操作、减少动态效果、个人邮箱、“体验产品”真实跳转，以及原产品与 NFC 深链接。
尚需视频；正式使用所需域名 HTTPS，以及交接记录中的地图代理、SMTP 投递和产品现场流程，仍需在服务器核实。
服务器清理只针对核实后的错误文件；保留生产库、WAL、私有配置及有效恢复备份。
