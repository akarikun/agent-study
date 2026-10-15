import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { projectPath } from './paths.ts';

// id 用于页面选择和接口查找；model 是传给模型服务的实际模型名称。
export type Model = { id: string; name: string; url: string; model: string; key?: string };
export function loadModels(): Model[] {
    // 相对当前模块定位配置，不依赖启动命令所在目录。
    const env = projectPath('.env');
    if (existsSync(env)) loadEnvFile(env);
    else if (!process.env.MODELS) loadEnvFile(projectPath('.env.example'));
    const saved = projectPath('.data/models.json');
    // 网页保存的配置优先；不存在时才解析环境变量中的 MODELS。
    if (existsSync(saved)) return JSON.parse(readFileSync(saved, 'utf8'));
    const models = JSON.parse(process.env.MODELS || '[]');
    if (!Array.isArray(models) || !models.length) throw new Error('MODELS 必须是非空数组');
    const result = models.map((item, i) => {
        if (!item.model || !item.url || !['http:', 'https:'].includes(new URL(item.url).protocol))
            throw new Error('模型配置无效');
        // 兼容旧配置：缺少 id 和显示名称时自动补齐。
        return { ...item, id: item.id || `model-${i}`, name: item.name || item.model };
    });
    if (new Set(result.map((item) => item.id)).size !== result.length)
        throw new Error('模型 ID 不能重复');
    return result;
}
