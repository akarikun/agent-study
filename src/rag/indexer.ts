import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';

export type DocumentChunk = {
    id: string;
    source: string;
    startLine: number;
    endLine: number;
    content: string;
};

// 字符切块保留重叠与行号；此处不使用模型或 Embedding。
export function chunkDocument(
    source: string,
    content: string,
    size = 800,
    overlap = 100,
): DocumentChunk[] {
    if (
        !Number.isInteger(size) ||
        !Number.isInteger(overlap) ||
        size <= 0 ||
        overlap < 0 ||
        overlap >= size
    )
        throw new Error('切块参数无效');
    content = content.replace(/\r\n/g, '\n');
    const chunks: DocumentChunk[] = [];
    let startLine = 1;
    let previousStart = 0;
    for (let start = 0; start < content.length; start += size - overlap) {
        startLine += (content.slice(previousStart, start).match(/\n/g) ?? []).length;
        previousStart = start;
        const text = content.slice(start, start + size);
        if (text.trim())
            chunks.push({
                id: `${source}#${chunks.length + 1}`,
                source,
                startLine,
                endLine: startLine + (text.match(/\n/g) ?? []).length,
                content: text,
            });
        if (start + size >= content.length) break;
    }
    return chunks;
}

export async function buildIndex(directory: string, indexPath: string) {
    const chunks: DocumentChunk[] = [];
    async function walk(folder: string) {
        const entries = await readdir(folder, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            // 不跟随符号链接，也不扫描隐藏目录或依赖目录。
            if (
                entry.isSymbolicLink() ||
                entry.name.startsWith('.') ||
                entry.name === 'node_modules'
            )
                continue;
            const path = join(folder, entry.name);
            if (entry.isDirectory()) await walk(path);
            else if (entry.isFile() && /\.(md|txt)$/i.test(entry.name)) {
                const bytes = await readFile(path);
                if (bytes.length > 1_048_576) throw new Error(`文档超过1MB：${entry.name}`);
                const source = relative(directory, path).split('\\').join('/');
                chunks.push(...chunkDocument(source, bytes.toString('utf8')));
            }
        }
    }
    await walk(directory);
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(
        indexPath,
        JSON.stringify({ version: 1, createdAt: new Date().toISOString(), chunks }),
        'utf8',
    );
    return chunks.length;
}
