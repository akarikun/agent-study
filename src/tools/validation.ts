export function assertFilePath(path: unknown): asserts path is string {
    if (typeof path !== 'string' || !path.trim()) {
        throw new Error('path 必须是非空字符串');
    }
}
