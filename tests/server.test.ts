import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createApp } from '../src/server.ts';
import { openChatStore } from '../src/storage/sqlite.ts';

test('后台流式对话、工具循环、会话持久化、模型密钥与错误处理', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-api-'));
    const requests: any[] = [];
    const reviewRequests: any[] = [];
    let markCancelled: () => void;
    const modelCancelled = new Promise<void>((resolve) => {
        markCancelled = resolve;
    });
    let markModelStarted: () => void;
    const modelStarted = new Promise<void>((resolve) => {
        markModelStarted = resolve;
    });
    const mock = createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        if (data.messages[0]?.content.includes('你正在执行单次答案复查')) {
            reviewRequests.push(data);
            const draft = JSON.parse(data.messages.at(-1).content).draft;
            res.end(
                `data: ${JSON.stringify({ choices: [{ delta: { content: draft } }] })}\n\ndata: [DONE]\n\n`,
            );
            return;
        }
        requests.push(data);
        if (data.messages.at(-1).content === 'wait-cancel') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write(
                `data: ${JSON.stringify({ choices: [{ delta: { content: '部分输出' } }] })}\n\n`,
            );
            res.once('close', () => markCancelled());
            markModelStarted();
            return;
        }
        if (data.messages.at(-1).content === 'missing-file') {
            res.end(
                `data: ${JSON.stringify({ choices: [{ delta: { content: '<tool_call name="read_file"><params><path>__missing_agent_test_file__.txt</path></params></tool_call>' } }] })}\n\ndata: [DONE]\n\n`,
            );
            return;
        }
        if (data.messages.at(-1).content === 'broken-stream') {
            res.end(
                `data: ${JSON.stringify({ choices: [{ delta: { content: '部分回答' } }] })}\n\ndata: invalid-json\n\n`,
            );
            return;
        }
        if (data.messages.some((message: any) => message.content === 'fail')) {
            res.writeHead(500);
            res.end();
            return;
        }
        const tool = data.messages.some((message: any) => message.internal);
        assert.equal(tool, false);
        const first = data.messages.at(-1).content === 'read';
        const text = first
            ? '<tool_call name="read_file"><params><path>package.json</path></params></tool_call>'
            : '你好，工具执行完成';
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const part of [text.slice(0, 2), text.slice(2)])
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
    });
    mock.listen(0, '127.0.0.1');
    await once(mock, 'listening');
    const model = {
        id: 'local',
        name: 'test',
        model: 'test',
        url: `http://127.0.0.1:${(mock.address() as any).port}`,
        key: 'test-secret',
    };
    const configPath = pathToFileURL(join(directory, 'models.json'));
    const app = createApp({
        models: [model],
        store: openChatStore(join(directory, 'chat.sqlite')),
        configPath,
    });
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    const base = `http://127.0.0.1:${(app.address() as any).port}`;
    const post = (path: string, data: unknown) =>
        fetch(base + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    try {
        assert.equal((await fetch(base)).status, 200);
        const toolList = await (await fetch(base + '/api/tools')).json();
        assert.ok(
            toolList.some((tool: any) => tool.name === 'read_file' && tool.readOnly === true),
        );
        assert.ok(
            toolList.every(
                (tool: any) => typeof tool.description === 'string' && !('execute' in tool),
            ),
        );
        for (const path of ['/chat-render.js', '/vendor/marked.js', '/vendor/purify.js']) {
            const asset = await fetch(base + path);
            assert.equal(asset.status, 200);
            assert.match(asset.headers.get('content-type')!, /javascript/);
        }
        assert.equal((await fetch(base + '/.env')).status, 404);
        assert.equal(
            (await fetch(base + '/api/models', { headers: { Origin: 'http://evil.example' } }))
                .status,
            403,
        );
        assert.equal((await fetch(base + '/api/models')).status, 200);
        const presets = await (await fetch(base + '/api/prompts')).json();
        assert.equal(presets.activeId, 'tools');
        assert.equal((await post('/api/prompts/active', { id: 'library' })).status, 200);
        await (
            await post('/api/chat', {
                sessionId: 'prompt-check',
                text: '你好',
                modelId: 'local',
            })
        ).text();
        assert.match(requests.at(-1).messages[0].content, /图书管理助手/);
        requests.length = 0;
        await fetch(base + '/api/sessions/prompt-check', { method: 'DELETE' });
        const savedPrompt = await (
            await post('/api/prompts', { name: '新助手', content: '新规则' })
        ).json();
        assert.ok(savedPrompt.prompts.some((p: any) => p.content === '新规则'));
        assert.equal((await post('/api/prompts/active', { id: 'missing' })).status, 400);
        assert.equal((await post('/api/prompts', { name: '', content: '' })).status, 400);
        await post('/api/prompts/active', { id: 'tools' });
        assert.equal(
            (await (await fetch(base + '/api/models')).text()).includes('test-secret'),
            false,
        );
        const response = await post('/api/chat', {
            sessionId: 'one',
            text: 'read',
            modelId: 'local',
            prompt: 'custom',
        });
        const events = (await response.text())
            .trim()
            .split('\n\n')
            .map((frame) => JSON.parse(frame.slice(6)));
        assert.equal(events.filter((event) => event.type === 'tool').length, 2);
        assert.equal(
            events
                .filter((event) => event.type === 'delta')
                .map((event) => event.text)
                .join(''),
            '你好，工具执行完成',
        );
        assert.equal(events.at(-1).type, 'done');
        assert.ok(events.some((event) => event.type === 'review' && event.status === 'running'));
        assert.ok(reviewRequests.length > 0);
        assert.match(requests[0].messages[0].content, /^custom/);
        const sessions = await (await fetch(base + '/api/sessions')).json();
        assert.equal(sessions[0].messages.length, 2);
        assert.ok(sessions[0].updated > 0);
        const persisted = openChatStore(join(directory, 'chat.sqlite'));
        assert.equal(persisted.load('one').length, 4);
        persisted.close();
        const assistantId = sessions[0].messages[1].id;
        const messageUrl = base + `/api/sessions/one/messages/${assistantId}`;
        assert.equal((await fetch(messageUrl, { method: 'DELETE' })).status, 200);
        assert.equal((await fetch(messageUrl, { method: 'DELETE' })).status, 404);
        const reopened = openChatStore(join(directory, 'chat.sqlite'));
        assert.equal(reopened.load('one').length, 1);
        reopened.close();
        await (
            await post('/api/chat', { sessionId: 'one', text: '继续', modelId: 'local' })
        ).text();
        assert.deepEqual(
            requests
                .at(-1)
                .messages.slice(1)
                .map((message: any) => message.content),
            ['read', '继续'],
        );
        assert.equal(
            (
                await fetch(base + `/api/sessions/one/messages/${sessions[0].messages[0].id}`, {
                    method: 'DELETE',
                })
            ).status,
            200,
        );
        assert.deepEqual(
            (await (await fetch(base + '/api/sessions/one')).json()).map(
                (message: any) => message.content,
            ),
            ['继续', '你好，工具执行完成'],
        );
        const error = await post('/api/chat', {
            sessionId: 'failed',
            text: 'fail',
            modelId: 'local',
        });
        assert.match(await error.text(), /"type":"error"/);
        assert.deepEqual(await (await fetch(base + '/api/sessions/failed')).json(), []);
        for (const text of ['missing-file', 'broken-stream']) {
            const before = requests.length;
            const result = await (
                await post('/api/chat', {
                    sessionId: text,
                    text,
                    modelId: 'local',
                })
            ).text();
            assert.doesNotMatch(result, /"type":"tool"[^\n]*"status":"done"/);
            if (text === 'missing-file') {
                assert.match(result, /"status":"error"/);
                assert.match(result, /ENOENT/);
                assert.match(result, /"type":"done"/);
                assert.doesNotMatch(result, /"type":"error"/);
                assert.equal(requests.length, before + 2, '工具失败交回模型继续处理');
                assert.match(requests.at(-1).messages.at(-1).content, /ENOENT/);
                assert.ok((await (await fetch(base + '/api/sessions/' + text)).json()).length);
                await fetch(base + '/api/sessions/' + text, { method: 'DELETE' });
            } else {
                assert.match(result, /"type":"error"/);
                assert.doesNotMatch(result, /"type":"done"/);
                assert.equal(requests.length, before + 1);
                assert.deepEqual(await (await fetch(base + '/api/sessions/' + text)).json(), []);
            }
        }
        assert.equal((await post('/api/chat', { text: 'hi' })).status, 400);
        const cancellation = new AbortController();
        const pending = await fetch(base + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: 'cancelled', text: 'wait-cancel', modelId: 'local' }),
            signal: cancellation.signal,
        });
        const pendingReader = pending.body!.getReader();
        // 初稿现在不会发给前端，等待模型开始生成后直接取消。
        await pendingReader.read();
        await modelStarted;
        cancellation.abort();
        await Promise.race([
            modelCancelled,
            new Promise((_, reject) => {
                const timeout = setTimeout(() => reject(new Error('取消未传递给模型')), 3000);
                timeout.unref();
            }),
        ]);
        pendingReader.releaseLock();
        assert.deepEqual(await (await fetch(base + '/api/sessions/cancelled')).json(), []);
        const models = await (
            await post('/api/models', {
                id: 'local',
                name: 'updated',
                model: 'test',
                url: model.url,
            })
        ).json();
        assert.equal(models[0].hasKey, true);
        assert.equal(JSON.stringify(models).includes('test-secret'), false);
        assert.equal((await fetch(base + '/api/sessions/one', { method: 'DELETE' })).status, 200);
        assert.deepEqual(await (await fetch(base + '/api/sessions')).json(), []);
        const configured = await (
            await post('/api/models', {
                name: '本地 9B',
                model: 'local-qwen-9b:q4',
                url: model.url,
            })
        ).json();
        const large = configured.find((item: any) => item.name === '本地 9B');
        const routed = await (
            await post('/api/chat', {
                sessionId: 'auto',
                text: '实现算法',
                autoRoute: true,
            })
        ).text();
        assert.match(routed, /"type":"route"/);
        assert.ok(routed.includes(large.id));
        assert.equal(requests.at(-1).model, 'local-qwen-9b:q4');
        await (
            await post('/api/chat', {
                sessionId: 'manual',
                text: '实现算法',
                autoRoute: false,
                modelId: 'local',
            })
        ).text();
        assert.equal(requests.at(-1).model, 'test');
        assert.equal(
            (
                await post('/api/chat', {
                    sessionId: 'bad',
                    text: '你好',
                    autoRoute: 'true',
                })
            ).status,
            400,
        );
    } finally {
        await Promise.all([
            new Promise<void>((resolve) => app.close(() => resolve())),
            new Promise<void>((resolve) => mock.close(() => resolve())),
        ]);
        rmSync(directory, { recursive: true, force: true });
    }
});
