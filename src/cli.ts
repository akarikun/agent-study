import { createInterface } from 'node:readline/promises';
import { loadModels } from './config/models.ts';
import { openChatStore } from './storage/sqlite.ts';
import { runSessionTurn } from './agent/session.ts';

export async function startCLI() {
    // 终端负责交互和选择模型，会话状态与模型循环交给共享的 runSessionTurn。
    const models = loadModels();
    let selected = Number(process.env.MODEL_INDEX || 0);
    if (!Number.isInteger(selected) || !models[selected]) throw new Error('MODEL_INDEX 无效');
    const cli = createInterface({ input: process.stdin, output: process.stdout });
    const store = openChatStore();
    const sessionId = process.env.CHAT_SESSION_ID || 'default';
    try {
        while (true) {
            const text = await cli.question('> ');
            // 斜杠命令由本地处理，不作为用户消息发送给模型。
            if (text === '/exit') return;
            if (text === '/prompts') {
                const config = store.promptConfig();
                for (const prompt of config.prompts)
                    console.log(
                        `${prompt.id === config.activeId ? '*' : ' '} ${prompt.id}: ${prompt.name}`,
                    );
                continue;
            }
            if (text.startsWith('/prompt ')) {
                try {
                    store.selectPrompt(text.slice(8).trim());
                    console.log(`已切换：${store.activePrompt().name}，下一轮生效。`);
                } catch (error) {
                    console.error(error instanceof Error ? error.message : String(error));
                }
                continue;
            }
            if (text === '/models') {
                models.forEach((model, i) =>
                    console.log(`${selected === i ? '*' : ' '} ${i}: ${model.model}`),
                );
                continue;
            }
            if (text.startsWith('/model ')) {
                const index = Number(text.slice(7).trim());
                if (Number.isInteger(index) && models[index]) {
                    selected = index;
                    console.log(`已切换：${models[index].model}`);
                } else console.log('模型序号无效');
                continue;
            }
            if (text === '/clear') {
                store.clear(sessionId);
                console.log('已清空对话历史。');
                continue;
            }
            if (!text.trim()) continue;
            try {
                for await (const event of runSessionTurn({
                    store,
                    sessionId,
                    model: models[selected],
                    text,
                    planExecute: process.argv.includes('--plan'),
                    multiAgent: process.argv.includes('--multi-agent'),
                })) {
                    if (event.type === 'delta') process.stdout.write(event.text);
                    else if (event.type === 'plan')
                        console.log(`\n[计划 ${event.status}]`, event.steps);
                    else if (event.type === 'review')
                        console.log(
                            `\n[答案复查：${event.status === 'running' ? '进行中' : '完成'}]`,
                        );
                    else
                        console.log(
                            `\n[工具 ${event.name}: ${event.status}${event.error ? `：${event.error}` : ''}]`,
                        );
                }
                console.log();
            } catch (error) {
                console.error('\n', error instanceof Error ? error.message : String(error));
            }
        }
    } finally {
        cli.close();
        store.close();
    }
}
