import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 256 * 1024;

export function sendJson(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

export async function readJson(req: IncomingMessage) {
    if (!req.headers['content-type']?.startsWith('application/json')) {
        throw new Error('请使用 application/json');
    }
    let text = '';
    for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error('请求过大');
    }
    return JSON.parse(text);
}

export function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
