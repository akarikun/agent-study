import { createServer } from 'node:http';
import { createModelStore } from './config/model-store.ts';
import { sendJson, readJson, errorMessage } from './http/responses.ts';
import { serveStatic } from './http/static-files.ts';
import { streamChat } from './http/chat.ts';
import { loadModels } from './config/models.ts';
import { projectPath } from './config/paths.ts';
import { openChatStore } from './storage/sqlite.ts';
import { localTools } from './tools/index.ts';
import { routeModel } from './agent/router.ts';

export function createApp({
    models = loadModels(),
    store = openChatStore(),
    configPath = projectPath('.data/models.json'),
} = {}) {
    const modelStore = createModelStore(models, configPath);
    // 同一会话串行生成，其他会话仍可独立处理。
    const busy = new Set<string>();
    const server = createServer(async (req, res) => {
        const json = (status: number, data: unknown) => sendJson(res, status, data);
        const controller = new AbortController();
        // 客户端提前断开时取消模型请求；正常结束响应不触发取消。
        res.on('close', () => {
            if (!res.writableEnded) controller.abort();
        });
        try {
            const host = req.headers.host || '';
            // 限制本地主机与同源请求，减少其他网页借本地服务调用工具的风险。
            if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
                return json(403, { error: '只允许本地访问' });
            if (req.headers.origin && req.headers.origin !== `http://${host}`)
                return json(403, { error: '不允许跨源请求' });
            const url = new URL(req.url || '/', `http://${host}`);
            if (url.pathname === '/api/prompts' && req.method === 'GET')
                return json(200, store.promptConfig());
            if (url.pathname === '/api/prompts' && req.method === 'POST')
                return json(200, store.savePrompt(await readJson(req)));
            if (url.pathname === '/api/prompts/active' && req.method === 'POST') {
                const data = await readJson(req);
                return json(200, store.selectPrompt(data.id));
            }
            // 清单来自 Agent 使用的同一个注册表，只返回说明和权限，不暴露执行函数。
            if (url.pathname === '/api/tools' && req.method === 'GET') {
                return json(
                    200,
                    Object.entries(localTools).map(([name, tool]) => ({
                        name,
                        description: tool.description,
                        readOnly: tool.readOnly === true,
                    })),
                );
            }
            if (url.pathname === '/api/models' && req.method === 'GET')
                return json(200, modelStore.list());
            if (url.pathname === '/api/models' && req.method === 'POST') {
                const data = await readJson(req);
                modelStore.upsert(data);
                return json(200, modelStore.list());
            }
            if (url.pathname.startsWith('/api/models/') && req.method === 'DELETE') {
                modelStore.remove(decodeURIComponent(url.pathname.slice('/api/models/'.length)));
                return json(200, modelStore.list());
            }
            if (url.pathname === '/api/sessions' && req.method === 'GET')
                return json(200, store.list());
            const messageRoute = url.pathname.match(
                /^\/api\/sessions\/([^/]+)\/messages\/([^/]+)$/,
            );
            if (messageRoute && req.method === 'DELETE') {
                const id = decodeURIComponent(messageRoute[1]);
                if (busy.has(id)) return json(409, { error: '会话正在生成中' });
                if (!store.deleteMessage(id, decodeURIComponent(messageRoute[2])))
                    return json(404, { error: '消息不存在，请刷新后重试' });
                return json(200, { ok: true });
            }
            if (url.pathname.startsWith('/api/sessions/')) {
                const id = decodeURIComponent(url.pathname.slice('/api/sessions/'.length));
                if (req.method === 'GET')
                    return json(
                        200,
                        store.load(id).filter((message) => !message.internal),
                    );
                if (req.method === 'DELETE') {
                    if (busy.has(id)) return json(409, { error: '会话正在生成中' });
                    store.clear(id);
                    return json(200, { ok: true });
                }
            }
            if (url.pathname === '/api/chat' && req.method === 'POST') {
                const data = await readJson(req);
                if (
                    typeof data.sessionId !== 'string' ||
                    !data.sessionId ||
                    data.sessionId.length > 200 ||
                    typeof data.text !== 'string' ||
                    !data.text.trim() ||
                    (data.prompt !== undefined && typeof data.prompt !== 'string') ||
                    (data.autoRoute !== undefined && typeof data.autoRoute !== 'boolean') ||
                    (data.planExecute !== undefined && typeof data.planExecute !== 'boolean')
                )
                    throw new Error('消息参数无效');
                if (busy.has(data.sessionId)) return json(409, { error: '该会话正在生成中' });
                const route = routeModel({
                    models: modelStore.list(),
                    modelId: data.modelId,
                    autoRoute: data.autoRoute,
                    text: data.text,
                    history: data.autoRoute ? store.load(data.sessionId) : [],
                });
                const model = modelStore.find(route.model.id)!;
                await streamChat({
                    data,
                    model,
                    routeReason: route.reason,
                    store,
                    busy,
                    res,
                    controller,
                });
                return;
            }
            if (req.method === 'GET' && serveStatic(url.pathname, res)) return;
            json(404, { error: '接口不存在' });
        } catch (error) {
            if (!res.headersSent) json(400, { error: errorMessage(error) });
            else res.end();
        }
    });
    server.on('close', () => store.close());
    return server;
}
// 由 main.ts 调用启动；导入本模块不会自动监听端口。
export async function startServer() {
    const server = createApp();
    const port = Number(process.env.PORT || 3000);
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '127.0.0.1', resolve);
        });
    } catch (error) {
        server.close();
        throw error;
    }
    const address = server.address();
    console.log(
        `Agent Studio: http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`,
    );
    return server;
}
