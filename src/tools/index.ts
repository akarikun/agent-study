import { readFileTool } from './read-file.ts';
import { writeFileTool } from './write-file.ts';
import { editFileTool } from './edit-file.ts';
import type { Tool } from './types.ts';

export type { Tool } from './types.ts';

// 新增工具：在独立文件实现后，在此注册；Agent 和页面共用这份清单。
export const localTools: Record<string, Tool> = {
    read_file: readFileTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
};
