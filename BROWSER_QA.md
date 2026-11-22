# Browser validation

## v0.4.0 salary scenarios — 2026-11-18

The salary flow was exercised in the real local browser against an isolated local service with anonymous resumes and a clearly labeled test opportunity. No recruiting requests were made.

- A 15,000 yuan × 12 salary reference scenario rendered annual cash net 145,896 yuan, annual tax 6,744 yuan and individual contributions 2,280 yuan/month in both cities with first medical plan and 5% housing fund.
- Changing salary to 20,000 and 14 salary months recalculated totals immediately. Switching the qualified annual-bonus option and adding a 1,500 yuan monthly special deduction updated the cash and tax breakdown separately.
- Guangzhou at 50,000 yuan/month applied distinct insurance/fund caps; the city comparison and 12-month withholding detail displayed different reference outcomes.
- Empty salary hid old totals and showed a field error. A manual 13% housing-fund rate was rejected; returning it to 5% restored the result.
- Manual pension base changes survived refresh and stayed separate from the two-city reference table.
- Opening an anonymous 20–30K·14-salary opportunity cleared the old salary, preserved 14 salary months and offered explicit lower/upper choices. Selecting the upper bound populated 30,000 and recalculated.
- Changing salary after opening monthly details kept the details expanded after the observed collapse issue was fixed.

These are fixed-current-parameter annual scenarios, not historical 2026 payroll reconstruction or tax-return filing. Some local caps remain explicitly marked as derived reference values; see `SALARY_POLICY_SOURCES.md`. Browser verification establishes implementation behavior, not unverified policy authority.

## v0.3.0

Date: 2026-11-18 (Asia/Shanghai).

The actual browser UI was exercised through Codex's Chromium browser. Destructive and concurrent-edit scenarios used a separate localhost service with anonymous resumes and opportunities. BOSS success/error responses in that isolated service were fixtures. This report does not claim authenticated live BOSS search success.

| Scenario | Observed result after fix |
| --- | --- |
| Edit salary preference, switch tabs, return | Unsaved value and draft notice remain. |
| Enter search keyword, switch tabs, return | Entered keyword remains. |
| Start search, switch to opportunity management before response | Opportunity table remains; results stay under search. |
| Clear opportunity salary and address, save | Old values no longer reappear. |
| Switch resume with a version URL, refresh | Selected version and return context remain. |
| Manage 18+ resume versions | Version list scrolls; backup/export buttons remain visible. |
| Create targeted resume, edit, return to opportunity | Returns to the same opportunity and selects its targeted resume. |
| Request the same targeted resume again | Reuses the existing version ID. |
| Export from the opportunity | Exports the selected targeted version, keeps the application status unchanged. |
| Remove an associated resume in the isolated fixture, then export | Missing association is shown; no automatic replacement/export. |
| Two editor windows at one revision; A saves, B edits | B receives a conflict; A's newer data is preserved. |
| Open a new editor with the older B draft present | Editing controls are locked; complete backup is available before replacement. |
| Download stale draft, open replacement confirmation, cancel and use saved data | Backup downloads; A's newer content remains. |
| Simulated BOSS authentication error | Connection instructions and manual-JD alternatives are available; no automatic retry. |

Regression tests additionally cover session draft serialization/restoration, stale recovery, export/preview separation, ID rotation, invalid inputs and source-package privacy. An unsaved form's browser-native leave prompt can be retained by the embedded browser; state serialization is also verified independently. Saving to the local server remains the durable action. Closing a browser tab may discard its unsaved career drafts.

Test artifacts were isolated from personal resumes. Existing personal resume content and the configured export directory were checked for preservation. The release remains local-only; Windows/Linux execution and live platform authentication are separate acceptance items.


## 0.5.0 界面升级验收（2026-11-21）

- 独立本机服务使用匿名简历与合成头像，不连接 BOSS 招聘平台。
- 使用 design-taste-frontend 的无头 Chrome 截图脚本执行实际页面交互；53 项断言通过。
- 验证两套导航、菜单展开/键盘选择/Escape、动态医保选项、FormData、禁用状态、弹窗内菜单；照片取消不写入、确认后保存 500×700；BOSS 手册四步、操作系统切换和状态提示。
- 在 320、390、768、820、1024、1440px 检查简历页、薪酬页、说明页无整页横向溢出，窄屏 PDF 预览切换可用，下拉菜单不越出视口。
- 修复了旧版窄屏薪酬结果只占半栏的问题；加强辅助文字与焦点对比度，补齐可见字段标签和触控尺寸。
- Python 50 项、编辑状态 8 项、其余 Node 38 项，共 96 项通过。
- 当前三方向简历分别渲染为 1 页；教育信息同排、主题冒号、经历留白与照片比例已人工查看渲染图。PDF 排版不会改写原始简历字段。
- 本机原简历 JSON、机会数据库和配置文件 SHA-256 保持不变。所有正式导出继续使用原配置目录。
- 性能检查：0 FAIL，4 WARN；保留 PDF.js 与 PDF 嵌入字体，避免牺牲实际 PDF 预览。CLS 为 0。
- 设计技能的 layout/check.mjs 出现内部数据异常（sections undefined）。最终门禁的适用范围与剩余项见 UI_UPGRADE_QA.md；不将营销站规则不适用或检查器异常表述为全部通过。
- 未验证：真实 BOSS 登录与在线搜索、Windows/Linux 实机或远程 CI；本次不改变招聘行为。


## 顶栏切换位移修复（2026-11-21）

对照用户录屏复现：简历页品牌继承旧侧栏的左右 8px、底部 20px 内边距，图标相对求职页右移 8px、上移 10px；两页默认行高也不同。
由共享顶栏显式设置品牌 padding、line-height、图标固定尺寸与顶栏文本行高。
在真实 Chrome 中按「求职 → 简历 → 求职 → 连接说明 → 简历」连续导航，覆盖 320、390、650、768、820、1024、1440px，共 35 次测量通过：图标、品牌名称、品牌容器及 tab 容器坐标和尺寸一致。
本次仅修改共享 CSS，不改动个人资料或 PDF 排版。


## PDF 顶部间距修复（2026-11-21）

移除照片对页头最小高度的影响，顶部文字列宽不随照片开关变化。照片常规框从 50×70pt 调整为 58×81.2pt，顶部距纸边 18pt，照片下缘与首节分隔线至少相隔 8pt。
当前三个简历方向各验证显示/隐藏照片，共 6 份 PDF，均为一页。逐字坐标完全一致，且与修复前隐藏照片的排版坐标一致；栅格差异仅发生在右上角照片区域。已查看三份含照片 PDF 的渲染结果，PDF 排版回归 2 项通过。


## 完整使用文档弹窗（2026-11-21）

「查看完整使用文档」改为本页原生 dialog：大屏淡蓝磨砂卡片、固定标题与关闭按钮、正文独立滚动、桌面章节目录。README 实时读取本机原文，更新记录与政策来源在同一弹窗切换。原始 HTML 按文本展示，外部链接只允许 HTTP/HTTPS；本机文档使用固定白名单。
真实 Chrome 在 1440、820、390、320px 验证，共 44 项通过：同页打开、窗口边界、标题/列表/代码/表格、读到末尾、关闭恢复位置及焦点、关联文档返回、原生取消、失败重试和不执行 HTML/危险链接。HTTP 集成与源码隐私检查通过。

补充视觉复核：修正匿名验收页 viewport 后，390px 实际手机视口截图确认卡片完整位于窗口内，关闭按钮和底部提示固定可见，正文独立滚动。

## 搜索缓存与异常结果处理（2026-11-21）

只读核对 CLI 缓存：产品经理第 1 页 15 条且含薪资；第 2 页被保存为 0 条；AI 产品经理第 1 页 15 条但薪资为空。缓存 TTL 为 24 小时，键不包含浏览器登录状态。

手动搜索添加 `--no-cache`；空页不再宣称没有符合条件岗位；缺薪资显示“未读取到薪资”并计数提示；不将 CLI 页内条数冒充全站总数，不自动追加详情或翻页请求。

适配器 18 项、前端行为 13 项、匿名 HTTP 集成 13 项通过；真实 Chrome 匿名场景 10 项通过，覆盖正常薪资、页码传递、空页、缺薪资、风险错误与无自动重试。

在线验收未通过：首次 AI 产品经理第 1 页读取返回 ENVIRONMENT_RISK（平台 code 37）；用户确认网页恢复并授权清锁后，产品经理第 2 页仍返回相同风险。已停止平台请求并保留重新生成的风险锁。尚未确认最初空页和缺薪资的上游成因，不将缓存修复或模拟检查表述为在线恢复。

后续需在平台会话恢复且用户明确恢复任务后，有限验证三个搜索场景，核对新鲜原始响应的 jobList、salaryDesc 和分页字段；网页可用或第一页缓存命中不能替代接口验收。


## 飞书登记需求修订（2026-11-22）

依据需求文档 revision 254 完成文档弹窗紧凑标题栏、目录字号、求职侧栏和备份按钮、指定简历命名提示、BOSS 风险排障说明。真实 Chrome 匿名验收 56 项通过，覆盖 1440×900、1280×640、1024×400、820×600、390×844、320×568；包括按钮边界、无横向溢出、正文滚动、固定关闭栏、实际新建提示和本机风险状态文案。前端求职 13 项及编辑器状态 8 个场景通过，HTTP 集成 13 项通过。

第 4 项仅完成解释与恢复指南，不把 BOSS 在线风险、分页、薪资读取标记为已修复；未清锁、未请求 BOSS、未修改个人资料或生成正式简历 PDF。

已在飞书原需求对应附图后追加 4 条修改批注，逐项读回成功；最终 revision 258。前三项标记已完成，第 4 项标记部分完成，明确在线接口待验收。正式本机服务的对应 HTML/CSS/JS 已读取确认生效。
