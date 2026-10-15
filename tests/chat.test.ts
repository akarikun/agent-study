import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('聊天 Markdown 安全渲染，首段回复前加载，流式输出和失败后停止加载', async () => {
    const dom = new JSDOM(readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8'), {
        url: 'http://localhost:3000',
        runScripts: 'outside-only',
    });
    const win = dom.window;
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    let sessions: unknown[] = [];
    let stream: ReadableStreamDefaultController;
    let fail = false;
    win.TextDecoder = TextDecoder;
    win.fetch = async (path: string) => {
        if (path === '/api/tools')
            return Response.json([
                { name: 'read_file', description: '读取文本文件', readOnly: true },
                { name: 'write_file', description: '写入文本文件', readOnly: false },
            ]);
        if (path === '/api/models')
            return Response.json([{ id: 'local', name: 'test', model: 'test' }]);
        if (path === '/api/sessions') return Response.json(sessions);
        if (path === '/api/chat') {
            if (fail) return Response.json({ error: '模型离线' }, { status: 500 });
            return new Response(
                new ReadableStream({
                    start(controller) {
                        stream = controller;
                    },
                }),
            );
        }
        throw new Error(`Unexpected request: ${path}`);
    };
    try {
        for (const path of [
            '../node_modules/marked/lib/marked.umd.js',
            '../node_modules/dompurify/dist/purify.min.js',
            '../admin/chat-render.js',
            '../admin/app.js',
        ]) {
            win.eval(readFileSync(new URL(path, import.meta.url), 'utf8'));
        }
        for (
            let i = 0;
            i < 20 && win.document.querySelector('.preview-tag')?.textContent !== 'Agent 已连接';
            i++
        )
            await tick();
        assert.equal(win.document.querySelectorAll('#tool-list details').length, 2);
        assert.match(win.document.querySelector('#tool-list')!.textContent!, /write_file/);
        const sample =
            '# 标题\n\n**粗体** 和 `code`\n\n- 第一项\n- 第二项\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[危险](javascript:alert(1))<img src=x onerror="alert(1)"><script>alert(1)</script>';
        const rendered = win.renderMarkdown(sample);
        assert.equal(rendered.querySelector('strong')?.textContent, '粗体');
        assert.equal(rendered.querySelectorAll('li').length, 2);
        assert.ok(rendered.querySelector('pre code'));
        assert.ok(rendered.querySelector('table'));
        assert.equal(rendered.querySelector('script, [onerror], a[href^="javascript:"]'), null);
        const form = win.document.querySelector('#chat-form')!;
        const input = win.document.querySelector('#chat-input') as HTMLTextAreaElement;
        input.value = '**用户输入保持原文**';
        form.dispatchEvent(new win.Event('submit', { cancelable: true }));
        assert.equal(win.document.querySelectorAll('.loading-dots i').length, 3);
        assert.equal(win.document.querySelector('.message.user strong'), null);
        await tick();
        const send = (event: unknown) =>
            stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        send({ type: 'tool', name: 'read_file', status: 'running' });
        await tick();
        assert.match(win.document.querySelector('.reply-loading')!.textContent!, /read_file/);
        send({ type: 'delta', text: '**回复**' });
        await tick();
        assert.equal(win.document.querySelector('.reply-loading'), null);
        assert.equal(win.document.querySelector('.message.assistant strong')?.textContent, '回复');
        sessions = [{ id: 'saved', title: '测试', messages: [], updated: 1 }];
        send({ type: 'done' });
        stream.close();
        await tick();
        await tick();
        assert.equal(
            (win.document.querySelector('.send-button') as HTMLButtonElement).disabled,
            false,
        );
        fail = true;
        input.value = '错误测试';
        form.dispatchEvent(new win.Event('submit', { cancelable: true }));
        await tick();
        await tick();
        assert.equal(win.document.querySelector('.reply-loading'), null);
        assert.match(win.document.querySelector('#messages')!.textContent!, /模型离线/);
        assert.equal(
            (win.document.querySelector('.send-button') as HTMLButtonElement).disabled,
            false,
        );
        // 失败轮次只存在页面内，取消不删除，确认后移除对应气泡。
        win.confirm = () => false;
        (
            win.document.querySelector('.message.assistant .message-delete') as HTMLButtonElement
        ).click();
        assert.ok(win.document.querySelector('.message.assistant'));
        win.confirm = () => true;
        (
            win.document.querySelector('.message.assistant .message-delete') as HTMLButtonElement
        ).click();
        await tick();
        assert.equal(win.document.querySelector('.message.assistant'), null);
    } finally {
        win.close();
    }
});
