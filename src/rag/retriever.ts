import { readFile } from 'node:fs/promises';
import type { DocumentChunk } from './indexer.ts';

export function searchChunks(chunks: DocumentChunk[], keywords: string[], topK = 3) {
    const terms = [...new Set(keywords.map((term) => term.trim().toLowerCase()).filter(Boolean))];
    if (!terms.length || !Number.isInteger(topK) || topK < 1 || topK > 5)
        throw new Error('关键词或检索数量无效');
    return chunks
        .map((chunk) => {
            const content = chunk.content.toLowerCase();
            const score = terms.filter((term) => content.includes(term)).length;
            return { ...chunk, score };
        })
        .filter((chunk) => chunk.score > 0)
        .sort(
            (a, b) =>
                b.score - a.score || a.source.localeCompare(b.source) || a.startLine - b.startLine,
        )
        .slice(0, topK);
}

export async function loadIndex(path: string): Promise<DocumentChunk[]> {
    let raw: string;
    try {
        raw = await readFile(path, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            throw new Error('知识库索引不存在，请先运行 npm run rag:index');
        throw error;
    }
    const index = JSON.parse(raw);
    if (
        index.version !== 1 ||
        !Array.isArray(index.chunks) ||
        !index.chunks.every(
            (chunk: any) =>
                typeof chunk.id === 'string' &&
                typeof chunk.source === 'string' &&
                typeof chunk.content === 'string' &&
                Number.isInteger(chunk.startLine) &&
                Number.isInteger(chunk.endLine),
        )
    )
        throw new Error('知识库索引无效，请运行 npm run rag:index 重建');
    return index.chunks;
}
