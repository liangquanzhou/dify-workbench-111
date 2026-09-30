# 验证记录 · 2026-09-30 UTC

## 范围

当前交付是开发首版，目标官方Dify1.11.1 / DSL0.5.0。只使用公共上游源码、官方Dify公共源码、npm官方依赖、全合成fixture和loopback HTTP模拟服务。未连接真实Dify或企业服务，未修改用户电脑，未读/上传企业源码、规则、凭据或case报告。Dockerfile已改为legacy stdio默认，镜像构建未实际运行。

## 已完成

- Node v24.19.0，npm11.9.0
- 固定源码基线：alexjiaguo/dify-mcp `cfaa2abafaf8807c0914eff1bb7b9909e6599293`
- 对照官方Dify1.11.1 `2058186f22b4e4d4e155f380c130f4e8f21622fa`
- 官方npm依赖安装全部使用 `--ignore-scripts`
- 原始上游118测试在改动前通过
- 最终 `npm run check`：TypeScript检查通过，169/169测试通过，legacy MCP单工具/调用门验证通过，CLI→HTTP合成失败→修复→成功演示通过
- 合成演示：两次读回一致，固定synthetic-app，created_apps=0，publish_requests=0
- 显式upstream stdio/HTTP MCP smoke均通过，保留174原工具但不作为1.11.1支持声明
- 独立API/安全审查回归29项已纳入完整测试；发现的问题已修复，包括stop task归属、SSE多终态、node-run未知结果、run日志绑定、credential日志脱敏和profile参数解析
- 额外恶意输入验证：自定义YAML标签/aliases、1000至10000层嵌套、unsafe整数均被拒绝
- `git diff --check`通过

## 依赖漏洞修复

首次 `npm audit --omit=dev` 提示6项：2 high、4 moderate。交付前已修复并重新锁定：

|依赖|修复前|交付锁定|
|---|---|---|
|yaml|2.8.2|2.9.1|
|@hono/node-server|1.19.14|2.1.3|
|fast-uri|3.1.4|3.1.8|
|hono|4.12.31|4.13.12|
|ip-address|10.2.0|10.7.2|
|qs|6.15.3|6.16.0|

@modelcontextprotocol/sdk保持1.30.0。最终完整npm audit为0 vulnerabilities（99包，记录见npm-audit-final.json）。这是查询时的已知漏洞结果，不是永远安全保证；使用前按公司要求复扫。

## 不能由mock证明的事项

- 企业SSO/cookie续期/反代/RBAC真实可用性
- 公司fork实际payload、变量遮罩与secret保留行为
- 模型/Tool/HTTP真实执行、插件版本、费用与外部数据传输
- 真实Dify1.11.1端到端部署验收和生产稳定性
- 旧服务器缺少的变量/发布原子CAS；本客户端不可能补成强事务锁
- 所有复杂节点参数和类型的完整引擎验证

下一步按COMPANY-VALIDATION.md在独立环境、再专用公司测试workspace逐项验证，不直接进入生产。
