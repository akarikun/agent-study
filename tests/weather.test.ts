import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherTool } from '../src/tools/weather.ts';

test('地区 ID 从本地取得，只请求一次天气接口，直接返回原始结果', async () => {
    const weather = {
        city: '北京',
        cityid: 101010100,
        realtime: { temp: '20', weather: '晴' },
        weathers: [],
    };
    let calls = 0;
    const tool = createWeatherTool((async (input: URL) => {
        calls++;
        assert.equal(input.origin, 'http://aider.meizu.com');
        assert.equal(input.searchParams.get('cityIds'), '101010100');
        return Response.json({ code: '200', value: [weather] });
    }) as typeof fetch);
    assert.deepEqual(await tool.execute({ countyname: '北京' }), weather);
    assert.equal(calls, 1);
    assert.deepEqual(await tool.execute({ city: '北京' }), weather);
    await assert.rejects(tool.execute({ countyname: '不存在' }), /未找到地区/);
    await assert.rejects(tool.execute({}), /城市名称/);
    assert.equal(calls, 2);
    const candidates: any = await tool.execute({ countyname: '朝阳' });
    assert.equal(candidates.needsClarification, true);
    assert.equal(calls, 2);
});

test('天气请求失败向上传递，前端能收到工具错误', async () => {
    const tool = createWeatherTool((async () => new Response('', { status: 503 })) as typeof fetch);
    await assert.rejects(tool.execute({ countyname: '北京' }), /HTTP 503/);
    const busy = createWeatherTool((async () =>
        Response.json({ code: '500', message: '系统繁忙' })) as typeof fetch);
    await assert.rejects(busy.execute({ countyname: '北京' }), /系统繁忙/);
    const empty = createWeatherTool((async () =>
        Response.json({ code: 200, value: [] })) as typeof fetch);
    await assert.rejects(empty.execute({ countyname: '北京' }), /未返回天气数据/);
});
