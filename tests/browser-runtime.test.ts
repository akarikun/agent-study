import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

execFileSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-static.mjs', import.meta.url)),
]);

function setup(
    network: typeof fetch = async () => {
        throw new Error('演示不应联网');
    },
    cached?: string,
) {
    const dom = new JSDOM(readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8'), {
        url: 'https://agent.example.test/project/',
        runScripts: 'outside-only',
    });
    const win = dom.window;
    Object.assign(win, {
        fetch: network,
        structuredClone,
        Response,
        ReadableStream,
        TextEncoder,
        TextDecoder,
        AbortController,
        AbortSignal,
    });
    if (cached) win.localStorage.setItem('agent-browser-data-v1', cached);
    for (const file of ['runtime-config.js', 'browser-runtime.js'])
        win.eval(readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8'));
    const api = async (path: string, body?: any, method?: string) => {
        const response = await win.AgentBrowserRuntime.fetch(
            path,
            body !== undefined
                ? {
                      method: method || 'POST',
                      body: JSON.stringify(body),
                  }
                : undefined,
        );
        return response.json();
    };
    const events = async (body: any, signal?: AbortSignal) => {
        const response = await win.AgentBrowserRuntime.fetch('/api/chat', {
            method: 'POST',
            body: JSON.stringify(body),
            signal,
        });
        return (await response.text())
            .trim()
            .split('\n\n')
            .map((frame: string) => JSON.parse(frame.slice(6)));
    };
    return { dom, win, api, events };
}

test('静态演示无需后端或外网，支持工具循环、持久化和提示词切换', async () => {
    const env = setup();
    try {
        const models = await env.api('/api/models');
        assert.equal((await env.api('/api/runtime')).mode, 'demo');
        await env.api('/api/prompts/active', { id: 'library' });
        const frames = await env.events({
            sessionId: 'demo',
            text: '北京今天的天气',
            modelId: models[0].id,
        });
        assert.ok(frames.some((e: any) => e.type === 'tool' && e.name === 'get_weather'));
        assert.ok(frames.some((e: any) => e.text?.includes('虚构')));
        assert.equal(frames.at(-1).type, 'done');
        const sessions = await env.api('/api/sessions');
        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].messages.length, 2);
        const cached = env.win.localStorage.getItem('agent-browser-data-v1')!;
        const restored = setup(undefined, cached);
        try {
            assert.equal((await restored.api('/api/prompts')).activeId, 'library');
            const restoredSessions = await restored.api('/api/sessions');
            assert.equal(restoredSessions.length, 1);
            await restored.api(
                `/api/sessions/demo/messages/${restoredSessions[0].messages[0].id}`,
                {},
                'DELETE',
            );
            assert.equal((await restored.api('/api/sessions'))[0].messages.length, 0);
        } finally {
            restored.dom.window.close();
        }
    } finally {
        env.dom.window.close();
    }
});

test('浏览器直连兼容流式 API 和 XML 工具循环，Key 不进入持久化缓存', async () => {
    const calls: any[] = [];
    const network = (async (url: string, options: any) => {
        calls.push({ url, options, payload: JSON.parse(options.body) });
        const content =
            calls.length === 1
                ? '<tool_call name="read_file"><params><path>missing.txt</path></params></tool_call>'
                : '文件不存在，请确认文件名称。';
        const bytes = new TextEncoder().encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\ndata: [DONE]\r\n\r\n`,
        );
        return new Response(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(bytes.slice(0, 17));
                    controller.enqueue(bytes.slice(17));
                    controller.close();
                },
            }),
        );
    }) as typeof fetch;
    const env = setup(network);
    try {
        const models = await env.api('/api/models', {
            name: '我的模型',
            model: 'test',
            url: 'https://models.example.test/v1/chat/completions',
            key: 'test-only-key',
        });
        const selected = models.at(-1);
        await env.api('/api/runtime', { mode: 'direct' });
        const frames = await env.events({
            sessionId: 'direct',
            text: '读取 missing.txt',
            modelId: selected.id,
        });
        assert.equal(calls.length, 2);
        assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only-key');
        assert.equal(calls[0].options.credentials, 'omit');
        assert.match(calls[1].payload.messages.at(-1).content, /虚拟文件不存在/);
        assert.ok(frames.some((e: any) => e.type === 'tool' && e.status === 'error'));
        assert.equal(frames.at(-1).type, 'done');
        const cache = env.win.localStorage.getItem('agent-browser-data-v1')!;
        assert.equal(cache.includes('test-only-key'), false);
        assert.equal(JSON.stringify(await env.api('/api/models')).includes('test-only-key'), false);
        const reloaded = setup(network, cache);
        try {
            assert.equal((await reloaded.api('/api/models')).at(-1).hasKey, false);
        } finally {
            reloaded.dom.window.close();
        }
        const invalid = await env.api('/api/models', {
            name: 'bad',
            model: 'test',
            url: 'http://public.example/v1/chat/completions',
        });
        assert.match(invalid.error, /HTTPS/);
    } finally {
        env.dom.window.close();
    }
});

test('浏览器直连取消和网络失败不保存未完成会话，不偷偷回退模拟回复', async () => {
    let signal: AbortSignal;
    let started: () => void;
    const requested = new Promise<void>((resolve) => {
        started = resolve;
    });
    const env = setup((async (_url: any, options: any) => {
        signal = options.signal;
        started();
        return new Response(
            new ReadableStream({
                start(controller) {
                    options.signal.addEventListener(
                        'abort',
                        () => controller.error(new Error('aborted')),
                        { once: true },
                    );
                },
            }),
        );
    }) as typeof fetch);
    try {
        await env.api('/api/runtime', { mode: 'direct' });
        const controller = new AbortController();
        const running = env.events(
            { sessionId: 'cancel', text: '你好', modelId: 'browser-local' },
            controller.signal,
        );
        await requested;
        controller.abort();
        await running;
        assert.equal(signal!.aborted, true);
        assert.equal((await env.api('/api/sessions')).length, 0);
    } finally {
        env.dom.window.close();
    }
    const offline = setup((async () => {
        throw new Error('network blocked');
    }) as typeof fetch);
    try {
        await offline.api('/api/runtime', { mode: 'direct' });
        const frames = await offline.events({
            sessionId: 'fail',
            text: '你好',
            modelId: 'browser-local',
        });
        assert.equal(frames.at(-1).type, 'error');
        assert.match(frames.at(-1).message, /CORS/);
        assert.equal((await offline.api('/api/sessions')).length, 0);
    } finally {
        offline.dom.window.close();
    }
});

test('静态页面在子路径下初始化，展示运行模式和浏览器存储说明', async () => {
    const env = setup();
    try {
        for (const file of ['vendor/marked.js', 'vendor/purify.js', 'chat-render.js', 'app.js'])
            env.win.eval(readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8'));
        for (
            let index = 0;
            index < 40 &&
            !env.win.document.querySelector('.preview-tag')!.textContent!.includes('演示模式');
            index++
        )
            await new Promise((resolve) => setImmediate(resolve));
        assert.equal(
            (env.win.document.querySelector('#runtime-controls') as HTMLElement).hidden,
            false,
        );
        assert.match(
            env.win.document.querySelector('#model-storage-note')!.textContent!,
            /当前浏览器/,
        );
        assert.equal(env.win.document.querySelectorAll('#tool-list details').length, 4);
        assert.equal(env.win.document.querySelectorAll('#chat-prompt option').length, 2);
        const mode = env.win.document.querySelector('#runtime-mode') as HTMLSelectElement;
        mode.value = 'direct';
        mode.dispatchEvent(new env.win.Event('change'));
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        assert.match(
            env.win.document.querySelector('#runtime-target-model')!.textContent!,
            /本机 Ollama/,
        );
        assert.equal(
            env.win.document.querySelector('#runtime-target-url')!.textContent,
            'http://localhost:11434/v1/chat/completions',
        );
        const automatic = env.win.document.querySelector('#auto-route') as HTMLInputElement;
        automatic.checked = true;
        automatic.dispatchEvent(new env.win.Event('change'));
        assert.match(
            env.win.document.querySelector('#runtime-target-model')!.textContent!,
            /发送后显示/,
        );
        assert.equal(env.win.document.querySelector('#runtime-target-url')!.textContent, '');
    } finally {
        env.dom.window.close();
    }
});
