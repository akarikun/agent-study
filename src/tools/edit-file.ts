import { readFile, writeFile } from 'node:fs/promises';
import type { Tool } from './types.ts';
import { assertFilePath } from './validation.ts';

export const editFileTool: Tool = {
    readOnly: false,
    description:
        '局部修改 UTF-8 文本文件。参数：path，文件路径；' +
        'oldText，文件中必须唯一匹配的原文；' +
        'newText，替换后的完整片段。所有参数均为必填字符串。' +
        '调用前先读取文件；新增代码时，在 newText 中保留原文并加入新增内容。',
    execute: async ({ path, oldText, newText }) => {
        assertFilePath(path);
        if (typeof oldText !== 'string' || !oldText) {
            throw new Error('oldText 必须是非空字符串');
        }
        if (typeof newText !== 'string') {
            throw new Error('newText 必须是字符串');
        }

        const source = await readFile(path, 'utf8');
        const position = source.indexOf(oldText);

        if (position === -1) {
            throw new Error('未找到原文，请重新读取文件后修改');
        }
        if (source.indexOf(oldText, position + 1) !== -1) {
            throw new Error('原文有多处匹配，请提供更完整的定位片段');
        }

        const updated =
            source.slice(0, position) + newText + source.slice(position + oldText.length);

        await writeFile(path, updated, 'utf8');
        return { success: true, path };
    },
};
