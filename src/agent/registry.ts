import { Agent } from './instance.ts';
import { defaultPrompt, libraryPrompt, filePrompt, weatherPrompt } from './prompt.ts';
import { localTools, fileTools, weatherTools } from '../tools/index.ts';
import { librarylocalTools } from '../tools/library/index.ts';

// 应用外层统一创建角色。模型每轮由网页/CLI选择，也可以在构造时固定。
export const agents = {
    tools: new Agent({ name: '工具助手', prompt: defaultPrompt, tools: localTools }),
    library: new Agent({ name: '图书管理助手', prompt: libraryPrompt, tools: librarylocalTools }),
    file: new Agent({ name: '文件助手', prompt: filePrompt, tools: fileTools }),
    weather: new Agent({ name: '天气助手', prompt: weatherPrompt, tools: weatherTools }),
};

// 自定义助手继续使用通用工具；内置角色按已保存的助手ID选择。
export function getAgent(promptId: string): Agent {
    return Object.hasOwn(agents, promptId) ? agents[promptId as keyof typeof agents] : agents.tools;
}
