import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import type { Model } from '../config/models.ts';
import type { Message } from '../storage/sqlite.ts';

export async function* streamModelResponse(
    model: Model,
    messages: Message[],
    signal?: AbortSignal,
) {
    // 这里只处理一次模型请求；signal 将上层取消或超时传递给 fetch。
    const result = await fetch(model.url, {
        method: 'POST',
        signal,
        headers: {
            'Content-Type': 'application/json',
            ...(model.key ? { Authorization: `Bearer ${model.key}` } : {}),
        },
        // internal 等本地元数据不属于模型协议，只发送 role 和 content。
        body: JSON.stringify({
            model: model.model,
            messages: messages.map(({ role, content }) => ({ role, content })),
            stream: true,
        }),
    });
    if (!result.ok) throw new Error(`模型请求失败：HTTP ${result.status}`);
    if (!result.body) throw new Error('模型没有返回响应流');
    // 网络分块不等于完整的一行，readline 负责拼接后再解析 SSE 的 data 行。
    const stream = Readable.fromWeb(result.body);
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
        for await (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') break;
            if (!payload) continue;
            const data = JSON.parse(payload);
            if (data.error) throw new Error(data.error.message || String(data.error));
            if (data.choices?.[0]?.delta?.content) yield data.choices[0].delta.content as string;
        }
        signal?.throwIfAborted();
    } catch (err) {
        console.log('line 分块解析失败', err);
    } finally {
        lines.close();
        stream.destroy();
    }
}
