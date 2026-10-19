import type { ServerResponse } from 'node:http';
import type { Model } from '../config/models.ts';
import type { openChatStore } from '../storage/sqlite.ts';
import { runSessionTurn } from '../agent/session.ts';
import { errorMessage } from './responses.ts';

type ChatRequest = { sessionId: string; text: string; prompt?: string };
type ChatContext = {
    data: ChatRequest;
    model: Model;
    routeReason?: string;
    store: ReturnType<typeof openChatStore>;
    busy: Set<string>;
    res: ServerResponse;
    controller: AbortController;
};

const CHAT_TIMEOUT_MS = 900_000;

export async function streamChat({
    data,
    model,
    routeReason,
    store,
    busy,
    res,
    controller,
}: ChatContext) {
    busy.add(data.sessionId);
    const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
    });
    res.flushHeaders();
    // 每个事件用空行结束，前端按 SSE 帧逐条解析。
    const send = (event: unknown) => {
        if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
        send({ type: 'route', modelId: model.id, modelName: model.name, reason: routeReason });
        for await (const event of runSessionTurn({
            store,
            sessionId: data.sessionId,
            text: data.text,
            model,
            prompt: data.prompt,
            signal: controller.signal,
        }))
            send(event);
        // 只有整轮成功且未被取消才保存，done 表示服务端已完成持久化。
        send({ type: 'done' });
    } catch (error) {
        send({
            type: 'error',
            message: controller.signal.aborted ? '请求已取消或超时' : errorMessage(error),
        });
    } finally {
        clearTimeout(timeout);
        busy.delete(data.sessionId);
        res.end();
    }
}
