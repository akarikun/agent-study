# Agent Studio 页面

独立静态前端，直接用浏览器打开 `index.html`。也可以在项目根目录运行 `python3 -m http.server 8080 --bind 127.0.0.1 --directory admin`，访问 `http://localhost:8080/`。

包含对话草稿、系统提示词编辑、模型配置、会话列表与搜索。配置仅保存到浏览器 localStorage，API Key 只留在页面内存，刷新即清除。

没有连接 Agent，没有网络模型请求，不读写 `.env` 或 SQLite。后续可把 `app.js` 的保存和发送操作替换为后台接口调用。
