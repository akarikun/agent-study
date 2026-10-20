import { inspect } from 'node:util';

export type AgentStep = {
    stage: 'request' | 'decision' | 'tool' | 'result' | 'error' | 'done';
    round?: number;
    message: string;
    data?: unknown;
};

const stages = {
    request: ['36', '请求模型'],
    decision: ['35', '模型决策'],
    tool: ['34', '执行工具'],
    result: ['32', '工具结果'],
    error: ['31', '错误'],
    done: ['32', '本轮完成'],
};

// 后台日志走 stderr，避免与 CLI 的流式回答混在 stdout 中。
export function createAgentLogger(sessionId: string, secret?: string) {
    const traceId = crypto.randomUUID().slice(0, 8);
    const started = Date.now();
    const color =
        !process.env.NO_COLOR && (process.stderr.isTTY || process.env.FORCE_COLOR === '1');
    const paint = (code: string, value: string) => (color ? `\x1b[${code}m${value}\x1b[0m` : value);
    const clean = (value: unknown, depth = 0): unknown => {
        if (typeof value === 'string') {
            const text = secret ? value.replaceAll(secret, '[已隐藏]') : value;
            return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 500);
        }
        if (depth > 3) return '[省略深层数据]';
        if (Array.isArray(value)) return value.slice(0, 5).map((item) => clean(item, depth + 1));
        if (value && typeof value === 'object')
            return Object.fromEntries(
                Object.entries(value)
                    .slice(0, 15)
                    .map(([key, item]) => [
                        key,
                        /key|token|password|secret|authorization/i.test(key)
                            ? '[已隐藏]'
                            : clean(item, depth + 1),
                    ]),
            );
        return value;
    };
    return (step: AgentStep) => {
        const [code, label] = stages[step.stage];
        const time = new Date().toLocaleTimeString('zh-CN', {
            hour12: false,
            timeZone: 'Asia/Shanghai',
        });
        const scope = `${traceId}/${String(clean(sessionId)).slice(0, 36)}`;
        const round = step.round ? ` 第${step.round}步` : '';
        process.stderr.write(
            `${paint('90', `[${time}] [${scope}]`)} ${paint(code, `${label}${round}`)} ${clean(step.message)} ${paint('90', `+${Date.now() - started}ms`)}\n`,
        );
        if (step.data !== undefined) {
            const detail = inspect(clean(step.data), {
                colors: false,
                depth: 4,
                maxArrayLength: 5,
                maxStringLength: 300,
                breakLength: 100,
            });
            process.stderr.write(
                paint(
                    '90',
                    detail
                        .split('\n')
                        .map((line) => `    ${line}`)
                        .join('\n'),
                ) + '\n',
            );
        }
    };
}
