# 开发、发布与回滚

代码与数据分开管理；Git 管代码，不管个人简历、求职记录或配置。

## 日常开发

从 main 建 `feat/<需求ID>-<描述>` 或 `fix/<问题>`。修改前查 PROJECT.md，提交前跑对应测试与隐私门禁。仅添加白名单中本次修改文件，禁止 `git add .`。PR 说明问题、结果、验证、兼容性和限制。先 PR／CI 再合并；不强推 main，不修改已发布标签。

版本以 VERSION 为准，采用 0.x.y：新增可兼容能力递增次版本，修复递增补丁；破坏数据兼容必须提前说明迁移与备份。CHANGELOG 按版本保留历史。

## 发布

1. 更新 VERSION、RELEASE.json 的日期、CHANGELOG、PROJECT 和 docs/VALIDATION；每个大版本围绕最新完整求职流程重写 README，更新合成演示，不把单个新功能当成产品全貌。确认演示在独立目录可用、视频不出现个人路径。
2. `python scripts/privacy_check.py`；完整 Python／Node 回归；真实浏览器验收。确认 Git 跟踪列表与白名单一致，人工检查新增公开内容。
3. 推送开发分支，等待 GitHub Actions 的各系统矩阵通过。macOS 本地通过不等于 Windows/Linux 通过。
4. 合并后在确切提交创建签注标签，如 `git tag -a v0.6.0 -m "OfferWorkbench 0.6.0"`，推送标签。
5. `release.yml` 会在该标签版本上重新跑测试／隐私检查，再打源码包、生成 SHA-256 并创建 GitHub Release。不含个人数据或二进制安装器。
6. 核对远程 tag SHA、Release 文件与校验值。CI 未通过不得把版本记为已发布稳定版。

首次开源是清洁历史起点，旧手工源码包不能假装成旧 Git 标签。旧版包保留在本机 dist，不上传个人工作目录。Release 的源码包也是显式白名单打包。

## 升级前备份

先保存所有编辑器草稿，停止所有使用这份数据的工作台服务，再运行：

```sh
python scripts/snapshot.py backup --data-dir data --config config.local.json --output backups/pre-v0.6.0 --stopped
```

没有本地配置时省略 `--config`。快照包含 data 的简历、历史、SQLite 日程机会和可选配置，含个人信息，禁止上传。脚本用 SQLite backup、哈希清单和临时目录完成快照；`--stopped` 是操作者确认，不自动杀进程。PDF 在自定义目录，需另行保留；浏览器未保存草稿不在快照内。

## 回滚：先在新目录恢复验证

```sh
git worktree add --detach ../offer-workbench-rollback v0.6.0
python scripts/snapshot.py restore --snapshot backups/pre-v0.6.0 --output ../offer-workbench-restored
python ../offer-workbench-rollback/server.py --port 8767 --data-dir ../offer-workbench-restored/data --export-dir ../rollback-exports
```

将标签和快照替换为同一个已知可用版本，启动前安装对应 requirements。配置备份位于恢复目录，CLI 参数优先；确认导出位置，不能误写真实 PDF 目录。恢复脚本校验每个文件，拒绝覆盖已有目标，原数据不动。核对简历版本数、机会数、日程数、照片和导出 PDF 后，停止两端服务，人工切换启动路径；保留失败版本与回滚前快照便于排查。

不要把较新的数据库直接交给不理解它的旧版导入器。恢复旧快照会舍弃快照之后的编辑；先额外备份新数据，比较差异再决定。修复线上版本优先新补丁／git revert 提交，而非删远程历史。
