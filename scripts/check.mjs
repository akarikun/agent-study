import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);

// 自动覆盖新增模块，拆文件后不必手动维护一长串 node --check。
function checkDirectory(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = new URL(entry.name, directory);
        if (entry.isDirectory()) {
            checkDirectory(new URL(`${entry.name}/`, directory));
        } else if (/\.(?:ts|js|mjs)$/.test(entry.name)) {
            const result = spawnSync(process.execPath, ['--check', fileURLToPath(path)], {
                stdio: 'inherit',
                windowsHide: true,
            });
            if (result.error) throw result.error;
            if (result.status !== 0) process.exit(result.status || 1);
        }
    }
}

for (const directory of ['src/', 'admin/', 'scripts/']) {
    checkDirectory(new URL(directory, root));
}
console.log('所有源码语法检查通过');
