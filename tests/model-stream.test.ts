import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { streamModelResponse } from '../src/agent/model-stream.ts';

async function withServer(
    reply: (res: ServerResponse) => void,
    work: (model: any) => Promise<void>,
) {
    const server = createServer(async (req, res) => {
        for await (const _part of req) {
            /* 完整消费请求体。 */
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.flushHeaders();
        reply(res);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        await work({
            id: 'test',
            name: 'test',
            model: 'test',
            url: `http://127.0.0.1:${(server.address() as any).port}`,
        });
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

test('只收到 finish_reason、没有 DONE 且连接不关闭时也结束请求', async () => {
    await withServer(
        (res) => {
            const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: '最终答案' }, finish_reason: 'stop' }] })}\r\n\r\n`;
            const bytes = Buffer.from(frame);
            res.write(bytes.subarray(0, 17));
            res.write(bytes.subarray(17));
            // 故意不 res.end()，复现兼容接口一直保持连接的情况。
        },
        async (model) => {
            let output = '';
            for await (const text of streamModelResponse(model, [], undefined, { timeoutMs: 1000 }))
                output += text;
            assert.equal(output, '最终答案');
        },
    );
});

test('无数据触发空闲超时，持续心跳也不能绕过总时限', async () => {
    await withServer(
        () => {},
        async (model) => {
            await assert.rejects(async () => {
                for await (const _text of streamModelResponse(model, [], undefined, {
                    timeoutMs: 1000,
                    idleTimeoutMs: 60,
                })) {
                }
            }, /未返回数据/);
        },
    );
    await withServer(
        (res) => {
            res.write(': heartbeat\n\n');
            const timer = setInterval(() => res.write(': heartbeat\n\n'), 10);
            res.once('close', () => clearInterval(timer));
        },
        async (model) => {
            await assert.rejects(async () => {
                for await (const _text of streamModelResponse(model, [], undefined, {
                    timeoutMs: 120,
                    idleTimeoutMs: 1000,
                })) {
                }
            }, /请求超时/);
        },
    );
});

test('流提前断开或因 token 上限截断时明确报错，不当成完整成功', async () => {
    for (const finish_reason of [undefined, 'length']) {
        await withServer(
            (res) =>
                res.end(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: '部分回答' }, finish_reason }] })}\n\n`,
                ),
            async (model) => {
                await assert.rejects(async () => {
                    for await (const _text of streamModelResponse(model, [])) {
                    }
                }, /提前结束|长度上限/);
            },
        );
    }
});
