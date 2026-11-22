# 0.6.1 验收记录

日期：2026-11-22。V061-01…07 使用合成资料验证；没有调用招聘平台。

| 验证 | 结果 |
|---|---|
| Python | 64 项通过，覆盖旧 API／静态链接、版本元数据、PDF、备份与日历 |
| Node | 40 项通过；编辑器另有 8 个状态场景通过 |
| Chrome | 93 项通过；七组视口覆盖 1440×900、1280×720、1280×640、1024×768、768×900、390×844、320×568；月历／薪酬／偏好／顶部标志／页脚／文档弹窗验证 |
| 真实工作流 | 手动 JD → 匹配证据 → 专属简历 → 修改保存 → 实际 PDF 导出 → 机会管理 → 日历冲突 → 薪酬 → 使用指引；浏览器无异常 |
| 公开演示 | 35 秒 GIF／MP4，全部虚构资料、中性演示导出目录；逐阶段画面人工复核 |
| 个人升级 | 停止正式服务后快照；恢复 v0.6.1 后简历与配置哈希一致，settings／jobs／activity／events 逐表一致，原 PDF 导出目录保留 |

目录迁移不修改 SQLite schema、PDF 排版字号和个人数据目录。根目录 server.py 保留启动兼容；原 /boss-help、静态资源及 API URL 仍可使用。手机薪酬依次呈现到手、输入、扣款与奖金详情；短屏完整内容可滚动，不隐藏业务控件。

干净源码包独立解压可导入服务并生成 1 页 PDF；v0.6.0 可读取本版合成数据并生成 PDF。79 文件白名单隐私门禁通过。远程 CI 与 Release 最终结果在下方发布读回记录补充。公开发布只包含 scripts/package_source.py 白名单；浏览器原始日志、私人数据快照不进入 Git。

本轮不包含 LLM、自动投递、后台提醒、BOSS 在线恢复或薪资政策重新核验。四阶段未完成条目仍保留在 PROJECT.md。

## 0.6.1 发布读回

- [PR #1](https://github.com/zaynwong981/offer-workbench/pull/1) 已合并；[PR CI](https://github.com/zaynwong981/offer-workbench/actions/runs/44998324102) 六组系统／Python 矩阵全部通过。
- [发布工作流](https://github.com/zaynwong981/offer-workbench/actions/runs/44998665245) 的 Windows、macOS、Ubuntu 复验及打包发布全部通过。
- [v0.6.1 Release](https://github.com/zaynwong981/offer-workbench/releases/tag/v0.6.1) 已公开，标签对应 `7f93c0d4ccefcd82eafadbfb72f97117b2fc26e6`。
- 下载源码包的 79 个文件与标签 blobs 逐一相同；SHA-256：`d8bd46ca748903710107dbad0de47047c788d5d492a937504fecc78a32d73f77`。
- 独立解压可通过 server.py 启动；首页、求职页、指引、新旧文档入口、前端脚本和 PDF.js 共 7 条 HTTP 路由通过，匿名资料可导出 1 页 PDF。
- 本节是发布后的证据补记，不改写标签或既有 Release 附件。

---

# 0.6.0 验收记录

日期：2026-11-22。所有自动与浏览器测试使用虚构资料、隔离目录，不访问招聘平台。

| 验证 | 结果 |
|---|---|
| Python 完整回归 | 63 项通过：HTTP 来源校验、PDF、机会、BOSS mock、日程和备份恢复 |
| Node 回归 | 40 项通过：求职状态、薪酬、照片裁剪 |
| 编辑器状态机 | 8 场景通过：草稿恢复、并发编辑与岗位上下文 |
| 真实 Chrome | 42 项通过；1440、1024、768、390、320px；新建／编辑／取消／删除、冲突预览、恢复、ICS、顶部图标稳定 |
| 数据恢复演练 | 合成 SQLite＋JSON＋配置快照→新目录恢复；哈希一致，2 岗位／3 日程／3 冲突保留；损坏快照拒绝恢复 |
| 隐私门禁 | 71 个白名单文件与实际 Git 跟踪列表核对通过；私有数据／配置／备份不跟踪 |
| GitHub CI／Release | [首轮 CI](https://github.com/zaynwong981/offer-workbench/actions/runs/44991891357) 六组通过：macOS／Windows／Ubuntu × Python 3.11／3.12；Release 工作流将再次验证标签 |

日程语义包括：区间相接不冲突；取消完成不参与；DDL 落入活动单独提示；仅知日期不猜时刻；并发版本拒绝静默覆盖；导入先校验后事务替换；ICS 中文转义与 UTF-8 字节折行。

浏览器验收脚本和原始截图保存在本地隔离 QA 目录；公开演示仅保留经人工复核的合成截图与 scripts/demo.py。没有读取真实个人简历用于测试。

不在本轮验收范围：BOSS 在线恢复、LLM 接入、后台提醒、跨时区选择与日历双向同步。首次公开代码版本尚无上一公开版本；回滚机制已用合成资料演练，不伪造历史标签。

个人部署升级前已备份；升级后简历 SHA-256 不变，jobs／settings／activity 逐表一致，原 PDF 导出配置保留。此处不公开任何个人数据或路径。

## 发布读回（2026-11-22）

- [v0.6.0 Release](https://github.com/zaynwong981/offer-workbench/releases/tag/v0.6.0) 已公开；标签对应 `ec298ad3b958b60ca9df5decec49661a2dca0a07`。
- [发布工作流](https://github.com/zaynwong981/offer-workbench/actions/runs/44992063831) 三系统复验通过并发布源码包和 SHA256SUMS.txt。
- 下载公开包核对：71 个文件与标签 Git blobs 逐一一致；没有本地配置和个人数据；独立解压目录可导入服务并用匿名初始资料渲染 PDF。
- 源码包 SHA-256：`00a18cdc570251f05ab5e0bd0e1775d51645343edc8baab675a1a599dd9ff4af`。
- 本页发布读回记录属于后续文档提交，不重写已发布标签或 Release 文件。
