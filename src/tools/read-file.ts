import { readFile } from 'node:fs/promises';
import type { Tool } from './types.ts';

export const readFileTool: Tool = {
    readOnly: true,
    description: '读取文本文件。参数：path，字符串，必填，文件路径。',
    execute: async ({ path }) => ({ content: await readFile(path, 'utf8') }),
};
