import type { Message } from '../storage/sqlite.ts';

// history 是过去的对话，currentTurn 是本轮提问及其工具调用、结果。
// 只筛选发送给模型的消息，不修改用于保存的完整历史。
export function buildContext(
    history: readonly Message[],
    currentTurn: readonly Message[],
    options: { maxHistoryTurns?: number } = {},
): Message[] {
    const { maxHistoryTurns = 3 } = options;
    if (!Number.isInteger(maxHistoryTurns) || maxHistoryTurns < 0) {
        throw new Error('maxHistoryTurns 必须是非负整数');
    }

    let turns = 0;
    let start = history.length;
    // 工具结果也是 user 消息，但 internal=true，不代表新一轮提问。
    for (let index = history.length - 1; index >= 0 && turns < maxHistoryTurns; index--) {
        if (history[index].role === 'user' && !history[index].internal) {
            start = index;
            turns++;
        }
    }

    return [...history.slice(start), ...currentTurn];
}
