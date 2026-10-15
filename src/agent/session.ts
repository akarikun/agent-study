import { runAgent } from './agent.ts';
import type { Model } from '../config/models.ts';
import type { openChatStore } from '../storage/sqlite.ts';

type Store = ReturnType<typeof openChatStore>;

// 网页和终端共用整轮执行与保存逻辑。
export async function* runSessionTurn({
    store,
    sessionId,
    text,
    model,
    prompt,
    signal,
}: {
    store: Store;
    sessionId: string;
    text: string;
    model: Model;
    prompt?: string;
    signal?: AbortSignal;
}) {
    if (!text?.trim()) throw new Error('消息不能为空');

    const messages = store.load(sessionId);
    messages.push({ role: 'user', content: text.trim() });
    for await (const event of runAgent({ model, messages, prompt, signal })) yield event;
    signal?.throwIfAborted();
    // 只有整轮成功才保存；失败时保留原历史。
    store.save(sessionId, messages);
}
