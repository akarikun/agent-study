// 唯一启动入口：默认提供网页后台，--cli 切换到终端对话。
async function main() {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--cli')) {
        throw new Error('用法：node src/main.ts [--cli]');
    }
    if (args[0] === '--cli') {
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
