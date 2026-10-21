# Agent Studio

## 启动方式

- Node 模式：在项目根目录运行 `npm run dev`，打开 `http://127.0.0.1:3000`，需要 Node.js 24+ 和模型服务；直接打开 `admin/index.html` 不能替代后端。
- 静态模式：运行 `npm run build:static`、`npm run preview:static`，打开 `http://127.0.0.1:4173`。部署 `dist/` 即可，默认模拟演示，也可切换浏览器直连。完整步骤见 [静态版本说明](../docs/STATIC_DEMO.md)。

以下存储位置默认指 Node 模式；静态模式的配置和会话存在访客浏览器，Key 只在当前页面内存中使用。

## 页面功能

- 对话：发送消息后流式显示回答，工具执行状态通过提示显示；完整回答后保存到 `.data/chat.sqlite`，刷新后恢复。
- 停止：生成期间点击“停止”可取消当前请求并结束等待，页面保留部分回复并标记已停止。未完成轮次不保存；已完成的工具操作不会自动撤销，正在执行的工具也不保证能中断。
- 复查（Node 模式）：初稿缓冲后由同一模型执行一次答案检查，页面显示“正在复查答案”，仅展示最终答案。复查不调用工具；失败或取消不保存初稿。静态模拟和浏览器直连暂不执行此复查。
- 复查等待：页面显示已等待秒数和最长等待时间。默认总时限 60 秒（可通过 `REVIEW_TIMEOUT_MS` 调整），连续 30 秒未收到数据也会失败；错误会同步到页面并恢复操作。后台复查进度的 `receivedBytes` 表示收到响应数据，`outputCharacters` 表示答案正文长度，两者不相等并不代表死循环。
- 工具扩展：左侧独立菜单展示注册工具、参数说明和只读/可写标记，点击条目展开。只读标记不是权限隔离。
- 工具错误：立即显示在可展开提示卡片中，完整错误可查看详情；工具失败会交回模型继续判断，等待时显示计时。整轮完成、取消或失败后同步停止等待。
- 天气：`get_weather` 从本地 `src/tools/utils/weather.data.ts` 匹配城市 ID，只请求一次魅族天气接口，直接返回原始天气信息。参数 `countyname`（兼容 `city`）；同名地区可补充 `areaid`。无需 Key，超时 15 秒。采用文档 HTTP 地址，公网 HTTPS 页面可能因混合内容或 CORS 限制而无法直连。说明：https://www.free-api.com/doc/518 。
- 助手回复支持 Markdown（列表、粗体、代码块、表格等），用户消息保持纯文本。发送后显示等待动画，工具执行时显示状态，收到回复或失败后结束等待。依赖通过本地服务加载，新环境先执行 `npm install`。
- 提示词：助手配置与当前选择保存在 `.data/chat.sqlite` 的 `prompts`、`settings` 表。内置工具助手（默认）和图书管理助手；工作台可切换，提示词页面可编辑或另存为新助手。页面与 CLI 共用选择，下一轮生效；已有对话不会清空。旧浏览器提示词可手动导入编辑器再保存。系统仍会追加统一工具协议，切换角色不会新增业务工具。
- 模型：首次加载 `.env`（没有时使用 `.env.example`）；网页修改后保存到 `.data/models.json`，重启和终端入口都会使用该文件。修改已有模型时 Key 留空保留原值。
- 会话：支持新建、搜索、打开和删除；历史由 SQLite 管理。
- 自动路由：工作台开关默认关闭，关闭时使用手选模型；开启时由 `src/agent/router.ts` 根据当前输入和最近两次用户提问判断。命中代码、分析类关键词或合并输入超过 800 字符时选参数量较大的模型，否则选较小的模型。参数量从模型名称中的 `4b`、`9b` 等标记识别；均无法识别时回退到首个配置模型。此规则用于本地学习，并非能力评测。一次用户请求只选一次模型，后续工具循环沿用它。开关保存在浏览器，页面显示本次实际模型与原因。
- 请求目标：浏览器直连时，顶部展示模型名称、模型标识和不含凭据及查询参数的地址。自动路由前提示待确定，路由后显示本轮实际目标。

## 数据与接口

本地 Node 工作台可开启“先规划再执行”，实时查看各步骤进度。`POST /api/chat` 接受可选布尔参数 `planExecute`（默认 false），额外发送 `plan` SSE 事件：`status` 为 planning/executing/done/blocked，`steps` 包含 title、status 和可选 result。步骤完成不等于整轮保存成功，仍以顶层 `done` 为准。静态模式暂不支持；当前计划仅在本轮内存中管理，不支持重启恢复。

Node 模式的 API Key 保存在服务端本机配置文件，不返回浏览器；静态模式的 Key 只保留在页面内存，发送给用户指定的模型服务。Node 服务只监听 `127.0.0.1`，文件工具具有进程的文件访问权限；静态文件工具仅访问浏览器虚拟文件。

接口包括 `POST /api/chat`（可选 `autoRoute` 布尔值，默认 false；SSE：route/delta/tool/review/done/error）、`GET/POST /api/models`、`DELETE /api/models/:id`、`GET /api/sessions`、`GET/DELETE /api/sessions/:id`。`route` 事件只包含模型 ID、显示名称和路由原因，不包含密钥。Node 模式的 `review` 事件状态为 running/done，用于同步复查等待状态。

助手接口为 `GET /api/prompts`、`POST /api/prompts`（保存或新建并选中）、`POST /api/prompts/active`（切换）。`GET /api/tools` 返回工具清单，`DELETE /api/sessions/:id/messages/:messageId` 删除消息及关联记录。静态版本由浏览器适配这些接口，不会发送到托管服务器；另提供内部 `/api/runtime` 切换模拟/直连模式。

`tool` 的 `running/done/error` 表示单次工具状态；顶层 `done` 表示整轮成功并保存，顶层 `error` 表示本轮失败。不要把工具失败与整轮失败混为一谈。Node 终端另有彩色步骤日志，静态版本没有 Node 终端日志。

`npm run check` 检查语法，`npm test` 运行 SQLite 与模拟模型 HTTP 集成测试，不需要真实模型或 Key。
