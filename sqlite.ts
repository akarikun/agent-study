import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Message = { role: string; content: string };

// 每个会话保存一份消息列表；默认数据库位于项目的 .data 目录。
export function openChatStore(path = fileURLToPath(new URL('./.data/chat.sqlite', import.meta.url))) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        messages TEXT NOT NULL
    )`);

    const read = db.prepare('SELECT messages FROM sessions WHERE id = ?');
    const write = db.prepare(`INSERT INTO sessions (id, messages) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET messages = excluded.messages`);
    const remove = db.prepare('DELETE FROM sessions WHERE id = ?');

    return {
        load(id: string): Message[] {
            const row = read.get(id);
            return row ? JSON.parse(row.messages as string) : [];
        },
        save(id: string, messages: Message[]) {
            // 参数绑定避免把消息内容直接拼接进 SQL。
            write.run(id, JSON.stringify(messages));
        },
        clear(id: string) {
            remove.run(id);
        },
        close() {
            db.close();
        },
    };
}
