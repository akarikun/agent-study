# Agent Studio

在项目根目录运行 `npm run dev`，打开 `http://127.0.0.1:3000`。需要 Node.js 24+ 和可用的模型服务。不要直接双击 HTML 或使用静态服务器，页面需要同源 Node 接口。

- 对话：发送消息后流式显示回答，工具执行状态通过提示显示；完整回答后保存到 `.data/chat.sqlite`，刷新后恢复。
- 助手回复支持 Markdown（列表、粗体、代码块、表格等），用户消息保持纯文本。发送后显示等待动画，工具执行时显示状态，收到回复或失败后结束等待。依赖通过本地服务加载，新环境先执行 `npm install`。
- 提示词：保存在当前浏览器，每轮发送给 Agent，服务端自动追加工具规则。
- 模型：首次加载 `.env`（没有时使用 `.env.example`）；网页修改后保存到 `.data/models.json`，重启和终端入口都会使用该文件。修改已有模型时 Key 留空保留原值。
- 会话：支持新建、搜索、打开和删除；历史由 SQLite 管理。

API Key 只保存在服务端本机配置文件，不返回浏览器。服务只监听 `127.0.0.1`；当前 `read_file` 工具具有运行进程的文件读取权限。

接口包括 `POST /api/chat`（SSE：delta/tool/done/error）、`GET/POST /api/models`、`DELETE /api/models/:id`、`GET /api/sessions`、`GET/DELETE /api/sessions/:id`。

`npm run check` 检查语法，`npm test` 运行 SQLite 与模拟模型 HTTP 集成测试，不需要真实模型或 Key。
