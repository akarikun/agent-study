import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// 只复制明确列出的公开资源，绝不打包 .env、.data 或服务器文件。
const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
mkdirSync(new URL('vendor/', output), { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'chat-render.js', 'browser-runtime.js']) {
    copyFileSync(new URL(`admin/${file}`, root), new URL(file, output));
}
for (const [source, target] of [
    ['node_modules/marked/lib/marked.umd.js', 'vendor/marked.js'],
    ['node_modules/dompurify/dist/purify.min.js', 'vendor/purify.js'],
])
    copyFileSync(new URL(source, root), new URL(target, output));
const modules = [
    'src/agent/prompt.ts',
    'src/agent/context.ts',
    'src/agent/router.ts',
    'src/tools/utils/weather.data.ts',
    'src/tools/weather.ts',
];
const code = modules
    .map((file) =>
        stripTypeScriptTypes(readFileSync(new URL(file, root), 'utf8'))
            .replace(
                /^import \{ weatherData \} from ['"]\.\/utils\/weather\.data\.ts['"];?\s*$/m,
                '',
            )
            .replace(/^export /gm, ''),
    )
    .join('\n');
writeFileSync(
    new URL('runtime-config.js', output),
    `// Generated public browser runtime.\n(() => {\n${code}\nwindow.AGENT_BROWSER_BOOTSTRAP = { builtinPrompts, createSystemMessage, buildContext, routeModel, createWeatherTool };\n})();\n`,
);
console.log(
    '静态版本已生成：dist/。默认演示模式，可切换浏览器直连，无需 Node 后端、SQLite 或 Ollama。',
);
