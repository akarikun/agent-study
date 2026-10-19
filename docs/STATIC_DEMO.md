# 公网静态演示与浏览器直连

## 构建与部署

```sh
npm install
npm run build:static
npm run preview:static
```

预览地址为 `http://127.0.0.1:4173`，可通过 `STATIC_PORT` 修改端口。将生成的 `dist/` 上传到静态托管即可，支持站点根目录和子路径。无需启动 Node 后端、SQLite 或服务器上的 Ollama。构建只复制公开资源，不读取 `.env`、`.data`、会话记录或本机模型配置。此命令不自动发布。

原来的 `npm start` / `npm run cli` 保留本机 Node、SQLite 和文件工具模式。不要把带真实文件写入能力的本机服务直接作为匿名公网 API。

## 两种运行方式

- **演示模式（首次打开默认）**：浏览器生成固定模拟回复，支持流式输出、工具循环和停止。不访问模型或外网，天气是明确标注的虚构样例。示例：“北京今天的天气”“读取 README.md”。
- **浏览器直连**：先在“模型配置”保存自己的完整接口地址、模型名称和可选 Key，再切换顶部运行方式。浏览器直接请求该地址，保存配置不代表连接成功。连接失败会报错，不会自动回退模拟回复。

配置、助手、成功会话和虚拟文件存入访客浏览器 localStorage，不同浏览器不共享，清除站点数据会删除。Key 只在当前页面内存中使用，不进入缓存或站点服务器，刷新/关闭后需重新输入。Key 会发往用户配置的地址，只填写可信接口。修改接口地址而不重新输入 Key，会清除旧 Key。浏览器脚本能够访问页面内存，公共设备不适合输入长期高权限密钥。

## 本机 Ollama

完整地址：`http://localhost:11434/v1/chat/completions`。模型名称必须是用户本机已安装且可运行的名称，通常不需要 Key。localhost 指访问者的电脑，并非托管服务器。

公网 Origin 需被 Ollama 允许。Windows 先退出当前 Ollama，再通过 PowerShell 启动：

```powershell
$env:OLLAMA_ORIGINS = 'https://你的站点域名'
ollama serve
```

本地预览对应 `http://127.0.0.1:4173`。Origin 不含路径。环境变量只影响当前进程和子进程；用桌面程序/服务启动时，应在对应环境设置并重启。保留默认 loopback 监听，无需设置 `OLLAMA_HOST=0.0.0.0` 或暴露公网端口。

浏览器可能另外要求本地网络授权，或限制 HTTPS 页面访问 HTTP。允许 Origin 不能解决全部浏览器限制；无法直连时可下载项目，用原有 Node 模式在本机运行。

依据：[Ollama FAQ](https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama)。

## 公共模型 API

仅适配 **Chat Completions 流式协议**，接口必须允许浏览器 CORS。例如完整地址 `https://api.openai.com/v1/chat/completions`，模型与 Key 由用户自行填写。ChatGPT 网页订阅不是 API 凭据，访问权限、费用和额度由提供方决定。

不支持直接填写网页聊天地址，也未适配厂商非兼容原生接口或 Responses API。工具继续使用现有 XML 提示词协议，不使用原生 `tool_calls`。HTTP 401/403 提示检查 Key、权限或 Origin；网络/CORS/本地网络权限错误通常无法被浏览器脚本精确区分。站点不提供公共代理，不替访客转发 Key。

依据：[Chat Completions 文档](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。

## 工具与运行边界

- 文件工具只操作浏览器虚拟文件区，不访问访客磁盘或托管服务器，初始提供 `README.md`。
- 天气工具在演示模式返回虚构样例，在直连模式访问 Open-Meteo，并受网络/CORS 限制。
- 上下文、路由、系统提示和天气工具由构建脚本复用 TypeScript 源码，不需要额外打包依赖。
- 浏览器适配层执行模型流、XML 解析与工具循环；最多 8 次请求，单轮最多 15 分钟，可以停止。停止不会撤销已执行的虚拟文件操作。

## 验证范围

`npm test` 包含无外网演示、缓存恢复、工具失败回填、模拟公共 API 流、Key 不入缓存、停止与网络错误不误保存的测试。使用虚构 Key，不消费真实额度。最终公网 Origin 的 CORS、本地网络权限和真实账号访问需要在用户浏览器上验证。
