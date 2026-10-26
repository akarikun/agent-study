import { fileURLToPath } from 'node:url';
import { buildIndex } from '../src/rag/indexer.ts';

const root = new URL('../', import.meta.url);
const count = await buildIndex(
    fileURLToPath(new URL('knowledge/', root)),
    fileURLToPath(new URL('.data/knowledge-index.json', root)),
);
console.log(`知识库索引已生成：${count}个片段。修改文档后请重新运行 npm run rag:index。`);
