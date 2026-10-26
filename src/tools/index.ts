import { readFileTool } from './read-file.ts';
import { writeFileTool } from './write-file.ts';
import { editFileTool } from './edit-file.ts';
import { weatherTool } from './weather.ts';
import { rememberTool } from './remember.ts';
import { librarylocalTools } from './library/index.ts';
import { knowledgeTools } from './knowledge/index.ts';
import type { Tool } from './utils/types.ts';

export const fileTools: Record<string, Tool> = {
    read_file: readFileTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
};

export const weatherTools: Record<string, Tool> = { get_weather: weatherTool };

// 总工具表用于通用助手和页面清单，专属助手使用各自的工具集合。
export const localTools: Record<string, Tool> = {
    ...fileTools,
    remember: rememberTool,
    ...weatherTools,
    ...librarylocalTools,
    ...knowledgeTools,
};
