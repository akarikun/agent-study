# 本地 Ollama Agent

基于 Node.js、TypeScript 的 Agent 学习项目，支持 XML 工具调用循环、流式对话、上下文筛选、模型路由和可切换助手。开发与静态构建需要 Node.js 24+。

| 运行方式 | 模型与工具 | 数据存储 |
| --- | --- | --- |
| Node 网页 / CLI | 连接配置的模型，执行本机工具 | SQLite 保存会话和助手，模型配置保存在本机 |
| 静态演示 | 固定模拟回复，天气为虚构样例，文件为虚拟文件 | 浏览器 localStorage，无需后端 |
| 静态浏览器直连 | 直接请求访客的 Ollama 或兼容 API，文件仍为虚拟文件 | 浏览器 localStorage，Key 仅保留在页面内存 |

页面操作见 [管理页面说明](admin/README.md)，静态部署与连接步骤见 [静态版本说明](docs/STATIC_DEMO.md)。

## 运行

```sh
npm install
npm start
```

打开 `http://127.0.0.1:3000`，`PORT` 可修改端口。没有 `.env` 时可直接使用 `.env.example` 的本地配置；需要自定义时再复制并修改，已有 `.env` 不要覆盖。

终端模式使用 `npm run cli`。`npm run dev` 和 `npm run main` 与 `npm start` 一样启动网页服务。

`.env` 使用 `MODELS` JSON 数组配置模型，每项含 `url`（完整 Chat Completions 地址）、`model` 和可选 `key`。网页保存的 `.data/models.json` 优先于环境变量。CLI 的 `MODEL_INDEX` 指定模型序号（默认 0），`CHAT_SESSION_ID` 指定会话（默认 default）。本机 Ollama 的对应模型需提前安装。

以下命令在 CLI 中输入，不是 shell 命令：

- `/models`：列出模型，星号表示当前选择。
- `/prompts`：列出 SQLite 中保存的助手配置和当前选择。
- `/prompt tools` 或 `/prompt library`：切换到工具助手或图书管理助手；也可使用自定义助手的 ID。选择持久化到 SQLite，网页与 CLI 共用，下一轮生效。不同角色建议新建会话，避免旧上下文干扰。
- `/model 1`：切换到数组中序号为 1 的模型，保留当前上下文。
- `/exit`：退出。
- `/clear`：清空当前会话及 SQLite 中对应的历史。

## 静态版本

```sh
npm run build:static
npm run preview:static
```

预览地址为 `http://127.0.0.1:4173`，将 `dist/` 上传到静态托管即可。`npm run publish` 当前也只是生成静态文件，不会上传或发布。首次打开默认为模拟演示；顶部可以切换浏览器直连，显示待请求模型、地址及路由后的实际目标。保存配置不代表连接成功，真实连通性需发送消息验证。

静态构建不包含 `.env`、`.data` 或本机会话；直连需要处理接口 CORS 和浏览器本地网络权限，详见 [部署说明](docs/STATIC_DEMO.md)。

## 文件与流程

```text
src/
  main.ts           统一启动入口，默认后台，--cli 启动终端
  cli.ts            终端交互
  server.ts         HTTP 服务实现
  agent/            Agent 循环、模型响应流、提示词、XML 解析
  config/           模型配置与项目路径
  http/             SSE 聊天、请求响应、静态资源
  storage/          SQLite 持久化
  tools/            本地工具注册与实现
    utils/          工具类型、参数校验、语法检查、天气地区数据
admin/              管理页面及静态资源
scripts/            语法检查、静态构建及预览
tests/              后端与页面测试
docs/               开发记录
```

后续开发安排见 [开发记录](docs/DEVELOPMENT_PLAN.md)。`.env` 和 `.data/` 仍位于项目根目录，启动命令不变。

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 统一启动入口，默认网页服务，--cli 切换终端 |
| `src/cli.ts` | 终端交互、斜杠命令 |
| `src/agent/agent.ts` | 网页和终端共用的工具调用循环 |
| `src/agent/session.ts` | 历史加载、助手选择、整轮保存及日志接入 |
| `src/agent/prompt.ts` | 内置助手模板与公共工具协议 |
| `src/agent/context.ts` | 保留最近 3 轮完整历史及当前轮，不删除数据库历史 |
| `src/agent/router.ts` | 手动选择或按关键词、长度和模型大小进行规则路由 |
| `src/agent/logger.ts` | 按请求 ID、步骤和耗时输出彩色后台日志 |
| `src/agent/model-stream.ts` | 模型 HTTP 请求和 SSE 读取 |
| `src/agent/tool-call.ts` | XML 工具调用解析 |
| `src/server.ts` | 本地 HTTP 服务、流式聊天、模型与会话接口 |
| `src/config/models.ts` | 加载环境变量和本地模型配置 |
| `src/tools/index.ts` | 统一注册 get_weather、read_file、write_file、edit_file |
| `src/tools/*-file.ts` | 各文件工具的独立实现 |
| `src/tools/weather.ts` | 本地名称匹配 ID 后请求天气接口，返回原始数据 |
| `src/tools/utils/` | types.ts、validation.ts、syntax-check.ts、weather.data.ts |
| `src/tools/utils/syntax-check.ts` | JavaScript 语法检查与结果反馈 |
| `src/storage/sqlite.ts` | 会话和助手配置持久化，保存当前助手选择 |
| `admin/browser-runtime.js` | 静态版本的浏览器缓存、模型请求和工具循环 |
| `scripts/build-static.mjs` | 生成公开静态资源，复用上下文、路由、提示词和天气代码 |
| `tests/sqlite.test.ts` | 验证会话持久化、覆盖更新、隔离与清空 |

```text
用户输入 → 模型回答
              ↓ 要求工具
          本地执行 → 结果加入上下文 → 再请求模型
              ↓ 最终回答
          保存到 SQLite
```

新增工具时，在 `src/tools/` 创建独立文件实现 `Tool`（description、readOnly、execute），然后在 `index.ts` 注册，系统提示和页面工具清单会自动更新。模型使用自定义 XML `<tool_call name="工具名称"><params>...</params></tool_call>` 调用，文件正文放在 CDATA 中。

工具辅助代码放在 `src/tools/utils/`。Node 工具注册不会自动移植到浏览器：若静态版本也要使用新增工具，需要在浏览器适配层提供兼容实现或加入静态共享构建。当前没有接入 LangChain、RAG 或 MCP。

会话保存在 `.data/chat.sqlite`，启动时自动恢复，完整回答后保存。系统提示每次请求单独注入，不写入历史。不同 `CHAT_SESSION_ID` 使用不同会话。

## 上下文、工具与执行状态

- 默认保留最近 3 轮完整历史及本轮全部工具消息；当前没有 token 预算、自动摘要或长期记忆。
- 工具失败会立即通知页面并回填给模型，模型可调整操作；工具成功不等于整轮完成。
- 模型给出最终回答且保存成功后发送 `done`；模型请求或解析错误则发送整轮 `error`。
- Node 网页 / CLI 默认进行一次 Reflection：工具循环生成初稿后，`reviewAnswer()` 用同一个模型对照任务与工具结果复查；不展示或保存初稿，只展示并保存复查后的完整答案。复查不允许调用工具，失败或取消不保存本轮。最多 8 次执行循环外另有 1 次复查请求，会增加等待，也不能保证检查正确。直接调用 `runAgent({ ..., reflect: false })` 可恢复原流式路径；静态适配层尚未接入复查。
- Node 模型请求有独立总时限（默认 120 秒）和无数据时限（45 秒）。复查默认总时限 60 秒、无数据时限最多 30 秒，并限制输出为 1024 tokens；`REVIEW_TIMEOUT_MS` 可调整复查总时限。收到 `[DONE]` 或 `finish_reason` 即结束，不等待服务关闭连接；提前断流或达到输出长度上限会报错。页面显示复查等待秒数，后台记录接收字节数与答案字符数。
- 页面支持停止生成。停止、异常或断开时不保存未完成轮次，已执行的工具操作不会回滚。
- 规则路由每轮只选一次模型，工具循环沿用它。模型参数量只是学习用代理，不等于实际能力或上下文容量。
- `get_weather` 从 `src/tools/utils/weather.data.ts` 匹配 ID，只请求一次魅族天气接口，返回原始信息；参数为 `countyname`（兼容 `city`），同名地区可补充 `areaid`。应按返回日期回答，不能把旧数据说成今日天气。

## Plan & Execute（先规划再执行）

本地 Node 网页的“本轮配置”中开启“先规划再执行”，或使用 `npm run cli -- --plan`。默认关闭，原有工具循环保持可用；纯浏览器模式暂不支持。

运行流程：生成计划 → 执行当前步骤中的工具调用 → 提交步骤结果 → 推进下一步 → 汇总 → 单次复查。规划请求最多 60 秒、1～6 步，执行阶段最多 24 次模型请求，支持原有停止按钮。规划格式错误会明确报错。

`src/agent/plan.ts` 负责生成并校验步骤；`src/agent/agent.ts` 保存本轮状态，通过内部控制工具 `complete_plan_step` 接收模型提交的 `done/blocked` 及结果，按顺序推进。该工具不执行业务操作。前端通过 `plan` SSE 事件显示进度，后台使用“任务计划”日志。

完成与阻塞的语义判断仍由模型提出，程序控制状态转换；工具成功不等于整个步骤自动成功，模型直接结束时也不会把剩余步骤标成完成。计划不能替代业务权限、参数校验或用户确认。当前是单轮教学实现，计划状态在内存中；用户补充信息后按新上下文重新规划，暂不支持断点恢复和执行途中重新拆分计划。工具产生的实际副作用不会因取消而回滚。

## 后台日志

日志末尾的 `+Nms` 表示同一请求中当前日志距离上一条日志的间隔，第一条为 `+0ms`。

Node 网页 / CLI 按请求 ID、步骤和耗时记录：青色请求、紫色模型决策、蓝色工具参数、绿色结果、黄色复查、红色错误。长参数和结果显示摘要，不打印完整上下文或模型内部思考；敏感字段和当前模型密钥会隐藏。

终端自动启用颜色，`NO_COLOR=1` 关闭，`FORCE_COLOR=1` 强制启用。日志写入 stderr，CLI 回答写入 stdout。静态版本没有 Node 后台，不使用这套终端日志。

## 检查

```sh
npm run check
npm test
npm run format:check
```

`npm run format` 可统一展开和格式化源码、页面及测试，规则位于 `.prettierrc.json`。语法检查会自动扫描源码和测试目录，新增模块无需再手动添加检查命令。

## 独立管理页面

运行 `npm start`，打开 `http://127.0.0.1:3000`。支持流式聊天、提示词编辑、模型配置和 SQLite 会话管理。`npm run dev` 和 `npm run main` 同样启动后台；终端对话使用 `npm run cli`。所有启动命令统一经过 `src/main.ts`，也可直接运行 `node src/main.ts` 或 `node src/main.ts --cli`。

没有 `.env` 时自动使用 `.env.example` 中的本地 Ollama 配置。网页保存模型配置后，网页与终端优先使用 `.data/models.json`，不修改 `.env`。删除该配置文件后可重新使用环境变量配置。API Key 保存在该本机文件中，不会返回浏览器，请勿分享 `.data` 目录。

服务只监听本机。聊天请求最多执行 8 次模型循环（`src/agent/agent.ts`），15 分钟超时（`src/http/chat.ts`）。同一会话生成期间拒绝重复请求和删除。中间工具记录保留在模型上下文但不作为聊天气泡；工具错误以可展开卡片即时展示。`readOnly` 是能力标记，不是权限隔离；Node 文件工具仍具有进程的文件访问权限。图书助手目前只是提示词配置，图书 CRUD、业务工具、身份与权限尚未实现。
