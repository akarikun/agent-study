import type { Tool } from './utils/types.ts';
import { weatherData } from './utils/weather.data.ts';

export function createWeatherTool(request: typeof fetch = fetch): Tool {
    return {
        readOnly: true,
        description:
            '查询中国城市或区县的天气。参数 countyname，字符串，例如“北京”；兼容 city。程序会从本地地区表取得 ID，不需要另查 ID。同名地区返回候选，可通过可选参数 areaid 确认。返回接口原始天气数据，请根据数据日期回答，不把旧天气当成今天。',
        async execute({ countyname, city, areaid } = {}) {
            const name = countyname ?? city;
            if (typeof name !== 'string' || !name.trim())
                throw new Error('请提供 countyname 城市名称');

            // 1. 从本地表匹配 ID，不额外请求接口。
            const matches = weatherData.filter(
                (item) =>
                    item.countyname === name.trim() &&
                    (areaid === undefined || String(item.areaid) === String(areaid)),
            );
            if (!matches.length) throw new Error(`未找到地区“${name}”，请确认名称`);
            if (matches.length > 1)
                return {
                    needsClarification: true,
                    message: '存在同名地区，请确认 areaid 后重试',
                    candidates: matches,
                };

            // 2. 按文档请求天气接口。
            const url = new URL('http://aider.meizu.com/app/weather/listWeather');
            url.searchParams.set('cityIds', String(matches[0].areaid));
            const response = await request(url, { signal: AbortSignal.timeout(15_000) });
            if (!response.ok) throw new Error(`天气请求失败：HTTP ${response.status}`);
            const data = await response.json();
            if (String(data?.code) !== '200') throw new Error(data?.message || '天气接口返回错误');
            if (!Array.isArray(data.value) || !data.value.length)
                throw new Error('接口未返回天气数据');

            // 3. 直接返回原始天气信息，交给模型组织回答。
            return data.value[0];
        },
    };
}

export const weatherTool = createWeatherTool();
