import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPath } from '../config/paths.ts';

// internal 消息保留给模型上下文，但不作为聊天气泡展示。
export type Message = { id?: string; role: string; content: string; internal?: boolean };

// 每个会话保存一份消息列表；默认数据库位于项目的 .data 目录。
export function openChatStore(path = fileURLToPath(projectPath('.data/chat.sqlite'))) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        messages TEXT NOT NULL
    )`);
    // 兼容旧数据库：已有表缺少更新时间时补列，保留原会话数据。
    if (
        !(db.prepare('PRAGMA table_info(sessions)').all() as any[]).some(
            (column) => column.name === 'updated',
        )
    ) {
        db.exec('ALTER TABLE sessions ADD COLUMN updated INTEGER NOT NULL DEFAULT 0');
    }
    // 移除已废弃的控制状态列，历史消息与更新时间保持不变。
    if (
        (db.prepare('PRAGMA table_info(sessions)').all() as any[]).some(
            (column) => column.name === 'state',
        )
    ) {
        db.exec('ALTER TABLE sessions DROP COLUMN state');
    }

    const read = db.prepare('SELECT messages FROM sessions WHERE id = ?');
    // 每个会话保存完整消息数组；同一 id 再次保存时覆盖并更新排序时间。
    const write = db.prepare(`INSERT INTO sessions (id, messages, updated) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET messages = excluded.messages, updated = excluded.updated`);
    const remove = db.prepare('DELETE FROM sessions WHERE id = ?');
    const load = (id: string): Message[] => {
        const row = read.get(id);
        if (!row) return [];
        const messages: Message[] = JSON.parse(row.messages as string);
        // 给旧消息补稳定 ID，删除其他消息后定位也不会发生偏移。
        if (messages.some((message) => !message.id)) {
            for (const message of messages) message.id ||= crypto.randomUUID();
            db.prepare('UPDATE sessions SET messages = ? WHERE id = ?').run(
                JSON.stringify(messages),
                id,
            );
        }
        return messages;
    };
    const save = (id: string, messages: Message[]) => {
        for (const message of messages) message.id ||= crypto.randomUUID();
        write.run(id, JSON.stringify(messages), Date.now());
    };

    return {
        list() {
            // 面向页面的列表过滤工具中间消息；load() 则返回完整上下文。
            return db
                .prepare('SELECT id, messages, updated FROM sessions ORDER BY updated DESC')
                .all()
                .map((row) => {
                    const messages = load(row.id as string).filter((message) => !message.internal);
                    return {
                        id: row.id,
                        title:
                            messages
                                .find((message) => message.role === 'user')
                                ?.content.slice(0, 26) || '新的对话',
                        messages,
                        updated: row.updated,
                    };
                });
        },
        load,
        save,
        deleteMessage(id: string, messageId: string) {
            const messages = load(id);
            const index = messages.findIndex(
                (message) => message.id === messageId && !message.internal,
            );
            if (index < 0) return false;
            let start = index,
                end = index + 1;
            if (messages[index].role === 'user') {
                // 删除提问时一并移除该轮回复和工具记录，避免留下无来源的上下文。
                while (
                    end < messages.length &&
                    (messages[end].internal || messages[end].role !== 'user')
                )
                    end++;
            } else {
                // 删除回复时，同时删除产生该回复的隐藏工具调用与结果。
                while (start > 0 && messages[start - 1].internal) start--;
            }
            messages.splice(start, end - start);
            save(id, messages);
            return true;
        },
        clear(id: string) {
            remove.run(id);
        },
        close() {
            db.close();
        },
    };
}
