<!-- Modified for Dify Workbench 1.11.1 on 2026-09-30; see NOTICE and MODIFICATIONS.md. -->
# Dify Workbench 1.11.1 · v0.1.0

一个入口接起“本地生成 DSL → 比较 → 更新同一个应用草稿 → 测试 → 查看节点错误 → 修改复跑”。CLI 和 MCP 调用同一套安全状态机。

拟发布仓库：[liangquanzhou/dify-workbench-111](https://github.com/liangquanzhou/dify-workbench-111)。发布状态以 GitHub 实际页面为准。

**这是已通过合成/HTTP mock 测试的开发首版。尚未连接公司 Dify，尚未在真实 Dify 1.11.1、公司 SSO/反向代理/RBAC 下端到端验证。不要把生产 app 作为首次试验对象。**

- 上游：alexjiaguo/dify-mcp，固定提交 `cfaa2abafaf8807c0914eff1bb7b9909e6599293`，原版本 0.3.0，Apache-2.0
- 官方契约对照：langgenius/dify 1.11.1，提交 `2058186f22b4e4d4e155f380c130f4e8f21622fa`
- 默认 profile：`dify-1.11.1`，原生 DSL `0.5.0`。不把 0.7 文件改个版本号假装兼容
- 本适配器版本：0.1.0，本包不发布 npm 包，不包含任何远程 Dify 服务；GitHub 源码发布由仓库维护者单独执行
- 原上游工具保留在显式 `--profile upstream`，**它们不受本旧版安全门控制，也不宣称兼容 1.11.1**。旧版 MCP 请始终运行 `bin/difywf.js mcp`

## 1. 安装与离线验证

需要 Node.js 23.6+（本次 Node 24.19.0）；建议使用现有受支持 Node 版本。解压后在项目目录运行：

```sh
npm ci --ignore-scripts
npm run check
node bin/difywf.js capabilities
node bin/difywf.js build --config examples/legacy/workbench.example.json
```

依赖版本及 integrity 已锁在 package-lock.json。无需全局安装，所有命令可用 `node bin/difywf.js`。

```sh
npm run demo:legacy
```

演示仅启动本机 loopback 上的合成 HTTP 服务，完成“失败节点 → 修改 DSL → 同 app 同步 → 测试成功”，不启动真实 Dify，也不执行示例 Python。报告明确 `simulation: true`、`real_dify_verified: false`、零创建 app、零发布请求。示例全为合成数据。

## 2. 接现有生成器，不重写业务内核

build 有两种方式：

1. config 仅设 `dsl`：检查已经生成的 `.yml/.yaml`，JSON 格式的合法 YAML 也支持
2. config 增加 `build.command` / `build.args` / `build.cwd`，并明确启用 `permissions.build_command`：执行已审查的本地命令，再验证它写出的 DSL

参见 `examples/legacy/generator.example.json`。使用可执行文件加 argv 数组，**不经过 shell**，不接受 MCP 参数传入任意生成命令。生成器的 stdout/stderr 不回传，以免日志夹带秘密；失败返回 BUILD_FAILED。生成进程不会继承名称包含 TOKEN/SECRET/PASSWORD/COOKIE/CREDENTIAL/API_KEY 的环境变量。它仍以启动用户的普通权限运行，请只配置已审查的脚本。

对于现有“无参数、写固定文件”的 Node 生成器，填写实际脚本路径和其**固定产物**路径即可；不要添加脚本不支持的 `--out`、场景参数。输出父目录须提前存在。工具会拒绝本轮没有刷新输出的 stale artifact。

这是 DSL 接口适配器，不是“任意 JSON → Dify”的通用编译器。业务生成内核、提示词、规则和 case 保持在原本受控仓库；本包不包含这些内容。生成器自带的本地回归若在内存重生成图，只能证明本地生成逻辑，不能冒充已验证落盘 DSL 或线上草稿。

## 3. 绑定专用测试 app

复制 `examples/legacy/workbench.example.json` 到自己的私有配置路径。填写：

- base_url：Dify 部署根地址（不要加 `/console/api`），仅 HTTPS；loopback HTTP 仅用于隔离测试
- workspace_id、app_id：明确指定已存在的专用测试空间和应用，绝不按名称猜或自动创建
- mode：`workflow` 或 `advanced-chat`
- dsl：相对于配置文件所在目录的产物路径
- permissions：默认全部 false；经批准后按阶段开启 remote，再 sync/test，publish 最后独立开启

本版不登录、不存凭据、不切 workspace、不生成 key、不安装插件、不删除 app、不原生导入。已有 Console 会话通过 **DIFY_CONSOLE_COOKIE 环境变量**在受控机器的已批准秘密机制中提供；支持 access_token/csrf_token 和 `__Host-` 前缀。不要把 Cookie/密码/账号发给云端聊天或提交到仓库。仅已有会话被使用；401 时人工按公司批准流程续期，任何写操作都不会自动刷新重试。

SSO 是否允许此方式、是否还需要网关 header、Cookie 域/路径、企业代理和权限，必须实机验证。HTML 200、意外重定向、非 JSON/SSE 都会失败，不会假成功。

## 4. 日常闭环（均返回 JSON）

以下操作只有在目标和数据传输已经获批、对应 permissions 开启后才可执行：

```sh
node bin/difywf.js build --config /private/workbench.json
node bin/difywf.js snapshot --config /private/workbench.json
node bin/difywf.js diff --config /private/workbench.json
node bin/difywf.js sync --config /private/workbench.json --expected-digest <diff.desired_digest>
node bin/difywf.js test --config /private/workbench.json --expected-digest <sync.draft_digest> --inputs @/private/synthetic-inputs.json
node bin/difywf.js logs --config /private/workbench.json --run-id <workflow_run_id>
```

修改后重复 build → diff → sync → test，不要每轮用 snapshot 静默接受别人的修改。草稿冲突时先人工合并，明确接受当前状态后才 `snapshot --accept-current`。该操作会清掉旧测试资格；不能代替合并。

advanced-chat 的 test 额外传 `--query "合成测试问题"`，可选 `--conversation-id UUID` 和 `--files @files.json`；路由独立。输入格式必须符合该 app。

```sh
node bin/difywf.js runs --config /private/workbench.json --last-id <cursor>
node bin/difywf.js node-defaults --config /private/workbench.json --node-type code
node bin/difywf.js node-run --config /private/workbench.json --expected-digest <current_digest> --node-id echo --inputs @inputs.json
node bin/difywf.js node-last-run --config /private/workbench.json --node-id echo
node bin/difywf.js stop --config /private/workbench.json --task-id <task_id>
```

runs 使用 `last_id`，不使用 page。workflow_run_id 读日志，task_id 停任务，二者不能混用。stop 只允许本工具为同一 target 记录的最近 100 个 task；旧服务端 stop 路由本身不保证 task 归属，因此不能接受任意 task ID。

默认日志只输出状态、node_id、错误和耗时，不输出全部输入/输出。确实获准把业务数据返回给调用者/模型时才加 `--include-data`；即使脱敏了凭据，业务内容仍可能敏感。

SSE 断流、超时、没有终态、冲突终态都返回 unknown，并留下未决标记，不允许盲目复跑。可先 logs / stop，确认服务端状态后再显式接纳新 baseline。锁文件只锁本机 workbench，不锁 Dify UI；崩溃留下 `.lock` 时先确认没有活动进程，再手工处理。

## 5. 发布是独立操作

默认 `permissions.publish=false`。需要明确授权启用，并且完整 test 成功、持久 run 日志成功、run graph 与测试草稿一致、测试前后草稿未变，才产生发布资格。单节点测试不产生资格。

```sh
node bin/difywf.js publish --config /private/workbench.json --expected-digest <tested_digest> --confirm-publish <tested_digest>
```

发布前再次核对草稿，发布后读取已发布版本比对；资格用一次即消耗。异常/超时保持未决，绝不自动重试。`confirm-publish` 是可审计的工具门槛，**不是独立人类审批系统**；能修改配置或调用工具的 agent 仍需受宿主授权策略约束。

Dify 1.11.1 发布没有“按内容条件发布”的原子 API。读前/读后核验只能发现部分竞态，无法阻止夹在请求之间的修改；必须使用单写者专用 app。绝不把原生 import 的最新 hash 伪称为 CAS 锁；本首版没有 import fallback。

## 6. MCP：一个工具

启动命令：

```sh
node /absolute/path/dify-workbench-111/bin/difywf.js mcp --config /private/workbench.json
```

仅 stdio，tools/list 只有 `dify_workbench`。工具参数为 action、expected_digest、inputs、query、run_id 等；动作包含 build/diff/sync/test/publish 以及只读/调试辅助动作。服务启动时固定配置文件，调用参数不能选择别的 app、base URL 或生成命令。tools/call 再次校验动作，未知动作不会落入上游注册表。

不要把 session cookie 明文写入可分享的 MCP JSON 示例。用宿主现有的秘密注入方式启动。普通 `build` 可完全离线；remote permissions 未启用时所有网络动作被拒绝。

## 7. 安全语义与兼容边界

- 编辑起点 hash + 全 payload 摘要 + updated_at；sync 提交最初 baseline hash，而不是临时取最新 hash 包装旧图
- 旧 hash 仅覆盖 graph/features，变量竞态不原子；secret 值被服务器遮罩后变化不可见。明确依赖单写者
- env/conv 全字段保存；变量省略保留已有列表。secret 按原 ID 用 `[__HIDDEN__]` 保留，空串不回写；新建/替换 secret、改 secret 类型/描述都阻止。显式省略已有 secret 也保留
- 变量 selector 只接受空或规范 `[env,name]` / `[conversation,name]`；Console 五字段与 number 暴露类型规范化后核验
- dataset 加密引用必须显式映射到目标空间 UUID，且实时 GET 确认该 dataset 可访问，不能直接粘贴
- Tool 只允许已有同 node ID/同 provider/tool identity；保留原 credential_id。新凭据绑定需手工配置
- 触发器导出会重置配置，agent 节点嵌套凭据处理更复杂，当前明确拒绝；不悄悄删字段
- 节点枚举和结构验证不等于完整服务端语义证明。Code/HTTP/LLM 等真实执行、外部插件/模型版本、网络可达性须专用环境验证
- 不保存 Cookie/secret；state 仅本机 0600 保存 target、摘要、hash、运行 ID、未决状态，目录 0700。它不是防恶意本地管理员的安全边界
- 错误/日志移除已知 session token 和敏感键，但任意业务字符串无法保证自动识别全部秘密。默认不要给工具生产数据

详见 [已有生成器接入](docs/EXISTING-GENERATOR.md)、[发布说明](docs/RELEASE-NOTES.md)、[公开前扫描范围](docs/PUBLICATION-SCAN.md)、[支持矩阵](docs/LEGACY-SUPPORT.md)、[部署验证清单](docs/COMPANY-VALIDATION.md)、[验证记录](docs/VALIDATION.md)、[原上游文档](docs/UPSTREAM-README.md)。
