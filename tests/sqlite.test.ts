import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openChatStore } from '../src/storage/sqlite.ts';
import { DatabaseSync } from 'node:sqlite';

test('删除提问清理整轮、删除回复清理工具上下文，其他轮次保持不变', () => {
    const store = openChatStore(':memory:');
    try {
        store.save('s', [
            { role: 'user', content: '第一问' },
            { role: 'assistant', content: '调用', internal: true },
            { role: 'user', content: '结果', internal: true },
            { role: 'assistant', content: '第一答' },
            { role: 'user', content: '第二问' },
            { role: 'assistant', content: '第二答' },
        ]);
        let messages = store.load('s');
        const secondId = messages[4].id!;
        assert.equal(store.deleteMessage('s', messages[3].id!), true);
        assert.deepEqual(
            store.load('s').map((message) => message.content),
            ['第一问', '第二问', '第二答'],
        );
        assert.equal(store.deleteMessage('s', secondId), true);
        assert.deepEqual(
            store.load('s').map((message) => message.content),
            ['第一问'],
        );
        assert.equal(store.deleteMessage('s', 'missing'), false);
    } finally {
        store.close();
    }
});

test('会话持久化、覆盖更新、隔离和清空', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chat-sqlite-'));
    const path = join(directory, 'nested', 'chat.sqlite');
    let store = openChatStore(path);
    try {
        assert.deepEqual(store.load('new'), []);
        const messages = [{ role: 'user', content: "你好，it's SQLite" }];
        store.save("session'1", messages);
        store.save('other', [{ role: 'user', content: '另一会话' }]);
        messages.push({ role: 'assistant', content: '你好！' });
        store.save("session'1", messages);
        store.close();
        store = openChatStore(path);
        assert.deepEqual(store.load("session'1"), messages);
        store.clear("session'1");
        assert.deepEqual(store.load("session'1"), []);
        assert.equal(store.load('other')[0].content, '另一会话');
    } finally {
        store.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test('旧数据库废弃状态列移除后保留历史并可继续保存', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chat-migration-'));
    const path = join(directory, 'old.sqlite');
    const old = new DatabaseSync(path);
    old.exec(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, messages TEXT NOT NULL, state TEXT NOT NULL DEFAULT '{}')",
    );
    old.prepare('INSERT INTO sessions (id, messages) VALUES (?, ?)').run(
        'old',
        JSON.stringify([{ role: 'user', content: '旧消息' }]),
    );
    old.close();
    let store = openChatStore(path);
    try {
        assert.equal(store.load('old')[0].content, '旧消息');
        store.save('old', [...store.load('old'), { role: 'assistant', content: '新回复' }]);
        store.close();
        store = openChatStore(path);
        assert.equal(store.load('old').length, 2);
        assert.equal('mode' in store.list()[0], false);
        const check = new DatabaseSync(path);
        assert.equal(
            check
                .prepare('PRAGMA table_info(sessions)')
                .all()
                .some((column) => column.name === 'state'),
            false,
        );
        check.close();
    } finally {
        store.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
