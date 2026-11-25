# Offer Workbench 品牌资产

本目录为可公开的 Logo 设计资产，沿用项目 MIT 协议。主色为 `#2455F4`，深色为 `#182238`。

标识以折页结构构成 Offer 首字母 O，右上斜切开口表达工作流的衔接；几何结构与留白保持简洁、理性。品牌风格与实际AI能力分开说明，模型接入仍由用户配置。

## 选择文件

| 用途 | 文件 |
|---|---|
| 导航／常规蓝标 | [logo/mark-blue.svg](logo/mark-blue.svg) |
| 深色背景／黑白印刷 | `logo/mark-white.svg`、`logo/mark-black.svg` |
| 浏览器 16–32 px | `logo/mark-small.svg`、`logo/favicon.ico` |
| 项目头像 | `logo/avatar.svg`、`logo/avatar-512.png` |
| 透明 PNG | `logo/mark-blue-1024.png`，另含 64／256／512 px |
| 横向字标 | `logo/wordmark.svg`、`logo/wordmark.png` |
| GitHub 展示横幅 | [GitHub展示横幅.png](GitHub展示横幅.png)，1280 × 640 |
| 全套预览 | [品牌预览.png](品牌预览.png) |

图形 SVG 为真实矢量路径，无嵌入位图；小尺寸版省略折页细节。组合字标 SVG 保留可编辑文字，使用蓝色斜体 Arial / Helvetica，跨系统可能有字体差异。固定排版使用 PNG，或在设计软件中将文字转轮廓。

保留标识周边至少主图形宽度 1/8 的空白，不拉伸、不增加渐变或阴影。

## 来源与再导出

概念由内置 ImageGen 探索，再进行精确几何矢量重建；最终资产不是原始生成位图自动描摹。原图边缘噪点未带入最终矢量。

提示要点：single cobalt #2455F4, minimal geometric O, two folded document forms, upper-right diagonal opening, negative space, flat, transparent, no text, no robot, no sparkle, no gradient, no 3D, no separate arrow.

在 macOS 安装 Node.js 和 Google Chrome 后，运行 `node docs/brand/render-brand.mjs` 可从 HTML / SVG 再导出 PNG。脚本启动独立的临时浏览器，不使用个人登录状态。favicon 为小尺寸 PNG 的 ICO 格式导出。

已检查图片尺寸、透明通道及小尺寸显示；未做商标检索。v0.8.0已在三页导航及浏览器图标使用统一字标；折角沿内边缘增加小圆弧过渡，减轻锐角割裂。GitHub旧演示视频暂保留至1.0.0。

营销正文、评论、运营资料和社交平台海报不属于本目录，也不得进入仓库或公开源码包。
