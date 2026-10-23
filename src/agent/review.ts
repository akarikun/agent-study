import { reviewAnswer } from './reflection.ts';
import type { AgentEvent } from './agent.ts';
import type { AgentStep } from './logger.ts';
import type { Model } from '../config/models.ts';
import type { Message } from '../storage/sqlite.ts';

// 复查只处理最终回答：产出状态事件，返回最终文本；取消继续向外传播。
export async function* reviewFinalAnswer({
    model,
    prompt,
    context,
    answer,
    signal,
    reviewTimeoutMs,
    onStep,
    round,
}: {
    model: Model;
    prompt: string;
    context: Message[];
    answer: string;
    signal?: AbortSignal;
    reviewTimeoutMs: number;
    onStep?: (step: AgentStep) => void;
    round: number;
}): AsyncGenerator<AgentEvent, string> {
    let finalAnswer = answer;
    const reviewStartedAt = Date.now();
    yield { type: 'review', status: 'running', timeoutMs: reviewTimeoutMs };
    onStep?.({
        stage: 'review',
        round,
        message: '初稿已生成，复查用户目标与工具证据',
        data: {
            timeoutMs: reviewTimeoutMs,
            draftCharacters: answer.length,
            contextCharacters: context.reduce((sum, item) => sum + item.content.length, 0),
        },
    });
    let lastProgressAt = 0;
    let reviewed = false;
    try {
        finalAnswer = await reviewAnswer({
            model,
            prompt,
            context,
            draft: answer,
            signal,
            timeoutMs: reviewTimeoutMs,
            onProgress: (progress) => {
                if (Date.now() - lastProgressAt < 5000) return;
                lastProgressAt = Date.now();
                onStep?.({
                    stage: 'review',
                    round,
                    message: '复查请求正在接收数据',
                    data: progress,
                });
            },
        });
        reviewed = true;
    } catch (error) {
        // 用户取消必须终止；可选复查失败则保留完整初稿。
        signal?.throwIfAborted();
        onStep?.({
            stage: 'review',
            round,
            message: '复查未完成，返回初稿（未经复查）',
            data: { reason: error instanceof Error ? error.message : String(error) },
        });
        finalAnswer = `${answer}\n\n> 注：自动复查未完成，以上为未经复查的初稿。`;
    }
    onStep?.({
        stage: 'review',
        round,
        message: reviewed ? '单次复查完成' : '已使用初稿完成本轮',
        data: {
            changed: finalAnswer !== answer,
            durationMs: Date.now() - reviewStartedAt,
        },
    });
    yield { type: 'review', status: reviewed ? 'done' : 'fallback' };
    return finalAnswer;
}
