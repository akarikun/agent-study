import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
});

// 将模型的 XML 文本转换为工具注册表接受的调用对象，保留文件正文空白。
export function parseToolCall(answer: string) {
    // 自定义工具协议：完整回答能解析出 tool 字段时，按工具调用处理。
    try {
        const data = parser.parse(answer);
        return {
            tool: data?.tool_call?.name,
            params: data?.tool_call?.params ?? {},
        };
    } catch {
        // 非工具输出按普通回答处理，由调用层记录决策。
    }
}
