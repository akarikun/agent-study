import { reviewFinalAnswer } from './review.ts';
import { streamModelResponse } from './model-stream.ts';
import { buildContext } from './context.ts';
import { createSystemMessage, defaultPrompt } from './prompt.ts';
import { parseToolCall } from './tool-call.ts';
import { localTools } from '../tools/index.ts';
import type { Message } from '../storage/sqlite.ts';
import type { Model } from '../config/models.ts';
import type { Tool } from '../tools/index.ts';
import type { AgentStep } from './logger.ts';
import { createPlan, type PlanStep } from './plan.ts';

export { defaultPrompt } from './prompt.ts';
export { reviewAnswer } from './reflection.ts';

// 核心只产出事件：终端负责打印，HTTP 服务负责转成 SSE，避免依赖具体界面。
export type AgentEvent =
    | { type: 'plan'; status: 'planning' | 'executing' | 'done' | 'blocked'; steps: PlanStep[] }
    | { type: 'delta'; text: string }
    | { type: 'review'; status: 'running' | 'done' | 'fallback'; timeoutMs?: number }
    | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; error?: string };

// messages 会被原地追加；调用方负责加载历史，并在整轮成功后保存。
export async function* runAgent({
    model,
    messages,
    prompt = defaultPrompt,
    signal,
    tools = localTools,
    onStep,
    reflect = true,
    planExecute = false,
    reviewTimeoutMs = Number(process.env.REVIEW_TIMEOUT_MS || 20_000),
}: {
    model: Model;
    messages: Message[];
    prompt?: string;
    signal?: AbortSignal;
    tools?: Record<string, Tool>;
    onStep?: (step: AgentStep) => void;
    reflect?: boolean;
    planExecute?: boolean;
    reviewTimeoutMs?: number;
}): AsyncGenerator<AgentEvent> {
    let system = createSystemMessage(prompt, tools);
    if (!Number.isFinite(reviewTimeoutMs) || reviewTimeoutMs <= 0)
        throw new Error('REVIEW_TIMEOUT_MS 必须是正数');
    // 进入循环前固定本轮起点；后续追加的工具消息都属于本轮。
    const currentTurnStart = messages.findLastIndex(
        (message) => message.role === 'user' && !message.internal,
    );
    const historyEnd = currentTurnStart < 0 ? 0 : currentTurnStart;
    const getContext = () =>
        buildContext(messages.slice(0, historyEnd), messages.slice(historyEnd), {
            maxHistoryTurns: 3,
        });
    // 一轮用户消息可能触发多次模型请求；设置上限避免工具循环无限继续。
    let plan: PlanStep[] = [];
    const snapshot = () => plan.map((step) => ({ ...step }));
    let planChanged = false;
    if (planExecute) {
        yield { type: 'plan', status: 'planning', steps: [] };
        onStep?.({ stage: 'plan', message: '正在生成任务计划' });
        plan = await createPlan(model, system, getContext(), signal);
        plan[0].status = 'running';
        // 控制工具只改变程序中的计划状态，不执行任何业务操作。
        tools = {
            ...tools,
            complete_plan_step: {
                description:
                    '提交当前计划步骤的结果。参数 status 为 done 或 blocked，result 为具体结果或阻塞原因。只有具备真实证据才标记 done；需要用户补充信息、确认或无法继续时用 blocked。程序按顺序推进步骤，不能跳步。',
                readOnly: true,
                async execute({ status, result } = {}) {
                    const index = plan.findIndex((step) => step.status === 'running');
                    if (index < 0) throw new Error('没有正在执行的计划步骤');
                    if (
                        !['done', 'blocked'].includes(status) ||
                        typeof result !== 'string' ||
                        !result.trim() ||
                        result.length > 2000
                    )
                        throw new Error('需要 status=done/blocked 和不超过 2000 字的非空 result');
                    plan[index] = { ...plan[index], status, result };
                    if (status === 'done' && plan[index + 1]) plan[index + 1].status = 'running';
                    planChanged = true;
                    return { steps: snapshot() };
                },
            },
        };
        yield { type: 'plan', status: 'executing', steps: snapshot() };
        onStep?.({ stage: 'plan', message: '计划已生成，按顺序执行', data: snapshot() });
    }
    const maxRounds = planExecute ? 24 : 8;
    for (let round = 0; round < maxRounds; round++) {
        signal?.throwIfAborted();
        if (planExecute) {
            const active = plan.some((step) => step.status === 'running');
            system = createSystemMessage(
                `${prompt}\n\n## 当前执行计划（程序维护）\n${JSON.stringify(plan)}\n只处理 running 步骤，完成后调用 complete_plan_step 提交结果再继续。工具失败不代表步骤成功。需要用户补充或确认时提交 blocked，并向用户提问，结束本轮。所有步骤 done 后汇总真实结果。不能因计划要求而绕过权限、确认或编造成功。`,
                active ? tools : {},
            );
        }
        let answer = '';
        let streaming = false;
        const context = getContext();
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
            // 开启复查时先完整缓冲初稿，避免未经复查的内容提前显示。
            if (reflect || planExecute) continue;
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
            message: isToolCall
                ? `调用工具 ${call.tool}`
                : reflect
                  ? '生成回答初稿，准备复查'
                  : '给出最终回答，不再调用工具',
            data: { durationMs: Date.now() - requestedAt, outputCharacters: answer.length },
        });
        // 没有工具调用时才复查。工具阶段继续原来的执行—观察循环。
        if (!isToolCall) {
            if (planExecute && plan.some((step) => step.status === 'running')) {
                const step = plan.find((step) => step.status === 'running')!;
                step.status = 'blocked';
                step.result = '模型已结束本轮，未提交此步骤的完成结果';
                yield { type: 'plan', status: 'blocked', steps: snapshot() };
            }
            let finalAnswer = answer;
            if (reflect) {
                finalAnswer = yield* reviewFinalAnswer({
                    model,
                    prompt,
                    context,
                    answer,
                    signal,
                    reviewTimeoutMs,
                    onStep,
                    round: round + 1,
                });
            }
            // 只保存最终答案：不保存初稿和复查过程，保证页面与历史一致。
            messages.push({ role: 'assistant', content: finalAnswer });
            if (!streaming) yield { type: 'delta', text: finalAnswer };
            return;
        }
        messages.push({ role: 'assistant', content: answer, internal: true });
        yield { type: 'tool', name: call.tool, status: 'running' };
        const toolStartedAt = Date.now();
        onStep?.({ stage: 'tool', round: round + 1, message: call.tool, data: call.params ?? {} });
        let result;
        let toolError: string | undefined;
        try {
            if (planExecute && !plan.some((step) => step.status === 'running'))
                throw new Error('计划已完成或暂停，只能向用户汇总结果，不能继续执行工具');
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
        if (planChanged) {
            planChanged = false;
            const status = plan.some((step) => step.status === 'blocked')
                ? 'blocked'
                : plan.every((step) => step.status === 'done')
                  ? 'done'
                  : 'executing';
            yield { type: 'plan', status, steps: snapshot() };
            onStep?.({ stage: 'plan', message: `计划状态：${status}`, data: snapshot() });
        }
    }
    throw new Error(`工具调用达到 ${maxRounds} 次上限，请缩小任务范围`);
}
