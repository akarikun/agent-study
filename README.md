# 这是个人学习agent项目,代码有使用Codex润色

# 本地 Ollama Agent

学习笔记：[当前 Agent 的运行图与状态数据](docs/AGENT_RUNTIME_GUIDE.md)，包含工具循环、上下文、Reflection、Plan & Execute、多助手协作，以及一轮请求中消息和事件的变化。

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

### Agent 实例与角色

Node 网页 / CLI 使用 `src/agent/instance.ts` 的 `Agent` 类封装通用循环，`src/agent/registry.ts` 在应用外层统一创建实例：

```ts
const libraryAgent = new Agent({
    name: '图书管理助手',
    prompt: libraryPrompt,
    tools: librarylocalTools,
});

for await (const event of libraryAgent.run({ model, messages, signal })) {
    // 网页转成 SSE，终端打印事件。
}
```

构造时不请求模型，也不打开图书数据库；模型可以构造时绑定，也可以在每轮 `run` 传入以支持模型切换。实例只保存角色配置，消息、取消信号、计划和运行日志按次独立。

内置角色 `tools` 使用总工具表，`library` 只有图书工具，`file` 只有文件工具，`weather` 只有天气工具；页面选择助手或 CLI `/prompt library`、`/prompt file`、`/prompt weather` 切换。修改角色提示词不改变它的工具集合，自定义助手目前使用通用工具。新增角色时在 `registry.ts` 创建实例，在 `prompt.ts` 的 `builtinPrompts` 注册可选项；新增业务工具仍在对应工具目录维护。

多助手模式只把该角色已有的天气或文件读取能力转换为子助手工具，不为图书角色添加文件或天气能力。子助手同样通过 `new Agent` 创建，每次委派单独传入消息。静态浏览器版本继续使用原浏览器运行器，尚未接入此角色工具隔离；其助手选择仍只是提示词切换。角色工具集合不是操作系统沙箱。

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
docs/               开发记录
```

后续开发安排见 [开发记录](docs/DEVELOPMENT_PLAN.md)。`.env` 和 `.data/` 仍位于项目根目录，启动命令不变。

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 统一启动入口，默认网页服务，--cli 切换终端 |
| `src/cli.ts` | 终端交互、斜杠命令 |
| `src/agent/agent.ts` | 网页和终端共用的工具调用循环 |
| `src/agent/instance.ts` | Agent 类，绑定角色配置，提供 run 入口 |
| `src/agent/registry.ts` | 外层创建角色实例，按助手 ID 选择 |
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

```text
用户输入 → 模型回答
              ↓ 要求工具
          本地执行 → 结果加入上下文 → 再请求模型
              ↓ 最终回答
          保存到 SQLite
```

新增工具时，在 `src/tools/` 创建独立文件实现 `Tool`（description、readOnly、execute），然后在 `index.ts` 注册，系统提示和页面工具清单会自动更新。模型使用自定义 XML `<tool_call name="工具名称"><params>...</params></tool_call>` 调用，文件正文放在 CDATA 中。

工具辅助代码放在 `src/tools/utils/`。Node 工具注册不会自动移植到浏览器：若静态版本也要使用新增工具，需要在浏览器适配层提供兼容实现或加入静态共享构建。当前没有接入 LangChain、RAG 或 MCP。

### 本地图书登记工具

Node 网页 / CLI 已注册 `search_books`、`storeSave`（入库）、`borrow_book`、`search_loans`、`return_book`。定义见 `src/tools/library/index.ts`，数据库实现见 `src/tools/library/store.ts`。首次调用自动创建 `.data/library.sqlite`，不需要模型执行初始化或生成 SQL；独立连接之间保留数据，SQLite `user_version` 记录结构版本。静态浏览器模式暂不支持。

示例：先发送“入库《活着》，作者余华，书号 B001，数量 2”，再发送“查询书号 B001”，然后“为读者001借一本 B001”；归还前查询该读者未归还的记录，以唯一借阅记录 id 办理归还。查询结果最多20条，存在歧义时需补充条件。返回字段使用数据库命名，如 `available_quantity` 为可借数量。

书号唯一，同号但书名或作者不同会拒绝入库。每条借阅记录借一本；借出扣可借库存，归还恢复库存，两步数据库更新通过事务保证一致。借阅要求 `requestId`，同一次操作重试沿用该值，新的借阅使用新值；重复归还不会再次增加库存。入库暂未实现请求去重，重复执行会再次增加库存，不应盲目重试。当前为本地登记簿，借阅人由用户明确提供，尚无登录、角色权限或借阅人身份核验，不能作为多用户授权系统。模型超时或会话未保存不会撤销已完成的图书操作。

会话保存在 `.data/chat.sqlite`，启动时自动恢复，完整回答后保存。系统提示每次请求单独注入，不写入历史。不同 `CHAT_SESSION_ID` 使用不同会话。

## 上下文、工具与执行状态

- 默认保留最近 3 轮完整历史及本轮全部工具消息；当前没有 token 预算、自动摘要或长期记忆。
- 工具失败会立即通知页面并回填给模型，模型可调整操作；工具成功不等于整轮完成。
- 模型给出最终回答且保存成功后发送 `done`；模型请求或解析错误则发送整轮 `error`。
- Node 网页 / CLI 默认进行一次 Reflection：工具循环生成初稿后，`reviewAnswer()` 用同一个模型对照任务与工具结果复查；成功时展示并保存复查后的完整答案，超时或失败时返回并保存带有“未经复查”提示的完整初稿，不使用不完整的复查输出。复查不允许调用工具，用户取消仍不保存本轮。最多 8 次执行循环外另有 1 次复查请求，会增加等待，也不能保证检查正确。直接调用 `runAgent({ ..., reflect: false })` 可恢复原流式路径；静态适配层尚未接入复查。
- Node 模型请求有独立总时限（默认 120 秒）和无数据时限（45 秒）。复查默认总时限 20 秒、无数据时限最多 30 秒，并限制输出为 1024 tokens；`REVIEW_TIMEOUT_MS` 可调整复查总时限。收到 `[DONE]` 或 `finish_reason` 即结束，不等待服务关闭连接；提前断流或达到输出长度上限会报错。页面显示复查等待秒数，后台记录接收字节数与答案字符数。
- 页面支持停止生成。停止、异常或断开时不保存未完成轮次，已执行的工具操作不会回滚。
- 规则路由每轮只选一次模型，工具循环沿用它。模型参数量只是学习用代理，不等于实际能力或上下文容量。
- `get_weather` 从 `src/tools/utils/weather.data.ts` 匹配 ID，只请求一次魅族天气接口，返回原始信息；参数为 `countyname`（兼容 `city`），同名地区可补充 `areaid`。应按返回日期回答，不能把旧数据说成今日天气。

## 多助手协作（学习版）

本地 Node 网页开启“多助手协作”，或运行 `npm run cli -- --multi-agent`。默认关闭，可与“先规划再执行”一起启用。主助手通过 `ask_weather_agent`、`ask_file_agent` 委派任务，子助手分别只有 `get_weather`、`read_file` 工具；主助手保留写入和编辑工具。

核心在 `src/agent/sub-agents.ts`：子助手复用 `runAgent()`，每次创建独立消息列表，共用本轮模型、取消信号与日志。子助手不规划、不复查、不继续委派；返回的回答作为主助手的工具结果，主助手负责汇总与最终复查。前端显示委派工具状态，后台以 `[天气助手]` / `[文件助手]` 标识子步骤；子助手内部事件不逐条转发前端，也不单独保存会话。当前按需串行执行，没有并行调度或自动重规划。纯浏览器模式暂不支持。

复查逻辑已移到 `src/agent/reflection.ts`，`agent.ts` 继续导出 `reviewAnswer` 兼容原调用；上下文构建复用同一函数。

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
npm run format:check
```

`npm run format` 可统一格式化源码、页面和脚本，规则位于 `.prettierrc.json`。语法检查会自动扫描源码目录，新增模块无需再手动添加检查命令。项目已按学习需要移除自动化测试文件及命令。

## 独立管理页面

运行 `npm start`，打开 `http://127.0.0.1:3000`。支持流式聊天、提示词编辑、模型配置和 SQLite 会话管理。`npm run dev` 和 `npm run main` 同样启动后台；终端对话使用 `npm run cli`。所有启动命令统一经过 `src/main.ts`，也可直接运行 `node src/main.ts` 或 `node src/main.ts --cli`。

没有 `.env` 时自动使用 `.env.example` 中的本地 Ollama 配置。网页保存模型配置后，网页与终端优先使用 `.data/models.json`，不修改 `.env`。删除该配置文件后可重新使用环境变量配置。API Key 保存在该本机文件中，不会返回浏览器，请勿分享 `.data` 目录。

服务只监听本机。聊天请求最多执行 8 次模型循环（`src/agent/agent.ts`），15 分钟超时（`src/http/chat.ts`）。同一会话生成期间拒绝重复请求和删除。中间工具记录保留在模型上下文但不作为聊天气泡；工具错误以可展开卡片即时展示。`readOnly` 是能力标记，不是权限隔离；Node 文件工具仍具有进程的文件访问权限。图书助手已接入本地入库、查询、借阅和归还工具；身份与权限尚未实现。
