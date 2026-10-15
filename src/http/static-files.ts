import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { projectPath } from '../config/paths.ts';

// 固定白名单：不接受用户路径拼接，避免访问配置和数据库文件。
const files: Record<string, [string, string]> = {
    '/': ['admin/index.html', 'text/html'],
    '/index.html': ['admin/index.html', 'text/html'],
    '/app.js': ['admin/app.js', 'text/javascript'],
    '/chat-render.js': ['admin/chat-render.js', 'text/javascript'],
    '/style.css': ['admin/style.css', 'text/css'],
    '/vendor/marked.js': ['node_modules/marked/lib/marked.umd.js', 'text/javascript'],
    '/vendor/purify.js': ['node_modules/dompurify/dist/purify.min.js', 'text/javascript'],
};

export function serveStatic(pathname: string, res: ServerResponse) {
    const file = files[pathname];
    if (!file) return false;
    const [path, contentType] = file;
    res.writeHead(200, {
        'Content-Type': `${contentType}; charset=utf-8`,
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(readFileSync(projectPath(path)));
    return true;
}
