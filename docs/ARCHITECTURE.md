# 架构与数据

浏览器原生 HTML/CSS/JS → 仅监听回环地址的 Python HTTP 服务 → 本地 JSON／SQLite。无账户系统、遥测、云同步或第三方日历依赖。

| 文件 | 职责 |
|---|---|
| app/backend/server.py | HTTP 来源校验、简历并发版本、PDF 排版、静态资源白名单 |
| app/backend/career.py | 机会／偏好／跟进历史／日程事务与备份 |
| app/backend/schedule.py | 日程校验、冲突语义、ICS 编码；不发网络请求 |
| app/frontend/js/calendar-ui.js / app/frontend/css/calendar.css | 月历、议程、表单和即时冲突提示 |
| app/frontend/js/app.js | 简历编辑、浏览器草稿、PDF.js 预览 |
| app/backend/boss_adapter.py | CLI 只读 search/detail、单次请求、风险停止 |
| app/frontend/js/salary-*.js | 本地薪酬计算、城市政策快照与岗位薪资解释 |

0.6.0 在 SQLite 中增加 events 表，job_id 可空，关联岗位删除时级联删除相关日程。旧 jobs、activity、settings 不变；不把旧 nextDate 自动转换成虚构时刻。

日程字段：id、jobId、title、kind、status、allDay（仅知日期）、start、end、location、notes、revision。非全天采用 ISO 分钟字符串和 +08:00；区间采用 [start,end)，相接不冲突。仅知日期不推测冲突；deadline／offer 为时间点，可提示落入活动区间，但不会虚构持续时间。编辑／删除校验 revision 防止静默覆盖其他窗口。

求职 JSON 备份 schemaVersion=2，包含 events；可读 v1。导入 v1 意味着恢复到不含日程的快照，UI 明确提示，导入前应导出当前备份。所有校验通过后单事务替换，失败不会删数据。简历备份仍独立，schemaVersion=1。

ICS 使用稳定 UID、SEQUENCE、UTF-8 75 字节折行；时间转换为 UTC；纯日期使用 VALUE=DATE。完成和待定事项不占忙闲。无 VALARM，提醒交给用户日历客户端。ICS 是快照，不能当成实时同步；重新导入的更新／去重由客户端决定。

兼容性：公开显示名为 OfferWorkbench，原 `/api/career/*`、备份 kind `career-studio` 和服务 app 标识保留，避免破坏现有数据及脚本。旧浏览器草稿通过通用旧键后缀迁移到新的中性键名。

0.6.1 将源码整理到 app/backend 与 app/frontend；根目录 server.py 仅负责启动。旧静态 URL、/boss-help、API 与本地 data/config/export 位置保持兼容；/guide 是使用指引，/help 返回 docs/USER_GUIDE.md，/api/about 读取 VERSION 与 RELEASE.json。PDF 排版参数与 SQLite schema 不变。
