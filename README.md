# 本地 Ollama Agent

使用远程模型决策、本地工具执行和 SQLite 对话缓存的简洁学习项目。需要 Node.js 24 或以上，以及可用的模型服务。

## 运行

```sh
npm install
# 没有 .env 时才复制，已有配置不要覆盖
cp .env.example .env
npm run main
```

`.env` 使用 `MODELS` JSON 数组配置多个模型，每项含 `url`（完整请求地址）、`model` 和 `key`（不需要时留空）。`MODEL_INDEX` 指定启动时使用的数组序号，默认 0；`CHAT_SESSION_ID` 指定会话。默认配置连接本机 Ollama，指定模型需已下载。

- `/models`：列出模型，星号表示当前选择。
- `/model 1`：切换到数组中序号为 1 的模型，保留当前上下文。
- `/exit`：退出。
- `/clear`：清空当前会话及 SQLite 中对应的历史。

## 文件与流程

| 文件 | 职责 |
| --- | --- |
| `main.ts` | 终端交互、系统提示、流式请求和工具调用循环 |
| `tools.ts` | 本地工具定义与实现，目前提供 `read_file` |
| `sqlite.ts` | 会话读取、保存、清空和关闭数据库 |
| `sqlite.test.ts` | 验证会话持久化、覆盖更新、隔离与清空 |

```text
用户输入 → 模型回答
              ↓ 要求工具
          本地执行 → 结果加入上下文 → 再请求模型
              ↓ 最终回答
          保存到 SQLite
```

在 `tools.ts` 添加工具的名称、参数说明和 `execute`，系统提示中的工具清单会自动更新。使用自定义 JSON 调用格式：`{"tool":"工具名称","params":{...}}`。

会话保存在 `.data/chat.sqlite`，启动时自动恢复，完整回答后保存。系统提示每次请求单独注入，不写入历史。不同 `CHAT_SESSION_ID` 使用不同会话。

## 检查

```sh
npm run check
npm test
```

当前保留最小执行流程；上下文截断、循环次数限制可在此基础上扩展。

## 独立管理页面

`admin/index.html` 提供对话草稿、提示词编辑、模型配置与会话管理的纯前端页面，未接入 Agent。操作说明见 `admin/README.md`。
