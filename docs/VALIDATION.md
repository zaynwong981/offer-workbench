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
