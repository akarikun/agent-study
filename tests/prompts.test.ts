import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openChatStore } from '../src/storage/sqlite.ts';

test('助手配置持久化，切换、新建、更新及重启不覆盖自定义内容', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-prompts-'));
    const path = join(directory, 'chat.sqlite');
    let store = openChatStore(path);
    try {
        assert.equal(store.activePrompt().id, 'tools');
        assert.equal(store.promptConfig().prompts.length, 2);
        store.selectPrompt('library');
        assert.match(store.activePrompt().content, /图书管理/);
        store.savePrompt({ id: 'library', name: '图书助手', content: '更新后的规则' });
        store.close();
        store = openChatStore(path);
        assert.equal(store.activePrompt().content, '更新后的规则');
        assert.equal(store.activePrompt().id, 'library');
        store.savePrompt({ name: '学习助手', content: '帮助学习' });
        assert.equal(store.promptConfig().prompts.length, 3);
        assert.equal(store.activePrompt().name, '学习助手');
        assert.throws(() => store.selectPrompt('missing'), /不存在/);
        assert.throws(() => store.savePrompt({ name: '', content: 'x' }), /无效/);
        assert.throws(() => store.savePrompt({ id: 'missing', name: 'x', content: 'y' }), /不存在/);
    } finally {
        store.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
