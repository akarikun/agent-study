// 唯一启动入口：默认提供网页后台，--cli 切换到终端对话。
async function main() {
    const args = process.argv.slice(2);
    if (
        args.some((arg) => !['--cli', '--plan'].includes(arg)) ||
        (args.includes('--plan') && !args.includes('--cli'))
    ) {
        throw new Error('用法：node src/main.ts [--cli [--plan]]');
    }
    if (args.includes('--cli')) {
        const { startCLI } = await import('./cli.ts');
        await startCLI();
    } else {
        const { startServer } = await import('./server.ts');
        await startServer();
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
