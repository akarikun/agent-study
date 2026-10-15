import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Model } from './models.ts';

// 后台配置管理独立于 HTTP 路由；启动时读取、更新后保存，Key 只留在服务端。
export function createModelStore(initialModels: Model[], configPath: URL) {
    let models: Model[] = existsSync(configPath)
        ? JSON.parse(readFileSync(configPath, 'utf8'))
        : initialModels;

    function persist() {
        mkdirSync(new URL('./', configPath), { recursive: true });
        writeFileSync(configPath, JSON.stringify(models, null, 2), { mode: 0o600 });
    }

    return {
        list() {
            return models.map(({ key, ...model }) => ({ ...model, hasKey: Boolean(key) }));
        },
        find(id: string) {
            return models.find((model) => model.id === id);
        },
        upsert(data: any) {
            if (
                typeof data.name !== 'string' ||
                !data.name.trim() ||
                typeof data.model !== 'string' ||
                !data.model.trim() ||
                !['http:', 'https:'].includes(new URL(data.url).protocol)
            )
                throw new Error('模型配置无效');

            const previous = models.find((model) => model.id === data.id);
            const model = {
                id: previous?.id || crypto.randomUUID(),
                name: data.name.trim(),
                model: data.model.trim(),
                url: data.url,
                key: data.key === undefined ? previous?.key : String(data.key),
            };
            models = [...models.filter((item) => item.id !== model.id), model];
            persist();
        },
        remove(id: string) {
            models = models.filter((model) => model.id !== id);
            persist();
        },
    };
}
