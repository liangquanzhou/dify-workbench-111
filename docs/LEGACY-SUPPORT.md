# 1.11.1 支持矩阵

“已实现/已mock验证”不等于部署实测。所有真实 Dify / 企业 SSO / 插件模型执行均待验证。

|入口|首版状态|重要条件|
|---|---|---|
|build|本地可运行|现成原生0.5.0 DSL或明确配置的生成命令；不是通用编译器|
|snapshot/diff|已实现、mock验证|固定server/workspace/app/mode；diff默认只给变化路径和摘要，不泄露原始值|
|sync|已实现、连续两次同app验证|原始baseline hash、内容摘要、写后读回；无创建/导入fallback|
|workflow test|已实现、SSE mock验证|单独test权限，完整inputs/files，持久run graph/status核验|
|advanced-chat test|路由/请求mock验证|独立advanced-chat路由；query/conversation/files；真实执行待验证|
|runs/logs|已实现、mock验证|last_id分页；workflow_run_id查详情/节点；默认省略输入输出|
|node-defaults/node-last-run|端点已实现|不保证所有节点/插件具备同样执行权限|
|node-run|JSON/SSE路由实现|普通节点JSON；iteration/loop SSE；不产生发布资格|
|stop|已实现、归属约束测试|只允许本地记录的同target task_id；不直接相信服务端app路径|
|publish|已实现、安全门与readback mock验证|默认关闭、独立确认、绑定成功完整测试摘要、一次性资格、不重试|
|__Host cookie/CSRF|header与脱敏mock验证|既有会话环境变量；无登录、刷新、保存功能|
|SSO/反代/RBAC|尚未验证|不能承诺接公司即可工作|
|native import(app_id)|未暴露|不能伪装原子hash保护；避免覆盖导入竞态/依赖/秘密重置|
|创建app、删除、API key、插件安装|不提供|用户先在专用环境准备目标|
|旧上游174工具|另保留upstream profile|未宣称兼容1.11.1，不在默认MCP列表，不享有本profile门控|
|RAG、触发器、agent、human-input、snippet、agent-v2|本profile阻止|需要各自完整契约/资源/凭据/生命周期适配|

## Graph 保留范围

已按 1.11.1 枚举允许并保留原始节点字段：start/end/answer、code、llm、http-request、if-else、template-transform、knowledge-retrieval、tool、variable-aggregator/variable-assigner、assigner、question-classifier、parameter-extractor、document-extractor、list-operator、iteration/iteration-start、loop/loop-start/loop-end。

这意味着结构与语义字段不被客户端擅自重写，**不意味着每个节点已实际执行成功**。已做唯一节点/边、端点存在、一个start、容器start/parent及非容器边环检查；参数选择器、输出类型、插件/模型和引擎的完整校验由真实Dify继续完成。

Tool 只更新既有相同身份节点，credential_id会保留；新Tool绑定需人工建立。HTTP既有authorization有变化会阻止；首次配置秘密应通过公司认可方法完成。知识库映射需要目标workspace可见dataset UUID。触发器/agent当前主动拒绝，避免DSL导出重置或脱落的配置被当作真实删除。

## 明确未解决的服务端限制

1. 1.11.1草稿hash只涵盖graph/features；变量摘要+updated_at检查仍有请求间竞态
2. secret遮罩值不能提供真实secret内容的变化检测
3. publish没有服务端内容CAS；单写者约定是必要条件
4. Console API不是稳定公开服务API；企业fork/SSO可改变契约
5. SSE/日志只能证明被返回的run；HTTP未决不能被客户端假定成功或失败
6. 本地JSON状态/permissions/confirm字段不能抵抗控制本机或能改配置的恶意agent；需宿主授权及文件权限
