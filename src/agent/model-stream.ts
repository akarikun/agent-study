import type { Model } from '../config/models.ts';
import type { Message } from '../storage/sqlite.ts';

type StreamOptions = {
    timeoutMs?: number;
    idleTimeoutMs?: number;
    maxTokens?: number;
    onProgress?: (progress: { receivedBytes: number; outputCharacters: number }) => void;
};

export async function* streamModelResponse(
    model: Model,
    messages: Message[],
    signal?: AbortSignal,
    { timeoutMs = 120_000, idleTimeoutMs = 45_000, maxTokens, onProgress }: StreamOptions = {},
) {
    const controller = new AbortController();
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timeout = setTimeout(
        () => controller.abort(new Error(`模型请求超时（${Math.ceil(timeoutMs / 1000)}秒）`)),
        timeoutMs,
    );
    let idleTimer: ReturnType<typeof setTimeout>;
    const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
            () =>
                controller.abort(
                    new Error(`模型连续 ${Math.ceil(idleTimeoutMs / 1000)} 秒未返回数据`),
                ),
            idleTimeoutMs,
        );
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    resetIdle();
    try {
        const response = await fetch(model.url, {
            method: 'POST',
            signal: requestSignal,
            headers: {
                'Content-Type': 'application/json',
                ...(model.key ? { Authorization: `Bearer ${model.key}` } : {}),
            },
            body: JSON.stringify({
                model: model.model,
                messages: messages.map(({ role, content }) => ({ role, content })),
                stream: true,
                ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
            }),
        });
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`模型请求失败：HTTP ${response.status}`);
        }
        if (!response.body) throw new Error('模型没有返回响应流');
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;
        let receivedBytes = 0;
        let outputCharacters = 0;
        function parseLine(line: string): string {
            if (!line.startsWith('data:')) return '';
            const payload = line.slice(5).trim();
            if (!payload) return '';
            if (payload === '[DONE]') {
                finished = true;
                return '';
            }
            const data = JSON.parse(payload);
            if (data.error) throw new Error(data.error.message || String(data.error));
            const choice = data.choices?.[0];
            if (choice?.finish_reason === 'length')
                throw new Error('模型达到输出长度上限，未生成完整答案');
            if (choice?.finish_reason === 'content_filter')
                throw new Error('模型服务未能完成回答：content_filter');
            // 有些兼容服务只发 finish_reason，不发 [DONE]，也不立即关闭连接。
            if (choice?.finish_reason) finished = true;
            return typeof choice?.delta?.content === 'string' ? choice.delta.content : '';
        }
        while (!finished) {
            requestSignal.throwIfAborted();
            const { value, done } = await reader.read();
            if (value) {
                receivedBytes += value.byteLength;
                resetIdle();
            }
            buffer += decoder.decode(value, { stream: !done });
            if (buffer.length > 1_048_576) throw new Error('模型单帧响应过大');
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const text = parseLine(buffer.slice(0, end).replace(/\r$/, ''));
                buffer = buffer.slice(end + 1);
                if (text) {
                    outputCharacters += text.length;
                    yield text;
                }
                if (finished) break;
            }
            onProgress?.({ receivedBytes, outputCharacters });
            if (done && !finished) {
                const text = parseLine(buffer.trim());
                if (text) {
                    outputCharacters += text.length;
                    yield text;
                }
                if (!finished) throw new Error('模型流提前结束，未收到完成标记');
            }
        }
        requestSignal.throwIfAborted();
    } catch (error) {
        if (requestSignal.aborted) throw requestSignal.reason;
        throw error;
    } finally {
        clearTimeout(timeout);
        clearTimeout(idleTimer!);
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
    }
}
