import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

function text(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 200)
        throw new Error(`${name} 必须是不超过200字的非空字符串`);
    return value.trim();
}

export function openLibraryStore(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    function transaction<T>(work: () => T): T {
        db.exec('BEGIN IMMEDIATE');
        try {
            const result = work();
            db.exec('COMMIT');
            return result;
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }
    // 新增字段时追加下一版本迁移，不删除已有数据。
    try {
        const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
        if (version > 1) throw new Error('图书数据库版本高于当前程序支持的版本');
        if (version === 0)
            transaction(() =>
                db.exec(`
            CREATE TABLE books (
                id TEXT PRIMARY KEY, book_no TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL,
                total_quantity INTEGER NOT NULL CHECK(total_quantity >= 0),
                available_quantity INTEGER NOT NULL
                    CHECK(available_quantity >= 0 AND available_quantity <= total_quantity)
            );
            CREATE TABLE loans (
                id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id),
                borrower TEXT NOT NULL, borrowed_at TEXT NOT NULL,
                returned_at TEXT, request_id TEXT NOT NULL UNIQUE
            );
            CREATE INDEX loans_borrower ON loans(borrower, returned_at);
            PRAGMA user_version = 1;
        `),
            );
    } catch (error) {
        db.close();
        throw error;
    }
    const getBook = (id: string) => db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    const getLoan = (id: string) => db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
    return {
        searchBooks({ title, bookNo }: any = {}) {
            if (title === undefined && bookNo === undefined)
                throw new Error('至少提供title或bookNo');
            const conditions: string[] = [];
            const values: string[] = [];
            if (title !== undefined) {
                conditions.push('instr(title, ?) > 0');
                values.push(text(title, 'title'));
            }
            if (bookNo !== undefined) {
                conditions.push('book_no = ?');
                values.push(text(bookNo, 'bookNo'));
            }
            return db
                .prepare(
                    `SELECT * FROM books WHERE ${conditions.join(' AND ')} ORDER BY id LIMIT 20`,
                )
                .all(...values);
        },
        addBooks({ title, author, bookNo, quantity }: any = {}) {
            title = text(title, 'title');
            author = text(author, 'author');
            bookNo = text(bookNo, 'bookNo');
            if (typeof quantity === 'string' && /^\d+$/.test(quantity)) quantity = Number(quantity);
            if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000)
                throw new Error('quantity 必须是1到1000000的整数');
            return transaction(() => {
                const existing = db.prepare('SELECT * FROM books WHERE book_no = ?').get(bookNo);
                if (existing) {
                    if (existing.title !== title || existing.author !== author)
                        throw new Error('同书号的书名或作者不一致，请确认后入库');
                    if (Number(existing.total_quantity) + quantity > 1_000_000)
                        throw new Error('总库存不能超过1000000');
                    db.prepare(
                        'UPDATE books SET total_quantity = total_quantity + ?, available_quantity = available_quantity + ? WHERE id = ?',
                    ).run(quantity, quantity, existing.id);
                    return getBook(existing.id as string);
                }
                const id = randomUUID();
                db.prepare('INSERT INTO books VALUES (?, ?, ?, ?, ?, ?, ?)').run(
                    id,
                    bookNo,
                    title,
                    author,
                    new Date().toISOString(),
                    quantity,
                    quantity,
                );
                return getBook(id);
            });
        },
        borrowBook({ bookId, borrower, requestId }: any = {}) {
            bookId = text(bookId, 'bookId');
            borrower = text(borrower, 'borrower');
            requestId = text(requestId, 'requestId');
            return transaction(() => {
                const existing = db
                    .prepare('SELECT * FROM loans WHERE request_id = ?')
                    .get(requestId);
                if (existing) {
                    if (existing.book_id !== bookId || existing.borrower !== borrower)
                        throw new Error('requestId已用于其他借阅操作');
                    return existing;
                }
                if (!getBook(bookId)) throw new Error('图书不存在');
                const changed = db
                    .prepare(
                        'UPDATE books SET available_quantity = available_quantity - 1 WHERE id = ? AND available_quantity > 0',
                    )
                    .run(bookId);
                if (!changed.changes) throw new Error('可借库存不足');
                const id = randomUUID();
                db.prepare('INSERT INTO loans VALUES (?, ?, ?, ?, NULL, ?)').run(
                    id,
                    bookId,
                    borrower,
                    new Date().toISOString(),
                    requestId,
                );
                return getLoan(id);
            });
        },
        searchLoans({ borrower, bookId }: any = {}) {
            if (borrower === undefined && bookId === undefined)
                throw new Error('至少提供borrower或bookId');
            const conditions = ['l.returned_at IS NULL'];
            const values: string[] = [];
            if (borrower !== undefined) {
                conditions.push('l.borrower = ?');
                values.push(text(borrower, 'borrower'));
            }
            if (bookId !== undefined) {
                conditions.push('l.book_id = ?');
                values.push(text(bookId, 'bookId'));
            }
            return db
                .prepare(
                    `SELECT l.*, b.title, b.book_no FROM loans l JOIN books b ON b.id = l.book_id WHERE ${conditions.join(' AND ')} ORDER BY l.borrowed_at, l.id LIMIT 20`,
                )
                .all(...values);
        },
        returnBook({ loanId }: any = {}) {
            loanId = text(loanId, 'loanId');
            return transaction(() => {
                const loan = getLoan(loanId);
                if (!loan) throw new Error('借阅记录不存在');
                if (loan.returned_at !== null) return { ...loan, alreadyReturned: true };
                db.prepare('UPDATE loans SET returned_at = ? WHERE id = ?').run(
                    new Date().toISOString(),
                    loanId,
                );
                db.prepare(
                    'UPDATE books SET available_quantity = available_quantity + 1 WHERE id = ?',
                ).run(loan.book_id);
                return { ...getLoan(loanId), alreadyReturned: false };
            });
        },
        close: () => db.close(),
    };
}
