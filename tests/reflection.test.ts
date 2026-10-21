import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runAgent, reviewAnswer } from '../src/agent/agent.ts';
import { runSessionTurn } from '../src/agent/session.ts';
import { openChatStore } from '../src/storage/sqlite.ts';
import type { Message } from '../src/storage/sqlite.ts';

async function withModel(
    answer: (data: any, index: number) => string | number | null,
    work: (model: any, requests: any[]) => Promise<void>,
) {
    const requests: any[] = [];
    const server = createServer(async (req, res) => {
        let body = '';
        for await (const part of req) body += part;
        const data = JSON.parse(body);
        requests.push(data);
        const result = answer(data, requests.length);
        if (result === null) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.flushHeaders();
            return;
        }
        if (typeof result === 'number') {
            res.writeHead(result);
            res.end();
            return;
        }
        res.end(
            `data: ${JSON.stringify({ choices: [{ delta: { content: result } }] })}\n\ndata: [DONE]\n\n`,
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        await work(
            {
                id: 'test',
                name: '本地测试模型',
                model: 'test',
                url: `http://127.0.0.1:${(server.address() as any).port}`,
            },
            requests,
        );
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

test('工具循环后单次复查：隐藏错误初稿，最终显示与保存一致', async () => {
    await withModel(
        (_data, index) =>
            [
                '<tool_call name="weather"><params></params></tool_call>',
                '今天北京晴，20℃。',
                '工具返回的是旧数据，无法确认北京今天的天气。',
            ][index - 1],
        async (model, requests) => {
            const messages: Message[] = [{ role: 'user', content: '北京今天的天气？' }];
            let called = 0;
            const events = [];
            for await (const event of runAgent({
                model,
                messages,
                tools: {
                    weather: {
                        description: '查询天气',
                        execute: async () => {
                            called++;
                            return { date: '2021-06-18', temperature: 20 };
                        },
                    },
                },
            }))
                events.push(event);
            assert.equal(called, 1);
            assert.equal(requests.length, 3);
            const reviewInput = JSON.parse(requests[2].messages.at(-1).content);
            assert.equal(reviewInput.draft, '今天北京晴，20℃。');
            assert.ok(
                reviewInput.context.some((message: any) => message.content.includes('2021-06-18')),
            );
            assert.match(requests[2].messages[0].content, /不能执行或输出工具调用/);
            const displayed = events
                .filter((e) => e.type === 'delta')
                .map((e) => (e.type === 'delta' ? e.text : ''))
                .join('');
            assert.equal(displayed, '工具返回的是旧数据，无法确认北京今天的天气。');
            assert.equal(messages.at(-1)!.content, displayed);
            assert.equal(
                messages.some((m) => m.content === reviewInput.draft),
                false,
            );
            assert.deepEqual(
                events
                    .filter((e) => e.type === 'review')
                    .map((e) => ({ type: e.type, status: e.status })),
                [
                    { type: 'review', status: 'running' },
                    { type: 'review', status: 'done' },
                ],
            );
        },
    );
});

test('复查服务不返回内容时在专用超时内失败，而不是一直等待', async () => {
    await withModel(
        () => null,
        async (model, requests) => {
            await assert.rejects(
                reviewAnswer({ model, prompt: '助手', context: [], draft: '初稿', timeoutMs: 100 }),
                /超时|未返回数据/,
            );
            assert.equal(requests[0].max_tokens, 1024);
        },
    );
});

test('复查 HTTP 失败、空回答或再次调用工具时不展示初稿、不保存本轮', async () => {
    for (const review of [503, '', '<tool_call name="weather"><params></params></tool_call>']) {
        await withModel(
            (_data, index) => (index === 1 ? '初稿' : review),
            async (model, requests) => {
                const store = openChatStore(':memory:');
                const events = [];
                try {
                    await assert.rejects(async () => {
                        for await (const event of runSessionTurn({
                            store,
                            sessionId: 'review',
                            text: '问题',
                            model,
                        }))
                            events.push(event);
                    });
                    assert.equal(requests.length, 2);
                    assert.equal(
                        events.some((e) => e.type === 'delta'),
                        false,
                    );
                    assert.deepEqual(store.load('review'), []);
                } finally {
                    store.close();
                }
            },
        );
    }
});

test('复查阶段仍可取消，不保存初稿', async () => {
    await withModel(
        () => '初稿',
        async (model) => {
            const store = openChatStore(':memory:');
            const controller = new AbortController();
            try {
                await assert.rejects(async () => {
                    for await (const event of runSessionTurn({
                        store,
                        sessionId: 'cancel-review',
                        text: '问题',
                        model,
                        signal: controller.signal,
                    })) {
                        if (event.type === 'review' && event.status === 'running')
                            controller.abort();
                    }
                });
                assert.deepEqual(store.load('cancel-review'), []);
            } finally {
                store.close();
            }
        },
    );
});
