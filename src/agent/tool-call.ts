import { XMLParser } from 'fast-xml-parser';

// 将模型的 XML 文本转换为工具注册表接受的调用对象，保留文件正文空白。
export function parseToolCall(answer: string) {
    let call: any;
    // 自定义工具协议：完整回答能解析出 tool 字段时，按工具调用处理。
    try {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            trimValues: false,
            parseTagValue: false,
            parseAttributeValue: false,
        });
        const data = parser.parse(answer);
        call = {
            tool: data?.tool_call?.name,
            params: data?.tool_call?.params ?? {},
        };
    } catch {
        console.log('模型回答不是 xml，按普通文本处理：', answer);
    }

    return call;
}
