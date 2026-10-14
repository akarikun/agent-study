import { readFile } from 'node:fs/promises';

// 在这里扩展工具：说明交给模型，execute 留在本地执行。
export const localTools: Record<string, {
    description: string;
    execute: (params: any) => Promise<unknown>;
}> = {
    read_file: {
        description: '读取文本文件。参数：path，字符串，必填，文件路径。',
        execute: async ({ path }) => ({ content: await readFile(path, 'utf8') }),
    },
};
