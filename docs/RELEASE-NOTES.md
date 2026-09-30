# v0.1.0 · Dify 1.11.1 适配开发首版

拟发布目标：`liangquanzhou/dify-workbench-111`。本说明描述准备好的源码，不代表已创建远程仓库、发布 GitHub Release 或部署服务。

## 内容

- 默认 `dify-1.11.1` profile，原生 DSL 0.5.0
- 一个 CLI/MCP 入口：build、diff、sync、test、日志、节点调试与独立 publish
- 可配置本地生成器/现成 DSL 适配；不包含业务编译器或公司源码
- 固定 server/workspace/app/mode；同步原始编辑 hash，并进行摘要冲突检查和写后读回
- 既有 secret/Tool 凭据绑定保护，知识库引用显式映射，无安全转换保证时阻止
- 正确区分 SSE 成功/失败/停止/未知，run 与 task ID 分离，限制 stop 的 task 归属
- 发布默认关闭，要求完整成功测试和内容绑定；未知副作用不自动重试
- 中文文档、通用生成器示例、合成 fixture、169 项自动测试及 loopback CLI/HTTP 演示
- 保留显式 upstream profile 与上游 Apache-2.0 许可/固定提交来源

## 验证及限制

Typecheck、169/169 测试、legacy MCP smoke、合成失败→修复闭环和显式 upstream stdio/HTTP smoke 已通过。依赖已修复已知漏洞，构建时 npm audit 为 0。详见 VALIDATION.md 与锁文件。

尚未在真实 Dify 1.11.1 或企业 SSO/反向代理/RBAC 环境端到端验证。不得直接用于生产首次试验。复杂节点的完整语义、外部插件/模型和真实业务调用需要隔离验收。

旧服务器缺少变量/发布的原子条件锁；客户端的检查与读回不能补成强事务。发布确认字段不是独立人类审批系统。默认不返回完整业务输入输出，仍需宿主权限与数据政策。

## 公开版整理

面向特定使用者的生成脚本和产物路径说明已替换为通用合成例子。发布树不包含个人电脑路径、真实公司数据、账号凭据、node_modules、本地状态、日志或 git 历史。
