# Dify Workbench 配套 DMN 浏览器预览 0.4.4

适配 binhuhu 仓库发布的 hu8627 插件，同时保留旧浏览器解析兼容。无需安装原自制 Dify DMN 插件。浏览器结构预览扩展；不改公司 Dify 服务端。内联预览和本地导入不运行工作流；可选查询连接会运行维护者审核的只读查询应用并留下运行记录，不执行当前业务节点。

## 已支持的节点

| provider_id / tool_name | 读取位置 | 行为 |
|---|---|---|
| liangquanzhou/dmn_decision/dmn / evaluate | tool_configurations.table_json | 保留 0.1.0 矩阵 |
| hu8627/dmn_json/dmn_json / evaluate_json_table | tool_configurations.table_json | json-table-v1，按路径数组展示 AND 条件 |
| hu8627/dmn_json/dmn_json / evaluate_decision | tool_configurations.definition_bundle_json + node_ref | 精确定位内联 DECISION 模型，展开输出模板 |
| hu8627/dmn/dmn / evaluate_dmn | tool_parameters.dmn_xml + decision_id | 指定决策表的 FEEL 原文、默认输出与输出顺序 |
| hu8627/dmn_json/dmn_json / route_table_store | 已有 last-run 的原始 result_json，或本地已保存 JSON | 显式读取历史快照，核对表名/版本/摘要；不执行维护节点 |
| hu8627/dmn_json/dmn_json / evaluate_stored_table | table 参数 + format/version/content_sha256 配置 | 连接只读查询应用自动读取，或导入已保存文档；无来源时明确未读取表体 |

`evaluate_decision` 模型的 `source: PLUGIN_STORAGE` 可导入匹配的已保存路由表，展示路由配置原文及完整字典；不编译或模拟执行。浏览器节点内没有这些规则，无查询连接或文件时只显示引用。表文件必须包含已保存 version 和 content_sha256；版本或摘要不符会拒绝展示。

静态对象和 JSON 字符串均支持；变量绑定或插值不会被推测展开。路径保留数组层级。内联 evaluate_decision 与存储服务模型支持 when 和 when_any（互斥），每条规则最多 128 组，每组最多 32 个条件。when_any：一行保留一个结论，组内“且”、组间“或”，保留模板引用。决策集可选择模型。

## 阅读视图与窗口

默认三列展示规则、条件要求和输出声明。条件按原始顺序与嵌套 AND/OR 分组呈现，路径保留各段，值明确区分字符串、数字、布尔值和 null。模板固定值与尚未解析的运行时引用分别展示；预览不求值或执行动作。路由等配置记录不冒充执行规则。保留矩阵切换、源规则和完整定义入口，大组可展开查看全部。

拖动窗口边缘或四角可调整宽高；展开后还原至自定义尺寸。最小尺寸适应视口，窗口不会越界。列宽调整不受影响。窗口尺寸仅在当前面板会话保留。

## 调整预览列宽

拖动表头右边界可调整该列，表头和正文同步；双击边界恢复默认宽度。边界可用 Tab 聚焦，左右方向键每次调整 10px，Shift 加方向键调整 50px；Escape 取消当前拖拽。列宽范围为 100–1600px，超出面板宽度可横向滚动。

同一张表翻页保留列宽，切换节点、模型或重新读取表时重置，不写入 Dify 配置或浏览器存储。列宽只在当前表的预览会话内保留。

## 使用与验收边界

在 Chrome 扩展管理页用批准的方式加载 dist/extension，打开 Workflow 后点击扩展图标或快捷键，再选择节点。刷新或切换应用后需重新启用。已在一次性隔离 Chrome profile 实际加载 MV3 扩展，点击真实 Dify 节点并验证表格；未安装到日常浏览器。

当前页面读取层支持原版 /app/<id>/workflow 和已有 AgentHub /v2/app/<id>?mode=workflow 地址格式，读取 1.11.1 ReactFlow DOM props。公司 Dify 版本和真实节点尚未验收；更高版本不作保证。activeTab + scripting 权限保持不变；不读取 cookie、localStorage、控制台令牌或 Fiber/store。路由表存取节点可显式 GET 读取已有 last-run；定制页面只使用页面已请求的精确同源接口。可选查询连接仅访问同源 Dify /api/passport 与 /api/workflows/run；应用级 passport 仅在当前请求内存使用。

上游验收固定为 v0.5.19 / 3364027130f2df77c69d44685788d783ab322e5e（预发布），保留 v0.5.18 回归。具体部署应核对实际安装版本。内联定义包支持 1 MiB；其他资源边界见验收文档。

本次验证见 [0.4.4 真实验收](docs/REAL-E2E-0.4.4.md)。公开源码提供原创合成测试；本地测试和上游契约回归分别运行。此前 0.4.2 的真实 MV3 + 原版 Dify 1.11.1 + Brian 0.5.19 有 53 项检查通过；本轮是实际 Chrome 合成页面的显示与交互验证。AgentHub 地址格式有回归测试，但不代表任何定制部署已验收。

## 存储表自动读取

维护者在同租户、同插件下导入 examples/reader-latest.yml 和 reader-version.yml，将 REPLACE_TABLE_NAME 换成固定表名并审核发布。不要开放 op、table、body_json 为用户输入。必须使用公司允许的应用访问控制；本地验收的匿名访问只用于回环合成数据，不是公司部署建议。

按 examples/reader-connections.example.json 填好当前编辑应用和查询应用信息。在预览面板选择此文件，点击“启用查询与自动读取”。随后同一编辑应用内点击匹配节点会自动查询；关闭面板、刷新或切换应用后连接清除。

查询应用配置由维护者负责锁定。发布版本在运行后核对，扩展可拒绝显示变更后的结果，但不能撤销已经发生的执行。不要连接可由浏览者改图或用途不明的应用；不得嵌入管理员/Service API key。详见真实验收文档的边界。

## 构建与测试

```sh
cd browser-extension
npm ci --ignore-scripts
npm run build
npm run typecheck
npm test
```

npm test 运行本仓库原创数据与既有 MIT 代码的回归。上游仓库未提供明确许可证，因此不重新分发其样例；完整兼容检查用下方脚本临时读取固定上游样例，并执行 npm run test:all。上游样例不进入候选包。脚本不会执行上游代码。

## 跟随上游更新

```sh
python3 scripts/check-upstream.py --channel all --out ./compatibility-artifacts
# 离线固定源码模式：
python3 scripts/check-upstream.py --source ../upstream-checkout --ref COMMIT --out ./compatibility-artifacts
```

- all 通道包含预发布；stable 仅选正式发布。按 published_at 选最新，不把 main 当发布版。
- 从选定 tag 解析不可变提交；只读取契约和样例。只运行本仓库的构建、类型检查和测试。
- 契约未变且新版本样例通过：生成候选 ZIP 和报告，退出 0。
- 契约变化：退出 2，输出差异和待审查 baseline。即便旧样例通过，也不会冒充兼容或替换 baseline。
- 下载、构建或测试失败：退出 1。没有推送、发布、安装步骤。

examples/upstream-monitor.yml 提供每小时检测模板。仓库现有 CI 已纳入浏览器构建和原创回归；本次不新增定时 GitHub Actions workflow；维护者可在审查工作流权限后将其移入 .github/workflows/。自动检测和候选构建不等于自动发布或浏览器热更新；未知破坏性变化仍需修改适配器。真实查询通道和公司页面验收也不会被这个离线检查覆盖。

导入仅在当前预览内存有效，切换节点后清除；可选查询连接另行处理。文件须来自已授权的导出或只读查询，包含已保存 version 和 content_sha256。表名、格式、钉住版本、摘要任何一项不符均拒绝；未钉版本则明确提示无法确认线上最新版。摘要一致不代表来源身份已认证。

0.4.1 修复与验收见 [路由表存取修复](docs/REAL-E2E-0.4.1.md)。历史快照不能证明当前存储状态。
