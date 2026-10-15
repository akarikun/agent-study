import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localTools } from '../src/tools/index.ts';

test('拆分后的文件工具保留写入、语法检查和唯一片段替换行为', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-tools-'));
    const path = join(directory, 'sample.js');
    try {
        const valid = await localTools.write_file.execute({ path, content: 'const value = 1;\n' });
        assert.deepEqual(valid, { written: true, path, syntaxValid: true });
        assert.deepEqual(await localTools.read_file.execute({ path }), {
            content: 'const value = 1;\n',
        });

        assert.deepEqual(
            await localTools.edit_file.execute({
                path,
                oldText: 'value = 1',
                newText: 'value = 2',
            }),
            { success: true, path },
        );
        assert.equal(await readFile(path, 'utf8'), 'const value = 2;\n');
        await assert.rejects(
            localTools.edit_file.execute({ path, oldText: 'missing', newText: '' }),
            /未找到原文/,
        );

        const invalid: any = await localTools.write_file.execute({
            path,
            content: 'const value = ;',
        });
        assert.equal(invalid.written, true);
        assert.equal(invalid.syntaxValid, false);
        assert.ok(invalid.error);
        assert.equal(await readFile(path, 'utf8'), 'const value = ;');

        const textPath = join(directory, 'sample.txt');
        assert.deepEqual(
            await localTools.write_file.execute({ path: textPath, content: '  文本\n' }),
            { written: true, path: textPath, syntaxChecked: false },
        );
        await assert.rejects(
            localTools.write_file.execute({ path: '', content: '' }),
            /path 必须是非空字符串/,
        );
        await assert.rejects(
            localTools.write_file.execute({ path, content: 1 }),
            /content 必须是字符串/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
