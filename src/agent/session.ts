import { runAgent } from './agent.ts';
import type { Model } from '../config/models.ts';
import type { openChatStore } from '../storage/sqlite.ts';
import { createAgentLogger } from './logger.ts';

type Store = ReturnType<typeof openChatStore>;

// 网页和终端共用整轮执行与保存逻辑。
export async function* runSessionTurn({
    store,
    sessionId,
    text,
    model,
    prompt,
    signal,
    planExecute = false,
}: {
    store: Store;
    sessionId: string;
    text: string;
    model: Model;
    prompt?: string;
    signal?: AbortSignal;
    planExecute?: boolean;
}) {
    if (!text?.trim()) throw new Error('消息不能为空');

    const messages = store.load(sessionId);
    messages.push({ role: 'user', content: text.trim() });
    const selectedPrompt = prompt ?? store.activePrompt().content;
    const log = createAgentLogger(sessionId, model.key);
    const endpoint = new URL(model.url);
    log({
        stage: 'request',
        message: '开始处理用户任务',
        data: {
            model: model.name,
            endpoint: `${endpoint.origin}${endpoint.pathname}`,
            input: text.trim(),
            historyMessages: messages.length - 1,
        },
    });
    try {
        for await (const event of runAgent({
            model,
            messages,
            prompt: selectedPrompt,
            signal,
            onStep: log,
            planExecute,
        }))
            yield event;
        signal?.throwIfAborted();
        // 只有整轮成功才保存；失败时保留原历史。
        store.save(sessionId, messages);
        log({
            stage: 'done',
            message: '回答完成，会话已保存',
            data: { messages: messages.length },
        });
    } catch (error) {
        log({
            stage: 'error',
            message: signal?.aborted ? '已取消或超时，本轮未保存' : '本轮失败，未保存',
            data: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
