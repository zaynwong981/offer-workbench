# 贡献指南

首先阅读 [PROJECT.md](PROJECT.md) 与 [AGENTS.md](AGENTS.md)。新增功能先对应需求 ID；使用独立分支，提交前执行匿名测试与隐私门禁。发布和回滚见 [docs/RELEASING.md](docs/RELEASING.md)。

# Contributing

Use Python 3.11+ and a local virtual environment. Run `python -m unittest discover -s tests -v` before proposing changes. The application intentionally has no frontend build dependency.

Keep anonymous seed data separate from private runtime state. Tests must use temporary directories and synthetic job/resume data. Do not make real BOSS network requests in tests. New connector actions must have explicit scope, bounded requests, and clear user-visible outcomes; exports must never imply that an application was submitted.

Keep changes to resume facts under user control. Matching must expose evidence, missing information and the rule meaning. Do not present keyword coverage as probability of an offer.

Use the source-only package script for releases. Any change to its allowlist requires a privacy review. Read third-party licenses before vendoring assets.
