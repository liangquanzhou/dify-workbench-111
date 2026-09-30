# 首次接公司前的验证清单

当前阶段：未连接公司服务、未读取企业凭据、未上传任何公司源码/业务规则/case。

## A. 独立1.11.1环境（先做）

- [ ] 自建隔离官方Dify 1.11.1，确认实际版本和原生导出DSL0.5.0
- [ ] 人工建立测试workspace、专用最小权限账号、已有workflow/advanced-chat app
- [ ] 公司批准的session注入机制；不给agent聊天发送cookie/密码，不把秘密写进配置
- [ ] 仅remote读取：workspace/app/mode核验、HTML200、401/403、反代路径、__Host cookie/CSRF
- [ ] 人工配置现有secret并记录验证方式；空串导出重同步后secret仍可用，工具日志不包含secret
- [ ] 两版合成DSL同步固定app_id，没有新app，已发布版本没有变化
- [ ] 本地与UI并发编辑触发hash冲突，不自动取最新hash覆盖
- [ ] env/conv变化、secret遮罩不可见变更、单写者窗口验证
- [ ] Code失败 → 准确node_id/error → 改正 → 复跑成功；验证run graph与测试草稿一致
- [ ] advanced-chat、iteration/loop单节点、HTTP/Tool/LLM分别实测；确认外部调用无真实数据风险
- [ ] SSE断流/超时/失败/停止不误报成功；task_id和workflow_run_id分离
- [ ] run历史多页last_id读取；node_last_run 404正确失败
- [ ] Tool credential_id、已映射dataset保留，未知加密dataset阻止
- [ ] 最后单独批准publish：发布资格、内容绑定、写后读回；超时不重复副作用

## B. 公司专用测试workspace（后做，需批准）

- [ ] 明确批准访问的部署地址/workspace/app、账号权限、允许的合成测试与数据传输
- [ ] 确认企业fork是否改Console端点、secret脱敏、DSL资源ID和SSO会话要求
- [ ] 保持生产应用不变；只批准remote读取，再逐步开启sync/test
- [ ] 只在被授权的受控电脑执行本地生成器；不复制源码/规则/case到本包或云端
- [ ] 核验“本地生成器回归”和“实际落盘DSL→线上草稿测试”是两个不同证据
- [ ] 确认测试可能消耗模型token、调用HTTP或Tool；合成输入也必须批准目标外部调用
- [ ] 先使用已人工绑定的Tool和dataset，不自动创建密钥/绑定凭据/安装插件
- [ ] 约定单写者和维护窗口；承认旧服务器不能提供变量与发布的原子条件锁
- [ ] 确认MCP返回内容会进入哪个agent/模型；默认不开include-data
- [ ] 明确失败/未决恢复流程和负责人；不通过重复点击重试发布

只有这些检查实际通过后，才能把对应条目标为“公司环境已验证”；本包自动测试不能代替本清单。
