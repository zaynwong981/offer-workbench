# 架构与数据

浏览器原生 HTML/CSS/JS → 仅监听回环地址的 Python HTTP 服务 → 本地 JSON／SQLite。无账户系统、遥测、云同步或第三方日历依赖。

| 文件 | 职责 |
|---|---|
| app/backend/server.py | HTTP 来源校验、简历并发版本、PDF 排版、静态资源白名单 |
| app/backend/career.py | 机会／偏好／跟进历史／日程事务与备份 |
| app/backend/workflow.py | 本地取舍、筛选方案、材料与不可变PDF／投递留档 |
| app/frontend/js/job-workflow.js / job-rules.js | 分栏、准备区、会话恢复与可解释本地排序 |
| app/backend/schedule.py | 日程校验、冲突语义、ICS 编码；不发网络请求 |
| app/frontend/js/calendar-ui.js / app/frontend/css/calendar.css | 月历、议程、表单和即时冲突提示 |
| app/frontend/js/app.js | 简历编辑、浏览器草稿、PDF.js 预览 |
| app/backend/boss_adapter.py | CLI 只读 search/detail、单次请求、风险停止 |
| app/frontend/js/salary-*.js | 本地薪酬计算、城市政策快照与岗位薪资解释 |

0.6.0 在 SQLite 中增加 events 表，job_id 可空，关联岗位删除时级联删除相关日程。旧 jobs、activity、settings 不变；不把旧 nextDate 自动转换成虚构时刻。

日程字段：id、jobId、title、kind、status、allDay（仅知日期）、start、end、location、notes、revision。非全天采用 ISO 分钟字符串和 +08:00；区间采用 [start,end)，相接不冲突。仅知日期不推测冲突；deadline／offer 为时间点，可提示落入活动区间，但不会虚构持续时间。编辑／删除校验 revision 防止静默覆盖其他窗口。

求职 JSON 备份 schemaVersion=3，包含 events、searchPlans、artifacts、submissions；可读 v1/v2。导入旧备份意味着恢复到该版本所含数据，新字段恢复为空；v1 不含日程，UI 明确提示，导入前应导出当前备份。所有校验通过后单事务替换，失败不会删数据。简历备份仍独立，schemaVersion=1。

ICS 使用稳定 UID、SEQUENCE、UTF-8 75 字节折行；时间转换为 UTC；纯日期使用 VALUE=DATE。完成和待定事项不占忙闲。无 VALARM，提醒交给用户日历客户端。ICS 是快照，不能当成实时同步；重新导入的更新／去重由客户端决定。

兼容性：公开显示名为 OfferWorkbench，原 `/api/career/*`、备份 kind `career-studio` 和服务 app 标识保留，避免破坏现有数据及脚本。旧浏览器草稿通过通用旧键后缀迁移到新的中性键名。

0.6.1 将源码整理到 app/backend 与 app/frontend；根目录 server.py 仅负责启动。旧静态 URL、/boss-help、API 与本地 data/config/export 位置保持兼容；/guide 是使用指引，/help 返回 docs/USER_GUIDE.md，/api/about 读取 VERSION 与 RELEASE.json。PDF 排版参数与 SQLite schema 不变。

0.7.0 新增 artifacts、submissions 两表。PDF、所选简历版本及共享个人信息／教育、岗位内容在导出时捕获；确认投递只引用该文件，requestId用于幂等，不重建历史。PDF和规范化JSON快照分别使用SHA-256校验；这是完整性检测，不是招聘方签收凭证。常规state只返回留档摘要，历史PDF通过同源GET取出。已确认投递的岗位禁止删除。

备份导入在写入前验证结构、关联与校验值，并在同一事务恢复。单PDF5MB，留档序列化总量40MB，导入HTTP64MB，其余请求8MB。本地服务请求队列提高到64，避免浏览器并行加载静态模块时连接队列过小。
