import type { Model } from '../config/models.ts';
import type { Message } from '../storage/sqlite.ts';

// 本地学习版规则路由：参数量只作为大小代理，不代表实际能力评测。
export function routeModel({
    models,
    modelId,
    autoRoute = false,
    text,
    history = [],
}: {
    models: Model[];
    modelId?: string;
    autoRoute?: boolean;
    text: string;
    history?: Message[];
}) {
    if (!models.length) throw new Error('请先配置模型');
    if (!autoRoute) {
        const model = models.find((item) => item.id === modelId);
        if (!model) throw new Error('请选择有效模型');
        return { model, reason: '使用用户选择的模型' };
    }
    const ranked = models
        .map((model) => ({
            model,
            size: Number(model.model.match(/(?:^|[-_/])(\d+(?:\.\d+)?)b(?=[-_: /]|$)/i)?.[1]) || 0,
        }))
        .filter((item) => item.size > 0)
        .sort((a, b) => a.size - b.size);
    if (!ranked.length) return { model: models[0], reason: '无法识别模型大小，回退到首个配置模型' };
    // 最近真实用户提问帮助识别“继续”这类依赖上文的请求。
    const recent = history.filter((item) => item.role === 'user' && !item.internal).slice(-2);
    const input = [...recent.map((item) => item.content), text].join('\n');
    const complex =
        input.length > 800 ||
        /代码|编程|调试|重构|架构|算法|推理|分析|实现|开发|code|debug|refactor|implement/i.test(
            input,
        );
    return {
        model: ranked[complex ? ranked.length - 1 : 0].model,
        reason: complex
            ? '命中代码、分析类关键词或长输入，选择较大模型'
            : '未命中复杂任务规则，选择较小模型',
    };
}
