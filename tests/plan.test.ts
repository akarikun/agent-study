import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runAgent } from '../src/agent/agent.ts';
import type { Message } from '../src/storage/sqlite.ts';

async function run(answers: string[], tools = {}) {
    const requests: any[] = [];
    const server = createServer(async (req, res) => {
        let body = '';
        for await (const part of req) body += part;
        requests.push(JSON.parse(body));
        const content = answers[requests.length - 1] ?? '结束';
        res.end(
            `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const messages: Message[] = [{ role: 'user', content: '查询天气并总结' }];
    const events: any[] = [];
    try {
        for await (const event of runAgent({
            model: {
                id: 'test',
                name: 'test',
                model: 'test',
                url: `http://127.0.0.1:${(server.address() as any).port}`,
            },
            messages,
            tools,
            reflect: false,
            planExecute: true,
        }))
            events.push(event);
        return { requests, messages, events };
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

const complete = (status: string, result: string) =>
    `<tool_call name="complete_plan_step"><params><status>${status}</status><result>${result}</result></params></tool_call>`;

test('先规划、真实调用工具、逐步提交结果，最后汇总；计划快照不会被后续修改', async () => {
    let calls = 0;
    const { requests, messages, events } = await run(
        [
            '{"steps":["查询天气","总结结果"]}',
            '<tool_call name="weather"><params></params></tool_call>',
            complete('done', '工具返回晴天'),
            complete('done', '已整理查询结果'),
            '查询结果：晴天。',
        ],
        {
            weather: {
                description: '查询天气',
                execute: async () => {
                    calls++;
                    return { weather: '晴' };
                },
            },
        },
    );
    assert.equal(calls, 1);
    const plans = events.filter((event) => event.type === 'plan');
    assert.deepEqual(
        plans.map((event) => event.status),
        ['planning', 'executing', 'executing', 'done'],
    );
    assert.deepEqual(
        plans[1].steps.map((step: any) => step.status),
        ['running', 'pending'],
    );
    assert.deepEqual(
        plans[2].steps.map((step: any) => step.status),
        ['done', 'running'],
    );
    assert.ok(requests[3].messages[0].content.includes('工具返回晴天'));
    assert.equal(
        events
            .filter((event) => event.type === 'delta')
            .map((event) => event.text)
            .join(''),
        '查询结果：晴天。',
    );
    assert.equal(messages.at(-1)?.content, '查询结果：晴天。');
    assert.ok(!messages.some((message) => message.content === '{"steps":["查询天气","总结结果"]}'));
});

test('步骤阻塞后禁止执行后续业务工具，保留待执行状态并询问用户', async () => {
    let calls = 0;
    const { events } = await run(
        [
            '{"steps":["询问城市","查询天气"]}',
            complete('blocked', '缺少城市'),
            '<tool_call name="weather"><params></params></tool_call>',
            '请问你要查询哪个城市？',
        ],
        {
            weather: {
                description: '天气',
                execute: async () => {
                    calls++;
                },
            },
        },
    );
    assert.equal(calls, 0);
    const blocked = events.find((event) => event.type === 'plan' && event.status === 'blocked');
    assert.deepEqual(
        blocked.steps.map((step: any) => step.status),
        ['blocked', 'pending'],
    );
    assert.ok(events.some((event) => event.type === 'tool' && event.status === 'error'));
});

test('非法计划不执行工具；未提交完成直接回答不会被标成成功', async () => {
    await assert.rejects(run(['不是 JSON']), /规划结果不是有效 JSON/);
    await assert.rejects(run(['{"steps":[]}']), /1～6/);
    const { events } = await run(['{"steps":["查询天气"]}', '需要提供城市']);
    assert.equal(events.filter((event) => event.type === 'plan').at(-1).status, 'blocked');
});
