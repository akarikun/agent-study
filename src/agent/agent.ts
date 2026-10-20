import { streamModelResponse } from './model-stream.ts';
import { buildContext } from './context.ts';
import { createSystemMessage, defaultPrompt } from './prompt.ts';
import { parseToolCall } from './tool-call.ts';
import { localTools } from '../tools/index.ts';
import type { Message } from '../storage/sqlite.ts';
import type { Model } from '../config/models.ts';
import type { Tool } from '../tools/index.ts';
import type { AgentStep } from './logger.ts';

export { defaultPrompt } from './prompt.ts';

// 核心只产出事件：终端负责打印，HTTP 服务负责转成 SSE，避免依赖具体界面。
export type AgentEvent =
    | { type: 'delta'; text: string }
    | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; error?: string };

// messages 会被原地追加；调用方负责加载历史，并在整轮成功后保存。
export async function* runAgent({
    model,
    messages,
    prompt = defaultPrompt,
    signal,
    tools = localTools,
    onStep,
}: {
    model: Model;
    messages: Message[];
    prompt?: string;
    signal?: AbortSignal;
    tools?: Record<string, Tool>;
    onStep?: (step: AgentStep) => void;
}): AsyncGenerator<AgentEvent> {
    const system = createSystemMessage(prompt, tools);
    // 进入循环前固定本轮起点；后续追加的工具消息都属于本轮。
    const currentTurnStart = messages.findLastIndex(
        (message) => message.role === 'user' && !message.internal,
    );
    const historyEnd = currentTurnStart < 0 ? 0 : currentTurnStart;
    // 一轮用户消息可能触发多次模型请求；设置上限避免工具循环无限继续。
    const maxRounds = 8;
    for (let round = 0; round < maxRounds; round++) {
        signal?.throwIfAborted();
        let answer = '';
        let streaming = false;
        const context = buildContext(messages.slice(0, historyEnd), messages.slice(historyEnd), {
            maxHistoryTurns: 3,
        });
        const requestedAt = Date.now();
        onStep?.({
            stage: 'request',
            round: round + 1,
            message: '等待模型输出',
            data: {
                model: model.model,
                messages: context.length + 1,
                characters:
                    system.content.length +
                    context.reduce((sum, item) => sum + item.content.length, 0),
                tools: Object.keys(tools),
            },
        });
        for await (const text of streamModelResponse(model, [system, ...context], signal)) {
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
        onStep?.({
            stage: 'decision',
            round: round + 1,
            message: isToolCall ? `调用工具 ${call.tool}` : '给出最终回答，不再调用工具',
            data: { durationMs: Date.now() - requestedAt, outputCharacters: answer.length },
        });
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
        const toolStartedAt = Date.now();
        onStep?.({ stage: 'tool', round: round + 1, message: call.tool, data: call.params ?? {} });
        let result;
        let toolError: string | undefined;
        try {
            if (!Object.hasOwn(tools, call.tool)) throw new Error(`未知工具：${call.tool}`);
            result = await tools[call.tool].execute(call.params ?? {});
        } catch (error) {
            toolError = error instanceof Error ? error.message : String(error);
            result = { error: toolError };
        }
        signal?.throwIfAborted();
        onStep?.({
            stage: toolError === undefined ? 'result' : 'error',
            round: round + 1,
            message: `${call.tool} ${toolError === undefined ? '成功' : '失败'}，结果回填给模型继续判断`,
            data: { durationMs: Date.now() - toolStartedAt, result },
        });
        // 当前使用自定义 XML 工具协议，结果以 user 消息回填；internal 使页面隐藏这些中间步骤。
        messages.push({
            role: 'user',
            content: `工具 ${call.tool} 的执行结果：${JSON.stringify(result)}`,
            internal: true,
        });
        // 工具失败是可恢复事件：立即通知界面，再把结果交给模型决定下一步。
        yield toolError !== undefined
            ? { type: 'tool', name: call.tool, status: 'error', error: toolError }
            : { type: 'tool', name: call.tool, status: 'done' };
    }
    throw new Error(`工具调用达到 ${maxRounds} 次上限，请缩小任务范围`);
}
