import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherTool } from '../src/tools/weather.ts';

test('天气工具查询城市坐标和当地今日预报，返回来源与单位', async () => {
    const urls: URL[] = [];
    const tool = createWeatherTool((async (input: URL) => {
        urls.push(input);
        return Response.json(
            urls.length === 1
                ? {
                      results: [
                          {
                              name: '北京',
                              country_code: 'CN',
                              latitude: 39.9,
                              longitude: 116.4,
                          },
                      ],
                  }
                : {
                      timezone: 'Asia/Shanghai',
                      current: { temperature_2m: 20 },
                      current_units: { temperature_2m: '°C' },
                      daily: {
                          time: ['2026-10-19'],
                          temperature_2m_max: [23],
                          temperature_2m_min: [12],
                          precipitation_probability_max: [0],
                          weather_code: [0],
                      },
                      daily_units: { temperature_2m_max: '°C', precipitation_probability_max: '%' },
                  },
        );
    }) as typeof fetch);
    const result: any = await tool.execute({ city: '北京' });
    assert.equal(urls[0].searchParams.get('name'), 'Beijing');
    assert.equal(urls[1].hostname, 'api.open-meteo.com');
    assert.equal(urls[1].searchParams.get('timezone'), 'auto');
    assert.equal(urls[1].searchParams.get('forecast_days'), '1');
    assert.equal(result.date, '2026-10-19');
    assert.equal(result.today.precipitationProbabilityMax, 0);
    assert.equal(result.source, 'Open-Meteo');
    assert.equal(result.currentUnits.temperature_2m, '°C');
});

test('天气工具校验参数、缺失城市、同名城市及网络错误', async () => {
    const empty = createWeatherTool((async () => Response.json({ results: [] })) as typeof fetch);
    await assert.rejects(empty.execute({}), /city/);
    await assert.rejects(empty.execute({ city: '北京', countryCode: 'invalid' }), /countryCode/);
    await assert.rejects(empty.execute({ city: '不存在' }), /未找到城市/);
    const ambiguous = createWeatherTool((async () =>
        Response.json({
            results: [
                { name: 'Springfield', country_code: 'US' },
                { name: 'Springfield', country_code: 'CA' },
            ],
        })) as typeof fetch);
    assert.equal(
        ((await ambiguous.execute({ city: 'Springfield' })) as any).needsClarification,
        true,
    );
    const failed = createWeatherTool(
        (async () => new Response('', { status: 503 })) as typeof fetch,
    );
    await assert.rejects(failed.execute({ city: '北京' }), /HTTP 503/);
    const offline = createWeatherTool((async () => {
        throw new Error('网络不可用');
    }) as typeof fetch);
    await assert.rejects(offline.execute({ city: '北京' }), /天气服务请求失败.*网络不可用/);
});
