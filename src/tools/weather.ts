import type { Tool } from './types.ts';

// 固定访问天气服务，不接受模型提供的任意 URL。
export function createWeatherTool(request: typeof fetch = fetch): Tool {
    async function getJson(url: URL) {
        try {
            const response = await request(url, { signal: AbortSignal.timeout(15_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.error) throw new Error(data.reason || '天气服务返回错误');
            return data;
        } catch (error) {
            throw new Error(
                `天气服务请求失败：${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
    return {
        readOnly: true,
        description:
            '联网查询指定城市今天的天气、当前温度、今日最高最低温和降水概率。参数：city，字符串，必填，例如“北京”或“Beijing”；countryCode，字符串，可选，两个英文字母的国家代码，例如 CN。今天以查询城市的当地日期为准。查询天气使用本工具，不使用 read_file；只支持今天，不支持其他日期。同名城市会返回候选，需向用户确认后补充国家或更具体城市名称。',
        async execute(params) {
            const { city, countryCode } = params ?? {};
            if (typeof city !== 'string' || !city.trim() || city.length > 100)
                throw new Error('city 必须是非空城市名称，最多 100 个字符');
            if (
                countryCode !== undefined &&
                (typeof countryCode !== 'string' || !/^[a-z]{2}$/i.test(countryCode))
            )
                throw new Error('countryCode 必须是两个英文字母');
            const geocoding = new URL('https://geocoding-api.open-meteo.com/v1/search');
            const name = city.trim();
            geocoding.search = new URLSearchParams({
                name: /^(北京|北京市)$/.test(name) ? 'Beijing' : name,
                count: '5',
                language: 'zh',
                format: 'json',
                ...(countryCode ? { countryCode: countryCode.toUpperCase() } : {}),
            }).toString();
            const places = (await getJson(geocoding)).results;
            if (!Array.isArray(places) || !places.length)
                throw new Error(`未找到城市“${name}”，请补充国家或更具体城市名称`);
            const candidates = places.map((place: any) => ({
                name: place.name,
                region: place.admin1,
                country: place.country,
                countryCode: place.country_code,
                latitude: place.latitude,
                longitude: place.longitude,
            }));
            // 北京有明确的国家与行政区域；其他名称不静默选择同名地点。
            const beijing = /^(北京|北京市|beijing)$/i.test(name)
                ? places.find(
                      (place: any) =>
                          place.country_code === 'CN' && Math.abs(place.latitude - 39.9) < 0.5,
                  )
                : undefined;
            if (places.length > 1 && !beijing)
                return {
                    needsClarification: true,
                    message: '找到多个地点，请确认城市所在地区或国家后重新查询。',
                    candidates,
                };
            const place = beijing ?? places[0];
            if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude))
                throw new Error('天气服务返回了无效坐标');
            const url = new URL('https://api.open-meteo.com/v1/forecast');
            url.search = new URLSearchParams({
                latitude: String(place.latitude),
                longitude: String(place.longitude),
                timezone: 'auto',
                forecast_days: '1',
                current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
                daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
            }).toString();
            const data = await getJson(url);
            if (!data.current || !data.daily?.time?.[0])
                throw new Error('天气服务未返回完整天气数据');
            return {
                source: 'Open-Meteo',
                sourceUrl: 'https://open-meteo.com/',
                note: '天气数据来自数值天气模型，包含当前天气估计与今日预报。WMO weather_code 请按天气代码解释；缺失值不能当作零。',
                location: { name: place.name, region: place.admin1, country: place.country },
                timezone: data.timezone,
                date: data.daily.time[0],
                fetchedAt: new Date().toISOString(),
                current: data.current,
                currentUnits: data.current_units,
                today: {
                    temperatureMax: data.daily.temperature_2m_max?.[0],
                    temperatureMin: data.daily.temperature_2m_min?.[0],
                    precipitationProbabilityMax: data.daily.precipitation_probability_max?.[0],
                    weatherCode: data.daily.weather_code?.[0],
                },
                dailyUnits: data.daily_units,
            };
        },
    };
}

export const weatherTool = createWeatherTool();
