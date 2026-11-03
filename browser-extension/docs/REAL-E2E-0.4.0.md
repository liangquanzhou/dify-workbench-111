# 0.4.0 真实隔离验收

本次已跑通：真实上游插件存储 → 固定读工作流 → 实际 MV3 扩展 → 点击原版 Dify 节点显示表格。
这证明下述固定版本和合成场景，不代表公司 AgentHub 已验收或所有未来上游版本自动兼容。

## 环境与授权

- Dify API/Web 1.11.1，源码 revision 2058186f22b4e4d4e155f380c130f4e8f21622fa；原版镜像未修改。
- 独立 Compose project dmn-brian-e2e，仅 127.0.0.1:18181，独立卷、合成账户和表。
- Brian hu8627/dmn_json 0.5.18（预发布），包 SHA256：68222378271d5a1e682e4117e43d70db501c8212b4edad9a1d2665f85ab1d416。
- 原生安装 identity：hu8627/dmn_json:0.5.18@d6090dbe1a142828fc63b1f5d32af289fcdafa1020dd0c32997188782f93c018。
- 首次强制签名安装被拒绝。在仅限一次性测试实例的开发例外下，设置 FORCE_VERIFYING_SIGNATURE=false 并上传 verify_signature=false；安装任务 success。不是强制签名模式验收。
- Chrome for Testing 155，独立 profile，无头、启用浏览器 sandbox。真实加载候选扩展，有实际 service worker、activeTab 与 chrome.scripting 注入。
- 使用 Chrome Extensions.triggerAction 模拟工具栏动作；点击真实 ReactFlow 节点。没有伪造节点 props、注入构建脚本替代扩展或改写 Dify 前端。未宣称物理鼠标/OS 快捷键验收。
- 未访问公司环境，未装入日常浏览器。测试结束停止本次容器，保留本地合成数据与证据。

## 读取路径与权限

两套真实发布工作流均只有 Start → route_table_store → End：

- latest：op=table、table 固定、body_json 为空，无输入变量。
- version：op=version、table 固定、body_json 为空，只有 version 输入。

二者输出 status_code 与原始 result_json，避免 JSON 数值往返改变上游摘要。
模板由实际成功工作流导出，见 examples/reader-latest.yml 与 reader-version.yml。
模板中的 REPLACE_TABLE_NAME 必须由维护者替换。插件依赖也固定到此次实际包。

真实权限测试使用全新无 console cookies 的请求上下文，仅取得查询应用 passport。
伪造 op=save、其他 table、body_json 均未改变固定操作；console 编辑接口返回 401。
指定不存在版本得到 status_code=404，没有回退最新版。
这验证了应用调用者不能通过该读应用改变图或存表；没有把 console 编辑权限称为只读授权。

原版 storage 以 tenant + plugin ID 分域。本次不同应用的真实工具读回同一表、版本和摘要。
公司分支的 storage 作用域、SSO、代理路径与 app access 配置未访问；跨租户端到端测试未运行。
本地匿名应用只暴露回环合成数据。公司使用前必须采用公司已有授权的应用访问控制，不默认开放匿名查询。

## 扩展行为

首次启用需维护者提供连接文件，严格绑定当前 origin、editorAppId、table、读取模式和发布 workflow ID。
只访问同源 /api/passport 与 /api/workflows/run，拒绝重定向。不读取 console 令牌、cookie 或 localStorage。
仅发送 version，不发送 op、table 或 body_json。passport 只存在请求内存，不显示、不持久化、不桥接到 MAIN。
当前业务节点不运行；查询应用会运行并产生记录。界面在启用前说明这一点。
关闭、刷新或切换编辑应用会清除连接。异步请求取消、旧文件读取和节点切换不会恢复旧连接或旧表。
来源、运行 ID、完成时间、保存时间、版本、内容摘要与响应摘要保留在可展开详情。

必须由维护者保证查询图保持只读、调用者无法修改它。**发布 workflow ID 在运行后核对**，可以拒绝显示变化后的结果，不能撤销其执行。这不是抗恶意管理员的只读沙箱；不要连接用途不明或会被重新发布为写操作的应用。
企业 webapp 身份交换失败会清晰报错，不自动读取隐藏凭据或改走 console node/run。
仅 digest 而无 version 时，目前查询 latest 并核对摘要；若历史版本才匹配会拒绝，不实现上游“最近 50 版查找”行为。

## 实测结果

真实 MV3 套件 20/20：

1. 实际 service worker 和扩展版本可核验。
2. 点击工具栏前没有预览注入。
3. 未连接时只显示存储引用，不伪造表体。
4. 真实表版本和摘要匹配。
5. when_any 保持三组 OR-of-AND，一条规则一行。
6. 完整文档、模板与插件保存结果一致。
7. 点击真实内联 JSON 节点后清除存储表。
8. 点击真实内联 definition 节点后正确定位模板。
9. 不存在版本拒绝，无 latest 回退。
10. 错误摘要拒绝并清空旧表。
11. 未固定版本节点读取当前版本。
12. 真实插件推进合成表版本后，刷新读到新版与新摘要。
13. 固定版本 1 的节点仍显示版本 1。
14. 切换节点不恢复迟到响应。
15. 预览不改业务节点配置。
16. 业务节点 last-run ID 保持不变。
17. 浏览器没有发出 console node/run POST。
18. 关闭面板清除查询连接。
19. 刷新要求重新点击工具栏。
20. 无页面 JavaScript 错误。

公开发布源码的原创测试和临时上游契约回归另覆盖旧插件解析、XML、决策集、路由原文、错误输入、版本校验与连接竞态。
旧插件真实运行、XML 插件实际安装、公司页面、企业 SSO 与所有 stored schema 的真实执行不在本次 20 项内；不得用本地测试替代这些验收。

## 发布验证资料

本 Release 附带去敏验证摘要，不公开原始请求、账户、浏览器 profile、私有 Compose 或安装凭据。
公开源码中的 npm test 使用原创合成样例；scripts/check-upstream.py 临时取得公开上游样例运行完整契约检查。上游样例不随源码或运行包分发。

原版路径经过真实 MV3 验收。AgentHub /v2/app/<id>?mode=workflow 路径沿用远端既有修复，并增加连接作用域测试；不把路径单元测试称为定制部署完整验收。

每小时监测模板位于 examples/upstream-monitor.yml，定时上游监测尚未启用，也没有自动发布或安装。正确仓库 dify-workbench-111 的既有 CI 已接入浏览器构建、类型和原创回归；上游契约检查仍单独运行。

## 纳入 Workbench 仓库

浏览器运行代码沿用已完成上述真实验收的构建，仅调整仓库链接、安装说明和许可文本。发布核对 content.js、reader.js、background.js、dock.css 和 manifest.json 与实际验收文件逐字节一致。CLI/MCP 与浏览器独立构建，不共享凭据和远程操作入口。原有 CLI 的真实服务器验收边界保持不变。
