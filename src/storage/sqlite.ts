import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPath } from '../config/paths.ts';
import { builtinPrompts } from '../agent/prompt.ts';

// internal 消息保留给模型上下文，但不作为聊天气泡展示。
export type Message = { id?: string; role: string; content: string; internal?: boolean };

// 每个会话保存一份消息列表；默认数据库位于项目的 .data 目录。
export function openChatStore(path = fileURLToPath(projectPath('.data/chat.sqlite'))) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    // 打开数据库文件；不存在时创建。:memory: 表示只在内存中保存。
    const db = new DatabaseSync(path);
    // exec 执行固定 SQL；prepare 编译带 ? 占位符的 SQL，参数由后续调用绑定。
    // run 用于写入，get 返回一行（没有则 undefined），all 返回所有匹配行。

    // memories：长期记忆，不等同于原始聊天记录。
    // owner_id：所属用户；scope：用户偏好(user)或项目约定(project)。
    // scope_id：具体项目标识，用户级记忆可约定为空字符串。
    // key/value：记忆名称和内容；updated_at：更新时间（调用方写入毫秒时间戳）。
    // 联合主键：同一用户、范围、项目下，同名记忆只能保存一条。
    // 保存和读取接口见下方 saveMemory、loadMemories。
    db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
        owner_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('user', 'project')),
        scope_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, scope, scope_id, key)
    )
`);

    // prompts：助手提示词配置。id 是助手标识，name 是展示名称，content 是提示词正文。
    // settings：应用设置，以 key/value 保存；目前 active_prompt 指向当前选择的助手 id。
    // IF NOT EXISTS 表示表已存在则跳过，不会覆盖数据或自动补齐已有表的字段。
    db.exec(`CREATE TABLE IF NOT EXISTS prompts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    // 初始化内置助手：id 已存在时跳过，保留用户对提示词的修改。
    const seedPrompt = db.prepare(
        'INSERT OR IGNORE INTO prompts (id, name, content) VALUES (?, ?, ?)',
    );
    for (const prompt of builtinPrompts) seedPrompt.run(prompt.id, prompt.name, prompt.content);
    // 仅首次设置默认助手为 tools；以后启动不覆盖用户的选择。
    db.prepare(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('active_prompt', 'tools')",
    ).run();
    // 按助手 id 读取一份配置；? 绑定参数，不把外部字符串拼进 SQL。
    const getPrompt = (id: string) =>
        db.prepare('SELECT id, name, content FROM prompts WHERE id = ?').get(id) as
            { id: string; name: string; content: string } | undefined;
    const promptConfig = () => ({
        // 从设置表读取当前助手 id。
        activeId: db.prepare("SELECT value FROM settings WHERE key = 'active_prompt'").get()!
            .value as string,
        // 返回所有助手，按 SQLite 行标识排序（本表通常对应插入顺序）。
        prompts: db.prepare('SELECT id, name, content FROM prompts ORDER BY rowid').all(),
    });
    // sessions：每个会话一行。id 是会话标识，messages 是完整消息数组的 JSON 字符串。
    // 消息不是独立的数据行；单条删除也需要读取数组、修改后整份写回。
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        messages TEXT NOT NULL
    )`);
    // PRAGMA table_info 返回表字段信息，用于判断旧数据库是否需要升级。
    // 缺少 updated 时补列：毫秒时间戳用于会话排序，旧记录初始为0。
    if (
        !(db.prepare('PRAGMA table_info(sessions)').all() as any[]).some(
            (column) => column.name === 'updated',
        )
    ) {
        db.exec('ALTER TABLE sessions ADD COLUMN updated INTEGER NOT NULL DEFAULT 0');
    }
    // 移除已废弃的控制状态列，历史消息与更新时间保持不变。
    if (
        (db.prepare('PRAGMA table_info(sessions)').all() as any[]).some(
            (column) => column.name === 'state',
        )
    ) {
        db.exec('ALTER TABLE sessions DROP COLUMN state');
    }

    // 按会话 id 读取原始 JSON，包括 internal=true 的工具中间消息。
    const read = db.prepare('SELECT messages FROM sessions WHERE id = ?');
    // 每个会话保存完整消息数组；同一 id 再次保存时覆盖并更新排序时间。
    // ON CONFLICT：id 已存在时更新；excluded 表示本次准备写入的新值。
    const write = db.prepare(`INSERT INTO sessions (id, messages, updated) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET messages = excluded.messages, updated = excluded.updated`);
    // 删除整个会话；不会删除 prompts、memories，也不会撤销工具产生的业务操作。
    const remove = db.prepare('DELETE FROM sessions WHERE id = ?');
    const load = (id: string): Message[] => {
        const row = read.get(id);
        if (!row) return [];
        const messages: Message[] = JSON.parse(row.messages as string);
        // 给旧消息补稳定 ID，删除其他消息后定位也不会发生偏移。
        if (messages.some((message) => !message.id)) {
            for (const message of messages) message.id ||= crypto.randomUUID();
            // 将补好消息 id 的数组写回原会话；不修改会话的 updated 排序时间。
            db.prepare('UPDATE sessions SET messages = ? WHERE id = ?').run(
                JSON.stringify(messages),
                id,
            );
        }
        return messages;
    };
    const save = (id: string, messages: Message[]) => {
        for (const message of messages) message.id ||= crypto.randomUUID();
        // 序列化完整消息数组，保存会话并将更新时间设为当前毫秒时间戳。
        write.run(id, JSON.stringify(messages), Date.now());
    };

    return {
        loadMemories(ownerId: string, projectId: string) {
            // 仅取当前用户的通用偏好和当前项目约定，不跨用户或项目读取。
            // 最近更新优先，最多20条；这里尚未按问题相关性检索。
            return db
                .prepare(
                    `
                SELECT scope, key, value FROM memories
                WHERE owner_id = ? AND (
                    (scope = 'user' AND scope_id = '')
                    OR (scope = 'project' AND scope_id = ?)
                )
                ORDER BY updated_at DESC, scope, key
                LIMIT 20
            `,
                )
                .all(ownerId, projectId);
        },
        saveMemory({
            ownerId,
            scope,
            scopeId,
            key,
            value,
        }: {
            ownerId: string;
            scope: 'user' | 'project';
            scopeId: string;
            key: string;
            value: string;
        }) {
            db.prepare(
                `
                INSERT INTO memories(owner_id, scope, scope_id, key, value, updated_at)
                VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, scope, scope_id, key)
                DO UPDATE SET value = excluded.value,
                    updated_at = excluded.updated_at
            `,
            ).run(ownerId, scope, scopeId, key, value, Date.now());

            return { saved: true, key, value, scope };
        },
        promptConfig,
        activePrompt() {
            return getPrompt(promptConfig().activeId)!;
        },
        selectPrompt(id: string) {
            if (typeof id !== 'string' || !getPrompt(id)) throw new Error('提示词配置不存在');
            // 持久化助手选择；下次启动仍使用这个助手，不修改历史消息。
            db.prepare("UPDATE settings SET value = ? WHERE key = 'active_prompt'").run(id);
            return promptConfig();
        },
        savePrompt(data: { id?: string; name: string; content: string }) {
            if (
                typeof data.name !== 'string' ||
                !data.name.trim() ||
                data.name.length > 100 ||
                typeof data.content !== 'string' ||
                !data.content.trim() ||
                data.content.length > 100_000
            )
                throw new Error('提示词名称或内容无效');
            if (data.id !== undefined && (typeof data.id !== 'string' || !getPrompt(data.id)))
                throw new Error('提示词配置不存在');
            const id = data.id ?? crypto.randomUUID();
            // 新 id 新增助手；已有 id 更新名称和正文，再将其设为当前助手。
            db.prepare(
                `INSERT INTO prompts (id, name, content) VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, content = excluded.content`,
            ).run(id, data.name.trim(), data.content.trim());
            return this.selectPrompt(id);
        },
        list() {
            // 按最后更新时间倒序取出会话，最近活动的会话排在最前。
            // 面向页面的列表过滤工具中间消息；load() 则返回完整上下文。
            return db
                .prepare('SELECT id, messages, updated FROM sessions ORDER BY updated DESC')
                .all()
                .map((row) => {
                    const messages = load(row.id as string).filter((message) => !message.internal);
                    return {
                        id: row.id,
                        title:
                            messages
                                .find((message) => message.role === 'user')
                                ?.content.slice(0, 26) || '新的对话',
                        messages,
                        updated: row.updated,
                    };
                });
        },
        load,
        save,
        deleteMessage(id: string, messageId: string) {
            const messages = load(id);
            const index = messages.findIndex(
                (message) => message.id === messageId && !message.internal,
            );
            if (index < 0) return false;
            let start = index,
                end = index + 1;
            if (messages[index].role === 'user') {
                // 删除提问时一并移除该轮回复和工具记录，避免留下无来源的上下文。
                while (
                    end < messages.length &&
                    (messages[end].internal || messages[end].role !== 'user')
                )
                    end++;
            } else {
                // 删除回复时，同时删除产生该回复的隐藏工具调用与结果。
                while (start > 0 && messages[start - 1].internal) start--;
            }
            messages.splice(start, end - start);
            save(id, messages);
            return true;
        },
        clear(id: string) {
            // 执行上面准备好的整会话删除语句。
            remove.run(id);
        },
        close() {
            // 释放数据库连接；由打开此 store 的调用方负责关闭。
            db.close();
        },
    };
}
