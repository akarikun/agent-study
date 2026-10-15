import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Tool } from './types.ts';
import { assertFilePath } from './validation.ts';
import { checkJavaScript } from './syntax-check.ts';

export const writeFileTool: Tool = {
    readOnly: false,
    description:
        '写入 UTF-8 文本文件。参数：path，必填字符串，文件路径；content，必填字符串，完整文件内容。文件不存在时创建，已存在时覆盖；父目录必须已存在。当文件为代码时, 需要注意代码中的英文标点符号和大小写，严格按要求传参。',
    execute: async ({ path, content }) => {
        assertFilePath(path);
        if (typeof content !== 'string') {
            throw new Error('content 必须是字符串');
        }

        const filePath = resolve(path);
        await writeFile(filePath, content, 'utf8');

        return checkJavaScript(filePath);
    },
};
