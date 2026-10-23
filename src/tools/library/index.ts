import { fileURLToPath } from 'node:url';
import { projectPath } from '../../config/paths.ts';
import type { Tool } from '../utils/types.ts';
import { openLibraryStore } from './store.ts';

// 初始化由程序自动完成，不作为模型工具；每次调用结束关闭连接。
export function createLibraryTools(
    path = fileURLToPath(projectPath('.data/library.sqlite')),
): Record<string, Tool> {
    const useStore = (work: (store: ReturnType<typeof openLibraryStore>) => unknown) => {
        const store = openLibraryStore(path);
        try {
            return work(store);
        } finally {
            store.close();
        }
    };
    // 工具适配层统一管理数据库连接，业务逻辑留在 store.ts。
    const tool = (
        method: 'searchBooks' | 'addBooks' | 'borrowBook' | 'searchLoans' | 'returnBook',
        readOnly: boolean,
        description: string,
    ): Tool => ({
        readOnly,
        description,
        execute: async (params) => useStore((store) => store[method](params)),
    });
    return {
        search_books: tool(
            'searchBooks',
            true,
            '查询图书。参数title、bookNo为可选字符串，至少提供一个；书名包含匹配，书号精确匹配，同时提供则同时满足。最多返回20条，含id、title、author、book_no、total_quantity和available_quantity；无匹配返回空数组。',
        ),
        storeSave: tool(
            'addBooks',
            false,
            '图书入库。必填参数title、author、bookNo为非空字符串，quantity为1到1000000的正整数（也接受整数字符串）。bookNo为唯一书号，同号同书增加库存，同号但书名或作者不同则拒绝。必须由用户明确提供信息，不猜测书号或数量。重复调用会再次增加库存，不盲目重试。',
        ),
        borrow_book: tool(
            'borrowBook',
            false,
            '登记借出一本图书。必填参数bookId来自查询结果，borrower为用户明确提供的借阅人标识，不猜测。库存不足拒绝。返回借阅记录id。必填requestId为本次操作唯一标识，重试同一次操作沿用该值，另一次借阅使用新值。当前是本地登记簿，不提供身份认证。',
        ),
        search_loans: tool(
            'searchLoans',
            true,
            '查询未归还借阅记录。可选参数borrower（借阅人精确匹配）、bookId（图书id），至少提供一个；同时提供则同时满足。最多返回20条，包含借阅记录id、book_id、title、book_no、borrower、borrowed_at。归还前用它定位loanId，多条匹配先询问用户。',
        ),
        return_book: tool(
            'returnBook',
            false,
            '归还一本图书。必填参数loanId为查询得到并已确认的借阅记录id。返回归还记录和alreadyReturned；重复归还不重复增加库存。当前为本地登记簿，不提供身份认证。',
        ),
    };
}

export const librarylocalTools = createLibraryTools();
