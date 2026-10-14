import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openChatStore } from './sqlite.ts';

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
