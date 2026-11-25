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

求职 JSON 备份 schemaVersion=4，包含 events、searchPlans、artifacts、submissions、materials、aiDrafts；可读 v1/v2/v3。导入旧备份意味着恢复到该版本所含数据，新字段恢复为空；v1 不含日程，UI 明确提示，导入前应导出当前备份。所有校验通过后单事务替换，失败不会删数据。简历备份仍独立，schemaVersion=1。

ICS 使用稳定 UID、SEQUENCE、UTF-8 75 字节折行；时间转换为 UTC；纯日期使用 VALUE=DATE。完成和待定事项不占忙闲。无 VALARM，提醒交给用户日历客户端。ICS 是快照，不能当成实时同步；重新导入的更新／去重由客户端决定。

兼容性：公开显示名为 Offer Workbench，原 `/api/career/*`、备份 kind `career-studio` 和服务 app 标识保留，避免破坏现有数据及脚本。旧浏览器草稿通过通用旧键后缀迁移到新的中性键名。

0.6.1 将源码整理到 app/backend 与 app/frontend；根目录 server.py 仅负责启动。旧静态 URL、/boss-help、API 与本地 data/config/export 位置保持兼容；/guide 是使用指引，/help 返回 docs/USER_GUIDE.md，/api/about 读取 VERSION 与 RELEASE.json。PDF 排版参数与 SQLite schema 不变。

0.7.0 新增 artifacts、submissions 两表。PDF、所选简历版本及共享个人信息／教育、岗位内容在导出时捕获；确认投递只引用该文件，requestId用于幂等，不重建历史。PDF和规范化JSON快照分别使用SHA-256校验；这是完整性检测，不是招聘方签收凭证。常规state只返回留档摘要，历史PDF通过同源GET取出。已确认投递的岗位禁止删除。

备份导入在写入前验证结构、关联与校验值，并在同一事务恢复。单PDF5MB，留档序列化总量40MB，导入HTTP64MB，其余请求8MB。本地服务请求队列提高到64，避免浏览器并行加载静态模块时连接队列过小。

## 0.7.1 偏好与筛选

`preference-options.json`保存离线城市编码、两级岗位／业务目录、薪资和经验条件；`preference_options.py`负责校验与受限编码转换，随career state提供前端。招聘类别存于原preferences和searchPlans JSON，无新表、不重写原数据；旧备份默认all。目录不写入用户备份。

BOSS适配器生成固定官方域名的URL，只传CLI已支持的白名单参数以避开旧名称映射；不接受任意外部URL。实习使用CLI原生jobType，不以实习请求代替校招。风险锁、单页、无自动重试保持原行为。能力依据见reference/BOSS_FILTER_SOURCES.md；离线参数验证不等于线上岗位结果验收。

## 0.8.0 素材与可选模型

`assistant.py`管理materials、ai_drafts、ai_usage三张新增表，不重写旧记录；`llm.py`统一配置、协议与有界请求。前端inline-ai.js承载多模型弹窗、段落对照和岗位分析，assistant-ui.js承载简历内素材库；默认未配置AI。点击操作通过/api/ai/run创建并发送一次性草稿，请求在全局简历锁之外执行，调用状态通过SQLite事务先登记。服务启动将中断请求标为失败，不自动重试；成本可能已产生。

采纳与撤销先在SQLite登记写入意图，再原子写入resumes.json，最后更新草稿。启动及请求结束时对照简历revision与目标段落恢复状态，冲突时只提示，不覆盖。素材和简历本身沿用版本冲突检查。

密钥位于data/.secrets/llm.json，POSIX目录700、文件600，Windows沿用用户目录ACL；前端只收到hasKey，普通备份及升级快照排除.secrets。接口HTTPS，显式允许的回环地址才可HTTP；不跟随重定向、45秒超时、不重试、响应最多2MB。OpenAI Responses发送store:false；服务商的其他保留政策由用户确认。

用量按北京时间日界记录输入估算与输出预留，不施加每日请求或Token配额，也不冒充服务商账单。备份恢复草稿强制imported且删除确认散列／写入意图，不能重放操作。最多1000素材、100草稿、500简历；单次最多20素材、100统计岗位。

## 0.8.1 多模型兼容

私有配置schemaVersion 2包含revision、activeId和models。读取旧单配置时只在内存映射，第一次保存原子迁移。编辑检查revision，删除选中模型后清空activeId，不自动选另一个。provider.env仅在本工具读取；环境密钥限对应官方地址，不能随自定义URL流出。

## 0.8.2 结构化分析

新extract/explore草稿带analysisVersion=2，由analysis_results.py验证分类标签、画像或探索方向，校验引用属于本次来源，限制长度与数量并去重。前端ai-analysis.js负责安全转义、紧凑展示及复制；旧items草稿保留兼容。SQLite表及求职备份schemaVersion=4不变，导入时验证新结果，失败不覆盖原数据。
