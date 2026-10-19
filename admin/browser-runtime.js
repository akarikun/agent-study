// 静态站点兼容层：模拟 /api 接口，数据留在访客浏览器，真实模型请求直接发给其配置的服务。
(() => {
  const shared = window.AGENT_BROWSER_BOOTSTRAP;
  if (!shared) return;
  const nativeFetch = window.fetch.bind(window);
  const storageKey = 'agent-browser-data-v1';
  const keys = new Map(); // 密钥不写入 localStorage，也不返回 API 清单。
  const active = new Set();
  const initial = () => ({
    mode: 'demo',
    models: [
      {
        id: 'browser-local',
        name: '本机 Ollama',
        model: 'qwen3:4b',
        url: 'http://localhost:11434/v1/chat/completions',
      },
    ],
    prompts: structuredClone(shared.builtinPrompts),
    activeId: 'tools',
    sessions: [],
    files: {
      'README.md':
        '# Agent Studio\n这是浏览器演示文件，不是服务器或访客电脑中的真实文件。\n支持模拟对话、工具循环、停止生成及浏览器缓存。',
    },
  });
  let data = initial();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (
      saved &&
      Array.isArray(saved.models) &&
      Array.isArray(saved.prompts) &&
      Array.isArray(saved.sessions)
    ) {
      data = { ...data, ...saved };
      data.mode = saved.mode === 'direct' ? 'direct' : 'demo';
      // 仅接受非敏感的模型字段，防止旧缓存意外携带 Key。
      data.models = saved.models.map(({ id, name, model, url }) => ({ id, name, model, url }));
    }
  } catch {
    /* 损坏或禁用的存储不阻止演示启动。 */
  }
  const persist = () => localStorage.setItem(storageKey, JSON.stringify(data));
  const json = (value, status = 200) => Response.json(value, { status });
  const config = () => ({ activeId: data.activeId, prompts: data.prompts });
  const id = () => crypto.randomUUID();
  const exposedModels = () =>
    data.models.map((model) => ({ ...model, hasKey: keys.has(model.id) }));
  const visibleSession = (session) => ({
    ...session,
    messages: session.messages.filter((m) => !m.internal),
  });
  function validateEndpoint(value) {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        '模型地址须为 HTTPS，或本机 localhost HTTP；不能包含账号、密钥、查询参数或片段',
      );
    if (!url.pathname.endsWith('/chat/completions'))
      throw new Error('请填写完整的 /v1/chat/completions 兼容接口地址');
    return url.href;
  }
  function parseCall(answer) {
    if (!answer.trimStart().startsWith('<tool_call')) return null;
    const xml = new DOMParser().parseFromString(answer, 'application/xml');
    if (xml.querySelector('parsererror') || xml.documentElement.tagName !== 'tool_call')
      throw new Error('工具调用 XML 格式无效');
    const params = Object.fromEntries(
      [...(xml.querySelector('params')?.children || [])].map((el) => [el.tagName, el.textContent]),
    );
    return { tool: xml.documentElement.getAttribute('name'), params };
  }
  const toolDefinitions = {
    read_file: {
      readOnly: true,
      description:
        '读取浏览器虚拟文件，参数 path 必填。初始文件只有 README.md。不能访问服务器或用户电脑的真实文件。',
    },
    write_file: {
      readOnly: false,
      description: '写入浏览器虚拟文件，参数 path、content 必填。不会写入真实磁盘。',
    },
    edit_file: {
      readOnly: false,
      description: '修改浏览器虚拟文件，参数 path、oldText、newText 必填。只替换唯一匹配。',
    },
    get_weather: {
      readOnly: true,
      description:
        '查询城市今天的天气，参数 city 必填、countryCode 可选。演示模式返回明确标记的虚构样例；直连模式联网查询 Open-Meteo。',
    },
  };
  async function executeTool(call, mode, signal) {
    if (!Object.hasOwn(toolDefinitions, call.tool)) throw new Error(`未知工具：${call.tool}`);
    if (call.tool === 'get_weather') {
      if (!call.params.city?.trim()) throw new Error('city 必填');
      if (mode === 'demo')
        return {
          demo: true,
          city: call.params.city,
          temperature: 20,
          description: '晴（虚构演示数据，不代表真实天气）',
        };
      const tool = shared.createWeatherTool((url, options) =>
        nativeFetch(url, {
          ...options,
          signal: AbortSignal.any([signal, options.signal]),
        }),
      );
      return tool.execute(call.params);
    }
    const { path, content, oldText, newText } = call.params;
    if (!path?.trim() || path.length > 200) throw new Error('path 必须为有效虚拟文件名');
    if (call.tool === 'read_file') {
      if (!Object.hasOwn(data.files, path)) throw new Error(`虚拟文件不存在：${path}`);
      return { content: data.files[path], virtual: true };
    }
    let value = content;
    if (call.tool === 'edit_file') {
      if (!Object.hasOwn(data.files, path)) throw new Error(`虚拟文件不存在：${path}`);
      if (!oldText || typeof newText !== 'string')
        throw new Error('oldText 必须非空，newText 必须为字符串');
      const parts = data.files[path].split(oldText);
      if (parts.length !== 2) throw new Error('原文必须唯一匹配');
      value = parts.join(newText);
    }
    if (typeof value !== 'string' || value.length > 100_000)
      throw new Error('虚拟文件内容必须为字符串，且不超过 100000 字符');
    data.files = { ...data.files, [path]: value };
    persist();
    return { success: true, path, virtual: true };
  }
  async function* modelChunks(model, messages, signal) {
    let response;
    try {
      response = await nativeFetch(validateEndpoint(model.url), {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(keys.has(model.id) ? { Authorization: `Bearer ${keys.get(model.id)}` } : {}),
        },
        body: JSON.stringify({
          model: model.model,
          messages: messages.map(({ role, content }) => ({ role, content })),
          stream: true,
        }),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(
        '无法连接模型：请确认地址、服务状态、CORS、浏览器本地网络权限；Ollama 需允许当前站点 Origin。HTTPS 页面可能限制 HTTP 请求。',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `模型请求失败：HTTP ${response.status}${[401, 403].includes(response.status) ? '，请检查 API Key 或 Origin 权限' : ''}`,
      );
    }
    if (!response.body) throw new Error('模型没有返回响应流');
    const reader = response.body.getReader();
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    function parseLine(line) {
      if (!line.startsWith('data:')) return null;
      const payload = line.slice(5).trim();
      if (!payload) return null;
      if (payload === '[DONE]') {
        finished = true;
        return null;
      }
      const chunk = JSON.parse(payload);
      if (chunk.error) throw new Error('模型返回错误，请检查配置、额度或服务端日志');
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finished = true;
      return choice?.delta?.content;
    }
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const text = parseLine(buffer.slice(0, end).replace(/\r$/, ''));
          buffer = buffer.slice(end + 1);
          if (text) yield text;
        }
        if (finished) break;
        if (done) {
          const text = parseLine(buffer.trim());
          if (text) yield text;
          if (!finished) throw new Error('模型流提前结束，未收到完成标记');
          break;
        }
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const pause = (signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 35);
      signal.addEventListener('abort', abort, { once: true });
    });
  function demoAnswer(text, messages, round) {
    if (round) {
      const observation = JSON.parse(messages.at(-1).content.slice('工具执行结果：'.length));
      return `**演示模式：模拟回复**\n\n工具执行结果：\n\n\`\`\`json\n${JSON.stringify(observation, null, 2)}\n\`\`\`\n\n此回复由演示逻辑生成，天气数值是虚构样例。切换“浏览器直连”可调用你自己的模型。`;
    }
    if (/天气|气温/.test(text)) {
      const city = ['北京', '上海', '广州', '深圳', '杭州'].find((city) => text.includes(city));
      return city
        ? `<tool_call name="get_weather"><params><city>${city}</city></params></tool_call>`
        : '这是模拟对话。请提供城市，例如“北京今天的天气”。';
    }
    if (/文件|readme/i.test(text))
      return '<tool_call name="read_file"><params><path>README.md</path></params></tool_call>';
    return '**演示模式：模拟回复**\n\n这是无需模型服务的交互演示。你可以问“北京今天的天气”或“读取 README.md”，体验工具调用和流式输出，也可以随时停止。\n\n要真实对话，请切换“浏览器直连”，填写自己的模型地址和名称。';
  }
  async function chat(body, options) {
    if (!body.sessionId || typeof body.text !== 'string' || !body.text.trim())
      throw new Error('消息参数无效');
    if (active.has(body.sessionId)) return json({ error: '该会话正在生成中' }, 409);
    const mode = data.mode;
    const history = structuredClone(
      data.sessions.find((s) => s.id === body.sessionId)?.messages || [],
    );
    const route = shared.routeModel({
      models: data.models,
      modelId: body.modelId,
      autoRoute: body.autoRoute,
      text: body.text,
      history,
    });
    const prompt = data.prompts.find((p) => p.id === data.activeId)?.content;
    if (!prompt) throw new Error('请先选择助手');
    active.add(body.sessionId);
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
      active.delete(body.sessionId);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const signal = controller.signal;
    const timeout = setTimeout(abort, 900_000);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(output) {
        const send = (event) => {
          if (!signal.aborted) output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        void (async () => {
          const messages = [...history, { role: 'user', content: body.text.trim() }];
          try {
            send({
              type: 'route',
              modelId: route.model.id,
              modelName: mode === 'demo' ? '模拟回复（未调用模型）' : route.model.name,
              reason: mode === 'demo' ? '演示模式，不访问模型或外网' : route.reason,
            });
            for (let round = 0; round < 8; round++) {
              signal.throwIfAborted();
              let answer = '';
              let streaming = false;
              const emit = (text) => {
                answer += text;
                if (streaming) send({ type: 'delta', text });
                else if (answer.trimStart() && !['<', '`'].includes(answer.trimStart()[0])) {
                  streaming = true;
                  send({ type: 'delta', text: answer });
                }
              };
              if (mode === 'demo') {
                const result = demoAnswer(body.text, messages, round);
                for (let offset = 0; offset < result.length; offset += 12) {
                  await pause(signal);
                  emit(result.slice(offset, offset + 12));
                }
              } else {
                const context = shared.buildContext(history, messages.slice(history.length));
                for await (const text of modelChunks(
                  route.model,
                  [shared.createSystemMessage(prompt, toolDefinitions), ...context],
                  signal,
                ))
                  emit(text);
              }
              signal.throwIfAborted();
              if (!answer.trim()) throw new Error('模型返回空内容，请检查模型是否支持文本输出');
              const call = parseCall(answer);
              messages.push({
                role: 'assistant',
                content: answer,
                ...(call ? { internal: true } : {}),
              });
              if (!call) {
                if (!streaming) send({ type: 'delta', text: answer });
                for (const message of messages) message.id ||= id();
                const session = {
                  id: body.sessionId,
                  title:
                    messages.find((m) => m.role === 'user' && !m.internal)?.content.slice(0, 26) ||
                    '新的对话',
                  messages,
                  updated: Date.now(),
                };
                const previous = data.sessions;
                data.sessions = [...previous.filter((s) => s.id !== session.id), session];
                try {
                  persist();
                } catch (error) {
                  data.sessions = previous;
                  throw error;
                }
                send({ type: 'done' });
                return;
              }
              send({ type: 'tool', name: call.tool, status: 'running' });
              let result;
              try {
                result = await executeTool(call, mode, signal);
                signal.throwIfAborted();
                send({ type: 'tool', name: call.tool, status: 'done' });
              } catch (error) {
                signal.throwIfAborted();
                result = { error: error.message };
                send({ type: 'tool', name: call.tool, status: 'error', error: error.message });
              }
              messages.push({
                role: 'user',
                content: `工具执行结果：${JSON.stringify(result)}`,
                internal: true,
              });
            }
            throw new Error('工具调用达到 8 次上限，请缩小任务范围');
          } catch (error) {
            send({ type: 'error', message: error.message || '请求失败' });
          } finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', abort);
            active.delete(body.sessionId);
            try {
              output.close();
            } catch {
              /* 用户已取消读取。 */
            }
          }
        })();
      },
      cancel() {
        abort();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  async function dispatch(path, options = {}) {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : {};
    if (path === '/api/runtime') {
      if (method === 'POST') {
        if (active.size) throw new Error('请先停止当前生成');
        if (!['demo', 'direct'].includes(body.mode)) throw new Error('运行模式无效');
        data.mode = body.mode;
        persist();
      }
      return json({ mode: data.mode });
    }
    if (path === '/api/tools')
      return json(Object.entries(toolDefinitions).map(([name, tool]) => ({ name, ...tool })));
    if (path === '/api/models') {
      if (method === 'POST') {
        if (!body.name?.trim() || !body.model?.trim()) throw new Error('模型名称不能为空');
        const url = validateEndpoint(body.url);
        if (body.id && !data.models.some((m) => m.id === body.id))
          throw new Error('模型配置不存在');
        const modelId = body.id || id();
        const previous = data.models.find((m) => m.id === modelId);
        if (previous && previous.url !== url && body.key === undefined) keys.delete(modelId);
        if (body.key !== undefined) {
          if (body.key) keys.set(modelId, String(body.key));
          else keys.delete(modelId);
        }
        data.models = [
          ...data.models.filter((m) => m.id !== modelId),
          { id: modelId, name: body.name.trim(), model: body.model.trim(), url },
        ];
        persist();
      }
      return json(exposedModels());
    }
    if (path.startsWith('/api/models/') && method === 'DELETE') {
      const modelId = decodeURIComponent(path.slice('/api/models/'.length));
      data.models = data.models.filter((m) => m.id !== modelId);
      keys.delete(modelId);
      persist();
      return json(exposedModels());
    }
    if (path === '/api/prompts/active' && method === 'POST') {
      if (!data.prompts.some((p) => p.id === body.id)) throw new Error('提示词配置不存在');
      data.activeId = body.id;
      persist();
      return json(config());
    }
    if (path === '/api/prompts') {
      if (method === 'POST') {
        if (!body.name?.trim() || !body.content?.trim() || body.content.length > 100_000)
          throw new Error('提示词名称或内容无效');
        if (body.id && !data.prompts.some((p) => p.id === body.id))
          throw new Error('提示词配置不存在');
        const prompt = {
          id: body.id || id(),
          name: body.name.trim(),
          content: body.content.trim(),
        };
        data.prompts = [...data.prompts.filter((p) => p.id !== prompt.id), prompt];
        data.activeId = prompt.id;
        persist();
      }
      return json(config());
    }
    if (path === '/api/sessions')
      return json(data.sessions.map(visibleSession).sort((a, b) => b.updated - a.updated));
    if (path.startsWith('/api/sessions/')) {
      const parts = path.split('/');
      const sessionId = decodeURIComponent(parts[3]);
      const session = data.sessions.find((s) => s.id === sessionId);
      if (method === 'DELETE') {
        if (active.has(sessionId)) throw new Error('该会话正在生成中');
        if (parts[4] === 'messages') {
          const index =
            session?.messages.findIndex(
              (m) => m.id === decodeURIComponent(parts[5]) && !m.internal,
            ) ?? -1;
          if (index < 0) return json({ error: '消息不存在' }, 404);
          let start = index,
            end = index + 1;
          if (session.messages[index].role === 'user') {
            while (
              end < session.messages.length &&
              (session.messages[end].internal || session.messages[end].role !== 'user')
            )
              end++;
          } else while (start > 0 && session.messages[start - 1].internal) start--;
          session.messages.splice(start, end - start);
        } else data.sessions = data.sessions.filter((s) => s.id !== sessionId);
        persist();
        return json({ ok: true });
      }
      return json(session ? visibleSession(session).messages : []);
    }
    if (path === '/api/chat' && method === 'POST') return chat(body, options);
    return json({ error: '接口不存在' }, 404);
  }
  window.AgentBrowserRuntime = {
    async fetch(path, options) {
      try {
        return await dispatch(path, options);
      } catch (error) {
        return json({ error: error.message || '浏览器数据操作失败' }, 400);
      }
    },
  };
})();
