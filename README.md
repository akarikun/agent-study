# 本地 Ollama Agent

公网静态版：`npm run build:static` 生成 `dist/`，`npm run preview:static` 预览。默认模拟回复，可切换浏览器直连访客自己的 Ollama 或兼容公共 API。配置和会话存浏览器，Key 仅在页面内存使用。详见 [静态演示说明](docs/STATIC_DEMO.md)。

使用远程模型决策、本地工具执行和 SQLite 对话缓存的简洁学习项目。需要 Node.js 24 或以上，以及可用的模型服务。

## 运行

```sh
npm install
# 没有 .env 时才复制，已有配置不要覆盖
cp .env.example .env
npm start
```

`.env` 使用 `MODELS` JSON 数组配置多个模型，每项含 `url`（完整请求地址）、`model` 和 `key`（不需要时留空）。`MODEL_INDEX` 指定启动时使用的数组序号，默认 0；`CHAT_SESSION_ID` 指定会话。默认配置连接本机 Ollama，指定模型需已下载。

- `/models`：列出模型，星号表示当前选择。
- `/prompts`：列出 SQLite 中保存的助手配置和当前选择。
- `/prompt tools` 或 `/prompt library`：切换到工具助手或图书管理助手；也可使用自定义助手的 ID。选择持久化到 SQLite，网页与 CLI 共用，下一轮生效。不同角色建议新建会话，避免旧上下文干扰。
- `/model 1`：切换到数组中序号为 1 的模型，保留当前上下文。
- `/exit`：退出。
- `/clear`：清空当前会话及 SQLite 中对应的历史。

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
admin/              管理页面及静态资源
tests/              后端与页面测试
docs/               开发记录
```

后续开发安排见 [开发记录](docs/DEVELOPMENT_PLAN.md)。`.env` 和 `.data/` 仍位于项目根目录，启动命令不变。

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 统一启动入口，默认网页服务，--cli 切换终端 |
| `src/cli.ts` | 终端交互、斜杠命令 |
| `src/agent/agent.ts` | 网页和终端共用的工具调用循环 |
| `src/agent/prompt.ts` | 默认提示词和工具协议说明 |
| `src/agent/model-stream.ts` | 模型 HTTP 请求和 SSE 读取 |
| `src/agent/tool-call.ts` | XML 工具调用解析 |
| `src/server.ts` | 本地 HTTP 服务、流式聊天、模型与会话接口 |
| `src/config/models.ts` | 加载环境变量和本地模型配置 |
| `src/tools/index.ts` | 统一注册 read_file、write_file、edit_file |
| `src/tools/*-file.ts` | 各文件工具的独立实现 |
| `src/tools/utils/syntax-check.ts` | JavaScript 语法检查与结果反馈 |
| `src/storage/sqlite.ts` | 会话读取、保存、清空和关闭数据库 |
| `tests/sqlite.test.ts` | 验证会话持久化、覆盖更新、隔离与清空 |

```text
用户输入 → 模型回答
              ↓ 要求工具
          本地执行 → 结果加入上下文 → 再请求模型
              ↓ 最终回答
          保存到 SQLite
```

新增工具时，在 `src/tools/` 创建独立文件实现 `Tool`（description、readOnly、execute），然后在 `index.ts` 注册，系统提示和页面工具清单会自动更新。模型使用自定义 XML `<tool_call name="工具名称"><params>...</params></tool_call>` 调用，文件正文放在 CDATA 中。

会话保存在 `.data/chat.sqlite`，启动时自动恢复，完整回答后保存。系统提示每次请求单独注入，不写入历史。不同 `CHAT_SESSION_ID` 使用不同会话。

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

服务只监听本机，`PORT` 可修改端口。聊天请求最多执行 8 次模型循环（`src/agent/agent.ts`），15 分钟超时（`src/http/chat.ts`）；失败或断开连接的轮次不保存。同一会话生成期间拒绝重复请求和删除。工具调用和工具结果保留在模型上下文，页面仅展示用户消息与最终回答。操作说明见 `admin/README.md`。
