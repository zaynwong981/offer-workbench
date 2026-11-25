# AI接口与数据边界

核对日期：2026-11-25。DeepSeek与OpenAI已用固定文字完成有限真实连接验证；没有发送个人简历。Anthropic及自定义接口仍需按账号测试。预设模型不保证每个账号都有权限。

| 服务商 | 默认Base URL | 协议与官方依据 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | [Responses](https://developers.openai.com/api/reference/resources/responses/methods/create)，关闭服务端响应存储的请求参数为`store:false` |
| Anthropic | `https://api.anthropic.com/v1` | [Messages](https://platform.claude.com/docs/en/api/messages)，独立system字段、x-api-key与可配置anthropic-version |
| DeepSeek | `https://api.deepseek.com` | [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)，Bearer认证、messages与max_tokens |
| 自定义 | 本人填写 | 可选以上三种协议；Base URL填写到版本路径，工作台追加相应请求路径，不重复填写responses或chat/completions |

在「偏好与设置」添加模型，可选预设或填写服务商开放的模型ID。当前OpenAI预设为gpt-6.2-sol、gpt-6.2-astra、gpt-6-luna；DeepSeek为deepseek-flash、deepseek-v4-pro。Anthropic与自定义接口手动填写。测试使用弹窗中的当前配置，未保存也可测试；取消不改变已保存配置。删除当前模型后需要重新选择，不自动切换服务商。

自定义地址使用HTTPS；本机HTTP需要显式允许，支持localhost、127.0.0.1或::1。请求不跟随重定向，不自动重试，45秒超时。没有模型工具调用、文件上传或后台抓取。

## 点击操作与费用

保存配置不联网。配置模型后，点击「修改意见」「一键润色」「精简文字」「分析岗位要求」或「从简历探索方向」，即授权发送该操作所选内容，不再追加发送确认。固定连接测试仅发送测试文字。

润色发送所选段落、选中的参考素材与补充要求；岗位分析发送所选岗位正文；方向探索发送所选简历的教育、优势与经历。不自动附带个人资料区、照片、其他简历或岗位。经历正文仍可能包含个人信息，请在点击前检查。关闭弹窗不保证已发出的请求被服务商取消；结果保留在本机历史建议中。

没有本机每日请求或Token配额。仍有单次输入长度、输出上限和超时控制；服务商可能计费或限流，失败也可能产生费用。用量记录不是服务商账单。手工编辑、素材库和岗位本地统计无需模型。

## 密钥与备份

手动输入的密钥写入数据目录下`.secrets/llm.json`，多模型配置带修订号以检查并发编辑。旧单模型配置在第一次保存时迁移；只读取不会改写旧文件。也可引用进程环境变量，或本工具专用的`.secrets/provider.env`（KEY=value格式）；不写系统或shell全局环境。环境密钥只用于对应服务商的官方Base URL，POSIX目录700、文件600；Windows还需使用自己的系统账户权限。服务端仅返回是否已设置，不回传密钥。切换服务商或Base URL会清掉旧密钥。明文只用于本机受限存储和HTTPS认证，并非操作系统钥匙串加密。

密钥不进入浏览器存储、日志、Git、源码包、普通求职备份或升级快照。换机或恢复后需要重新填写。已有本机密钥不会因为导入求职备份而替换。

## 证据与修改

素材保存来源与待核实／已核实状态。模型结果不是事实证明：引用原句必须在本次所选素材、简历或岗位正文中找到；改写出现原段落或已核实素材中不存在的数字时拒绝直接采纳。数字检查不能证明所有语义真实，仍需本人核实职责、成果与确定程度。

每次只处理一个段落，原文和建议并排展示，可手动调整，核实后点击「替换这一段」。原段落已变更时拒绝覆盖；撤销也要求内容与采纳时一致。原始结果、来源快照、失败原因保存在本机草稿；从备份恢复的草稿仅供参考，不重放授权或直接改简历。
