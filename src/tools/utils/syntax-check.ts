import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname } from 'node:path';

const execFileAsync = promisify(execFile);

// 仅检查语法，不执行生成的服务；返回结构继续交给模型判断是否修复。
export async function checkJavaScript(filePath: string) {
    if (!['.js', '.cjs', '.mjs'].includes(extname(filePath).toLowerCase())) {
        return { written: true, path: filePath, syntaxChecked: false };
    }

    try {
        await execFileAsync(process.execPath, ['--check', filePath], {
            timeout: 10_000,
            windowsHide: true,
        });

        return {
            written: true,
            path: filePath,
            syntaxValid: true,
        };
    } catch (error) {
        const failure = error as Error & { stderr?: string };

        return {
            written: true,
            path: filePath,
            syntaxValid: false,
            error: failure.stderr || failure.message,
            nextAction: '根据检查错误修复代码，再调用 write_file 写入完整文件。',
        };
    }
}
