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
    let chatRequest: any;
    let chatSignal: AbortSignal;
    let prompts = {
        activeId: 'tools',
        prompts: [
            { id: 'tools', name: '工具助手', content: '工具提示词' },
            { id: 'library', name: '图书管理助手', content: '图书提示词' },
        ],
    };
    win.TextDecoder = TextDecoder;
    win.fetch = async (path: string, options: any) => {
        if (path === '/api/prompts/active') {
            prompts.activeId = JSON.parse(options.body).id;
            return Response.json(prompts);
        }
        if (path === '/api/prompts') {
            if (options?.method === 'POST') {
                const data = JSON.parse(options.body);
                const existing = prompts.prompts.find((p) => p.id === data.id);
                if (existing) Object.assign(existing, data);
                else {
                    data.id = 'custom';
                    prompts.prompts.push(data);
                }
                prompts.activeId = data.id;
            }
            return Response.json(prompts);
        }
        if (path === '/api/tools')
            return Response.json([
                { name: 'read_file', description: '读取文本文件', readOnly: true },
                { name: 'write_file', description: '写入文本文件', readOnly: false },
            ]);
        if (path === '/api/models')
            return Response.json([{ id: 'local', name: 'test', model: 'test' }]);
        if (path === '/api/sessions') return Response.json(sessions);
        if (path === '/api/chat') {
            chatRequest = JSON.parse(options.body);
            chatSignal = options.signal;
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
        const profile = win.document.querySelector('#chat-prompt') as HTMLSelectElement;
        assert.equal(profile.value, 'tools');
        profile.value = 'library';
        profile.dispatchEvent(new win.Event('change'));
        await tick();
        await tick();
        assert.equal(prompts.activeId, 'library');
        assert.match(win.document.querySelector('#prompt-preview')!.textContent!, /图书提示词/);
        (win.document.querySelector('#prompt-editor') as HTMLTextAreaElement).value =
            '修改后的图书规则';
        (win.document.querySelector('#save-prompt') as HTMLButtonElement).click();
        await tick();
        await tick();
        assert.equal(prompts.prompts[1].content, '修改后的图书规则');
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
        const toggle = win.document.querySelector('#auto-route') as HTMLInputElement;
        const modelSelect = win.document.querySelector('#chat-model') as HTMLSelectElement;
        assert.equal(toggle.checked, false);
        assert.equal(modelSelect.disabled, false);
        toggle.checked = true;
        toggle.dispatchEvent(new win.Event('change'));
        assert.equal(modelSelect.disabled, true);
        const input = win.document.querySelector('#chat-input') as HTMLTextAreaElement;
        input.value = '**用户输入保持原文**';
        form.dispatchEvent(new win.Event('submit', { cancelable: true }));
        assert.equal(win.document.querySelectorAll('.loading-dots i').length, 3);
        assert.equal(win.document.querySelector('.message.user strong'), null);
        await tick();
        assert.equal(chatRequest.autoRoute, true);
        assert.equal(chatRequest.prompt, undefined, '提示词由后端 SQLite 解析');
        const send = (event: unknown) =>
            stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        send({ type: 'route', modelName: '本地 9B', reason: '复杂任务' });
        await tick();
        assert.match(win.document.querySelector('#route-result')!.textContent!, /本地 9B/);
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
        // 工具错误立即展示，但保持等待，让模型决定下一步。
        input.value = '工具失败测试';
        form.dispatchEvent(new win.Event('submit', { cancelable: true }));
        await tick();
        send({ type: 'tool', name: 'read_file', status: 'running' });
        send({ type: 'tool', name: 'read_file', status: 'error', error: 'ENOENT' });
        await tick();
        assert.match(win.document.querySelector('#tool-errors')!.textContent!, /ENOENT/);
        assert.match(
            win.document.querySelector('.reply-loading')!.textContent!,
            /模型正在决定下一步/,
        );
        assert.equal(
            (win.document.querySelector('.send-button') as HTMLButtonElement).disabled,
            true,
        );
        send({ type: 'tool', name: 'read_file', status: 'running' });
        await tick();
        assert.match(
            win.document.querySelector('.reply-loading')!.textContent!,
            /正在调用 read_file/,
        );
        send({ type: 'done' });
        // 不关闭流，验证 done 本身即可结束页面等待。
        await tick();
        await tick();
        assert.equal(win.document.querySelector('.reply-loading'), null);
        assert.equal(
            (win.document.querySelector('.send-button') as HTMLButtonElement).disabled,
            false,
        );
        (win.document.querySelector('#new-chat') as HTMLButtonElement).click();
        const stopButton = win.document.querySelector('#stop-generation') as HTMLButtonElement;
        assert.equal(stopButton.hidden, true);
        input.value = '停止测试';
        form.dispatchEvent(new win.Event('submit', { cancelable: true }));
        await tick();
        assert.equal(stopButton.hidden, false);
        send({ type: 'delta', text: '部分回复' });
        await tick();
        stopButton.click();
        await tick();
        await tick();
        assert.equal(chatSignal.aborted, true);
        assert.equal(stopButton.hidden, true);
        assert.equal(win.document.querySelector('.reply-loading'), null);
        assert.match(
            win.document.querySelector('#messages')!.textContent!,
            /部分回复.*已停止生成/s,
        );
        assert.equal(
            (win.document.querySelector('.send-button') as HTMLButtonElement).disabled,
            false,
        );
        (win.document.querySelector('#new-chat') as HTMLButtonElement).click();
        fail = true;
        toggle.checked = false;
        toggle.dispatchEvent(new win.Event('change'));
        assert.equal(modelSelect.disabled, false);
        input.value = '错误测试';
        form.dispatchEvent(new win.Event('submit', { cancelable: true }));
        await tick();
        await tick();
        assert.equal(chatRequest.autoRoute, false);
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
