import { readFile } from 'node:fs/promises';
import type { Tool } from './types.ts';

export const readFileTool: Tool = {
    readOnly: true,
    description: '读取已知路径的本地文本文件。参数：path，字符串，必填，用户提供或上下文已确认的文件路径。不用于联网查询、实时天气、图书库存或搜索文件；不得根据问题猜测文件路径。',
    execute: async ({ path }) => ({ content: await readFile(path, 'utf8') }),
};
