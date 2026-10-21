import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runAgent } from '../src/agent/agent.ts';
import type { Tool } from '../src/tools/index.ts';
import type { Message } from '../src/storage/sqlite.ts';

test('注册工具均可执行，工具结果回填上下文', async () => {
    let called = 0;
    const requests: any[] = [];
    const mock = createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        requests.push(data);
        const last = data.messages.at(-1).content;
        const answer = ['read', 'write', 'unmarked'].includes(last)
            ? `<tool_call name="${last}"><params></params></tool_call>`
            : '任务完成';
        res.end(
            `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`,
        );
    });
    mock.listen(0, '127.0.0.1');
    await once(mock, 'listening');
    const model = {
        id: 'test',
        name: 'test',
        model: 'test',
        url: `http://127.0.0.1:${(mock.address() as any).port}`,
    };
    const tools: Record<string, Tool> = {
        read: {
            description: '允许读取',
            readOnly: true,
            execute: async () => {
                called++;
                return 'data';
            },
        },
        write: {
            description: '允许写入',
            readOnly: false,
            execute: async () => {
                called++;
                return 'written';
            },
        },
        unmarked: {
            description: '未声明权限',
            execute: async () => {
                called++;
                return 'unknown';
            },
        },
    };
    try {
        for (const tool of ['read', 'write', 'unmarked']) {
            const messages: Message[] = [{ role: 'user', content: tool }];
            const events = [];
            const steps: string[] = [];
            for await (const event of runAgent({
                model,
                reflect: false,
                messages,
                tools,
                onStep: (step) => steps.push(step.stage),
            }))
                events.push(event);
            assert.deepEqual(steps, [
                'request',
                'decision',
                'tool',
                'result',
                'request',
                'decision',
            ]);
            assert.equal(
                events
                    .filter((event) => event.type === 'delta')
                    .map((event) => (event.type === 'delta' ? event.text : ''))
                    .join(''),
                '任务完成',
            );
        }
        assert.equal(called, 3);
        assert.match(requests[0].messages[0].content, /read：允许读取/);
        assert.match(requests[0].messages[0].content, /write：允许写入/);
        for await (const _ of runAgent({
            reflect: false,
            model,
            messages: [{ role: 'user', content: 'write' }],
            tools,
        })) {
        }
        assert.equal(called, 4);
        const failedSteps: string[] = [];
        const failedEvents = [];
        for await (const event of runAgent({
            reflect: false,
            model,
            messages: [{ role: 'user', content: 'read' }],
            tools: {
                read: {
                    description: '模拟失败',
                    execute: async () => {
                        throw new Error('读取失败');
                    },
                },
            },
            onStep: (step) => failedSteps.push(step.stage),
        }))
            failedEvents.push(event);
        assert.deepEqual(failedSteps, [
            'request',
            'decision',
            'tool',
            'error',
            'request',
            'decision',
        ]);
        assert.ok(failedEvents.some((event) => event.type === 'tool' && event.status === 'error'));
    } finally {
        await new Promise<void>((resolve) => mock.close(() => resolve()));
    }
});
