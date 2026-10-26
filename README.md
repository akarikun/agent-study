# Agent Study

个人 Agent 学习项目，使用 Node.js、TypeScript 和 SQLite，部分代码由 Codex 辅助编写。

## 启动

需要 Node.js 24+：

```sh
npm install
npm start
```

打开 http://127.0.0.1:3000；终端模式运行 `npm run cli`。

没有 `.env` 时使用 `.env.example`。可在网页配置模型，或在 `.env` 的 `MODELS` 数组中填写 `url`（完整 Chat Completions 地址）、`model` 和可选 `key`。网页保存的 `.data/models.json` 优先。本地 Ollama 需要提前安装并启动模型。

## 现有功能

- Agent 工具循环、SSE 输出、会话保存、日志、超时与取消。
- 通用、图书、文件、天气、知识问答角色，按角色分配工具。
- 图书查询、入库、借阅与归还，SQLite 事务和借还去重。
- 本地 Markdown/TXT 关键词 RAG，返回原文、文件名与行号。
- `remember` 工具保存长期记忆；自动读取并注入上下文尚未实现。
- 可选任务规划、单次答案复查和天气/文件子助手委派。

CLI 使用 `/prompts` 查看助手，`/prompt library` 或 `/prompt knowledge` 切换；`/models`、`/model 0` 选择模型，`/clear` 清空当前会话，`/exit` 退出。

## 文档检索

将 Markdown/TXT 放入 `knowledge/`，生成索引后选择“知识问答助手”：

```sh
npm run rag:index
```

可以问“借阅为什么需要事务？”或“requestId 有什么作用？”。修改文档后重新生成索引。当前采用关键词匹配，没有 Embedding 或向量数据库。

## 代码入口

| 位置                    | 职责                     |
| ----------------------- | ------------------------ |
| `src/agent/registry.ts` | 创建各角色 Agent 实例    |
| `src/agent/instance.ts` | Agent 类与 run 入口      |
| `src/agent/agent.ts`    | 通用工具调用循环         |
| `src/agent/session.ts`  | 加载历史、运行与保存会话 |
| `src/tools/index.ts`    | 工具注册与分组           |
| `src/tools/library/`    | 图书工具与数据库业务     |
| `src/rag/`              | 文档切块、索引与检索     |
| `src/storage/sqlite.ts` | 会话、助手配置与记忆存储 |
| `admin/`                | 网页界面                 |

新增工具实现 `Tool` 的 description、readOnly、execute，再加入对应工具集合。模型通过自定义 XML 工具协议提出操作，由程序执行。

## 检查与静态演示

```sh
npm run check
npm run format:check
npm run build:static
npm run preview:static
```

静态演示地址 http://127.0.0.1:4173，产物位于 `dist/`。支持模拟模式和浏览器直连，功能与 Node 版不同，不包含本机 SQLite 和文档索引。`npm run publish` 仅构建，不上传。

## 数据与边界

本机数据位于 `.data/`，模型密钥可能保存在其中；`.env`、`.data/`、`dist/` 已忽略，不应提交。服务仅监听本机。图书功能尚无身份认证，入库没有请求去重；文件工具没有系统沙箱。取消或会话保存失败不会回滚已执行的工具操作。

## 学习文档

- [运行流程与状态](docs/AGENT_RUNTIME_GUIDE.md)
- [开发记录](docs/DEVELOPMENT_PLAN.md)
- [页面说明](admin/README.md)
- [静态部署](docs/STATIC_DEMO.md)
