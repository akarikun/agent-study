import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runAgent } from '../src/agent/agent.ts';
import { createSubAgentTools } from '../src/agent/sub-agents.ts';
import type { Message } from '../src/storage/sqlite.ts';

test('主助手委派子助手：隔离上下文和工具，子助手结果返回主循环', async () => {
    const requests: any[] = [];
    let childStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        childStarted = resolve;
    });
    const answers = [
        '<tool_call name="ask_weather_agent"><params><task>北京天气</task></params></tool_call>',
        '<tool_call name="get_weather"><params><countyname>北京</countyname></params></tool_call>',
        '北京晴，数据来自天气工具。',
        '汇总：北京晴。',
        '独立的第二次任务。',
    ];
    const server = createServer(async (req, res) => {
        let body = '';
        for await (const part of req) body += part;
        requests.push(JSON.parse(body));
        const task = requests.at(-1).messages.at(-1).content;
        if (task === 'failure') {
            res.writeHead(503);
            res.end();
            return;
        }
        if (task === 'hang') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.flushHeaders();
            childStarted();
            return;
        }
        res.end(
            `data: ${JSON.stringify({ choices: [{ delta: { content: answers[requests.length - 1] } }] })}\n\ndata: [DONE]\n\n`,
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const model = {
            id: 'test',
            name: 'test',
            model: 'test',
            url: `http://127.0.0.1:${(server.address() as any).port}`,
        };
        let weatherCalls = 0;
        const logs: string[] = [];
        const tools = createSubAgentTools(
            model,
            {
                get_weather: {
                    description: '查询天气',
                    execute: async () => {
                        weatherCalls++;
                        return { weather: '晴' };
                    },
                },
                read_file: { description: '读取文件', execute: async () => '文件' },
            },
            undefined,
            (step) => logs.push(step.message),
        );
        const messages: Message[] = [
            { role: 'user', content: '主助手私有历史' },
            { role: 'user', content: '查北京天气' },
        ];
        const events = [];
        for await (const event of runAgent({ model, messages, tools, reflect: false }))
            events.push(event);
        assert.equal(weatherCalls, 1);
        assert.equal(requests[1].messages.length, 2);
        assert.equal(requests[1].messages[1].content, '北京天气');
        assert.ok(!JSON.stringify(requests[1]).includes('主助手私有历史'));
        assert.ok(!requests[1].messages[0].content.includes('ask_weather_agent'));
        assert.ok(!requests[1].messages[0].content.includes('read_file'));
        assert.ok(JSON.stringify(requests[3]).includes('北京晴，数据来自天气工具。'));
        assert.ok(logs.some((message) => message.startsWith('[天气助手]')));
        assert.equal(
            events
                .filter((event) => event.type === 'delta')
                .map((event) => event.text)
                .join(''),
            '汇总：北京晴。',
        );
        await tools.ask_weather_agent.execute({ task: '杭州天气' });
        assert.equal(requests[4].messages.length, 2);
        assert.equal(requests[4].messages[1].content, '杭州天气');
        await assert.rejects(tools.ask_file_agent.execute({}), /task/);
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
            createSubAgentTools(model, {}, controller.signal).ask_weather_agent.execute({
                task: '北京',
            }),
            /abort/i,
        );
        assert.equal(requests.length, 5);
        await assert.rejects(tools.ask_weather_agent.execute({ task: 'failure' }), /503/);
        const running = new AbortController();
        const pending = createSubAgentTools(model, {}, running.signal).ask_file_agent.execute({
            task: 'hang',
        });
        const rejected = assert.rejects(pending, /abort/i);
        await started;
        running.abort();
        await rejected;
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
