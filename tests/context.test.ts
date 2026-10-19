import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../src/agent/context.ts';
import type { Message } from '../src/storage/sqlite.ts';

test('按真实用户轮次裁剪，保留配套工具消息和整个当前轮，不修改历史', () => {
    const history: Message[] = [
        { role: 'user', content: '旧问题' },
        { role: 'assistant', content: '旧回答' },
        { role: 'user', content: '最近问题' },
        { role: 'assistant', content: '调用工具', internal: true },
        { role: 'user', content: '工具结果', internal: true },
        { role: 'assistant', content: '最近回答' },
    ];
    const current: Message[] = [
        { role: 'user', content: '本次问题' },
        { role: 'assistant', content: '本次工具调用', internal: true },
        { role: 'user', content: '本次工具结果', internal: true },
    ];
    const before = structuredClone(history);
    assert.deepEqual(buildContext(history, current, { maxHistoryTurns: 1 }), [
        ...history.slice(2),
        ...current,
    ]);
    assert.deepEqual(history, before);
    assert.deepEqual(buildContext(history, current, { maxHistoryTurns: 0 }), current);
    assert.deepEqual(buildContext(history, current), [...history, ...current]);
    assert.deepEqual(buildContext([], current), current);
});

test('拒绝无效的历史轮数', () => {
    for (const maxHistoryTurns of [-1, 1.5, NaN, Infinity]) {
        assert.throws(() => buildContext([], [], { maxHistoryTurns }), /非负整数/);
    }
});
