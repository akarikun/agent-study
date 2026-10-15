import { streamModelResponse } from './model-stream.ts';
import { createSystemMessage, defaultPrompt } from './prompt.ts';
import { parseToolCall } from './tool-call.ts';
import { localTools } from '../tools/index.ts';
import type { Message } from '../storage/sqlite.ts';
import type { Model } from '../config/models.ts';
import type { Tool } from '../tools/index.ts';

export { defaultPrompt } from './prompt.ts';

// 核心只产出事件：终端负责打印，HTTP 服务负责转成 SSE，避免依赖具体界面。
export type AgentEvent =
    { type: 'delta'; text: string } | { type: 'tool'; name: string; status: string };

// messages 会被原地追加；调用方负责加载历史，并在整轮成功后保存。
export async function* runAgent({
    model,
    messages,
    prompt = defaultPrompt,
    signal,
    tools = localTools,
}: {
    model: Model;
    messages: Message[];
    prompt?: string;
    signal?: AbortSignal;
    tools?: Record<string, Tool>;
}): AsyncGenerator<AgentEvent> {
    const system = createSystemMessage(prompt, tools);
    // 一轮用户消息可能触发多次模型请求；设置上限避免工具循环无限继续。
    const maxRounds = 8;
    for (let round = 0; round < maxRounds; round++) {
        signal?.throwIfAborted();
        let answer = '';
        let streaming = false;
        for await (const text of streamModelResponse(model, [system, ...messages], signal)) {
            answer += text;
            // XML/代码围栏开头先缓冲，避免把自定义工具协议显示为回答。
            if (streaming) yield { type: 'delta', text };
            else if (answer.trimStart() && !['<', '`'].includes(answer.trimStart()[0])) {
                streaming = true;
                yield { type: 'delta', text: answer };
            }
        }
        if (!answer.trim()) throw new Error('模型返回了空回答');
        const call = parseToolCall(answer);
        const isToolCall = typeof call?.tool === 'string';
        messages.push({
            role: 'assistant',
            content: answer,
            ...(isToolCall ? { internal: true } : {}),
        });
        // 普通文本是本轮最终回答；缓冲的普通 XML/代码在这里一次性输出。
        if (!isToolCall) {
            if (!streaming) yield { type: 'delta', text: answer };
            return;
        }
        yield { type: 'tool', name: call.tool, status: 'running' };
        let result;
        try {
            if (!Object.hasOwn(tools, call.tool)) throw new Error(`未知工具：${call.tool}`);
            result = await tools[call.tool].execute(call.params ?? {});
            // 工具失败也作为结果交回模型，让它解释失败或调整后续步骤。
        } catch (error) {
            console.log('工具执行异常', error);
            result = { error: error instanceof Error ? error.message : String(error) };
        }
        signal?.throwIfAborted();
        // 当前使用自定义 XML 工具协议，结果以 user 消息回填；internal 使页面隐藏这些中间步骤。
        messages.push({
            role: 'user',
            content: `工具 ${call.tool} 的执行结果：${JSON.stringify(result)}`,
            internal: true,
        });
        yield { type: 'tool', name: call.tool, status: 'done' };
    }
    throw new Error(`工具调用达到 ${maxRounds} 次上限，请缩小任务范围`);
}
