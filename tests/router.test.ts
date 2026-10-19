import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeModel } from '../src/agent/router.ts';

const models = [4, 9].map((size) => ({
    id: `${size}`,
    name: `${size}B`,
    model: `local-qwen-${size}b:q4`,
    url: 'http://localhost:11434',
}));

test('手动路由尊重选择，自动路由根据任务和最近上文选择', () => {
    const select = (text: string, extra = {}) =>
        routeModel({ models, text, autoRoute: true, ...extra });
    assert.equal(select('你好').model.id, '4');
    assert.equal(select('帮我重构代码').model.id, '9');
    assert.equal(
        select('继续', { history: [{ role: 'user', content: '分析架构' }] }).model.id,
        '9',
    );
    assert.equal(
        select('你好', { history: [{ role: 'user', content: '代码', internal: true }] }).model.id,
        '4',
    );
    assert.equal(select('你好', { autoRoute: false, modelId: '9' }).model.id, '9');
    assert.equal(select('代码', { autoRoute: false, modelId: '4' }).model.id, '4');
    assert.throws(() => select('你好', { autoRoute: false, modelId: 'missing' }), /有效模型/);
    assert.equal(select('x'.repeat(801)).model.id, '9');
    assert.equal(select('你好', { models: [models[0]] }).model.id, '4');
    assert.equal(select('你好', { models: [{ ...models[0], model: 'unknown' }] }).model.id, '4');
    assert.throws(() => select('你好', { models: [] }), /配置模型/);
});
