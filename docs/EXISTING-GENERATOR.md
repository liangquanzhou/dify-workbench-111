# 对接已有本地 DSL 生成器

本工具不替代业务编译器。只需要把已有、已审查的生成命令和它写出的原生 Dify DSL 0.5.0 文件接进来。以下路径全部为通用合成示例，不对应任何用户仓库。

假设你的本地生成器这样执行：

```sh
node scripts/generate-workflow.js
```

并固定写出：

```text
generated/workflow.yml
```

生成器可以输出 YAML，也可以输出 JSON 格式的合法 YAML。不要擅自添加生成器不支持的 `--out` 或场景参数；若它要求输出父目录预先存在，先按其说明准备目录。

把下列配置放在你的本地仓库根目录。target 替换为已授权的专用测试目标，所有权限先保持 false：

```json
{
  "profile": "dify-1.11.1",
  "target": {
    "base_url": "https://dify.example.invalid",
    "workspace_id": "REPLACE_WITH_TEST_WORKSPACE",
    "app_id": "REPLACE_WITH_EXISTING_TEST_APP",
    "mode": "workflow"
  },
  "dsl": "generated/workflow.yml",
  "build": {
    "command": "node",
    "args": ["scripts/generate-workflow.js"],
    "cwd": "."
  },
  "permissions": {
    "build_command": false,
    "remote": false,
    "sync": false,
    "test": false,
    "publish": false
  }
}
```

审查生成命令，并明确允许它写出或覆盖指定产物后，才将 build_command 改为 true：

```sh
node /path/to/dify-workbench-111/bin/difywf.js build --config ./dify-workbench.json
```

如果你已独立运行生成器，可以删掉 build 段，工具只验证现成 DSL。确认测试环境访问与数据传输均获批准后，再按 README 开启 remote/sync/test，执行 snapshot → diff → sync → test。

## 边界

- build.command 是可执行文件，build.args 是 argv 数组，不经过 shell
- 生成器的工作目录、固定产物和额外运行时依赖由你自己的项目定义，本工具不推断
- 不要用 require/import 任意脚本来探测接口；脚本加载时可能执行任务或写文件
- 生成器自己的离线回归，可能验证的是内存里的另一份图。它不能代替对实际落盘 DSL、指定远端草稿和具体 run 的核验
- 业务源码、规则、真实 case 和敏感测试报告应留在受控环境；公开 issue 或 PR 只提供脱敏合成最小复现
- 所有远端同步/测试/发布仍受独立目标绑定和权限配置限制
