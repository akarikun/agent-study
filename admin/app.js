// 配置和会话通过同源 Node 服务读取。
const $ = (selector) => document.querySelector(selector);
const browserRuntime = window.AgentBrowserRuntime;
const appFetch = browserRuntime
  ? browserRuntime.fetch.bind(browserRuntime)
  : window.fetch.bind(window);
let runtimeMode = 'server';
let lastRoute = null;
function routeSignature() {
  return JSON.stringify([
    runtimeMode,
    state.selected,
    state.autoRoute,
    state.models.map(({ id, model, url }) => [id, model, url]),
  ]);
}
function displayEndpoint(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '未配置有效地址';
  }
}
function renderRequestTarget() {
  const target = $('#runtime-target');
  target.hidden = !browserRuntime || runtimeMode !== 'direct';
  if (target.hidden) return;
  const actual = lastRoute?.signature === routeSignature() ? lastRoute : null;
  const model = actual || (!state.autoRoute && state.models.find((m) => m.id === state.selected));
  $('#runtime-target-model').textContent = model
    ? `${actual ? '本轮实际模型' : '待请求模型'}：${model.name} · ${model.model}`
    : state.autoRoute
      ? '自动路由：发送后显示实际选中的模型与地址'
      : '请先配置并选择模型';
  $('#runtime-target-url').textContent = model ? displayEndpoint(model.url) : '';
}
const STORAGE = 'agent-studio-ui-v1';
const freshState = () => ({
  prompt: '',
  selected: 'local',
  autoRoute: false,
  models: [
    {
      id: 'local',
      name: '本地 Qwen',
      model: 'sachasayan/interimlabs-huihui-qwen3.5-4b-abliterated:q4_k_m',
      url: 'http://localhost:11434/v1/chat/completions',
    },
  ],
  sessions: [],
  current: null,
});
let state = freshState();
let legacyPrompt;
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE));
  if (typeof saved?.prompt === 'string') legacyPrompt = saved.prompt;
  if (saved && Array.isArray(saved.models) && Array.isArray(saved.sessions))
    state = { ...state, ...saved };
} catch {
  /* 存储不可用或数据损坏时使用默认页面。 */
}

let busy = false;
let ready = false;
let chatController = null;
$('#stop-generation').onclick = () => {
  if (!chatController || chatController.signal.aborted) return;
  $('#stop-generation').disabled = true;
  chatController.abort();
};
let promptConfig = { activeId: '', prompts: [] };
let waitingMessage = null;
let waitingText = '正在思考';
function setBusy(value) {
  busy = value;
  $('.send-button').disabled = value;
  for (const selector of ['#chat-prompt', '#prompt-profile', '#save-prompt', '#new-prompt'])
    $(selector).disabled = value || !ready;
  $('#runtime-mode').disabled = value || !ready;
}
async function api(path, options) {
  const response = await appFetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function refreshSessions() {
  state.sessions = await api('/api/sessions');
  renderSessions();
  renderChat();
}
async function loadTools() {
  const list = $('#tool-list');
  try {
    const tools = await api('/api/tools');
    list.replaceChildren();
    if (!tools.length) list.append(node('div', 'field-note', '暂无可用工具'));
    for (const tool of tools) {
      const item = node('details', 'tool-item');
      item.append(
        node('summary', '', `${tool.name} · ${tool.readOnly ? '只读' : '可写 / 有副作用'}`),
        node('p', 'field-note', tool.description),
      );
      list.append(item);
    }
  } catch (error) {
    list.textContent = `工具列表加载失败：${error.message}`;
  }
}
async function initialize() {
  // 工具清单失败不影响聊天服务初始化。
  loadTools();
  try {
    if (browserRuntime) {
      runtimeMode = (await api('/api/runtime')).mode;
      $('#runtime-controls').hidden = false;
      $('#runtime-mode').value = runtimeMode;
      $('#sidebar-storage-note').innerText =
        '会话和配置保存在此浏览器\nAPI Key 仅保留在当前页面内存';
      $('#model-storage-note').textContent =
        '配置只保存在当前浏览器。API Key 仅保留在页面内存，刷新后需重新填写；请求直接发往你配置的地址。请勿在公共设备输入长期密钥。';
      $('#key-storage-note').textContent = '可选，仅当前页面内存，刷新后清除';
      $('#prompt-storage-note').textContent = '保存到当前浏览器';
      $('#prompt-selection-note').textContent =
        '选择保存在此浏览器中的助手，下一轮生效。不同任务建议新建对话。';
      $('#chat-storage-label').textContent = '浏览器会话';
      $('#local-service-label').textContent = '浏览器 Agent';
      $('#connection-help').hidden = false;
    }
    state.models = await api('/api/models');
    applyPromptConfig(await api('/api/prompts'));
    if (!state.models.some((model) => model.id === state.selected))
      state.selected = state.models[0]?.id || '';
    await refreshSessions();
    ready = true;
    setBusy(false);
    renderModels();
    renderChat();
    updateRuntimeLabel();
  } catch (error) {
    toast(`初始化失败：${error.message}${browserRuntime ? '' : '，请通过 Node 服务打开页面'}`);
  }
}
function updateRuntimeLabel() {
  $('.preview-tag').textContent = browserRuntime
    ? runtimeMode === 'demo'
      ? '演示模式 · 模拟回复'
      : '浏览器直连 · 按需请求'
    : 'Agent 已连接';
  if (browserRuntime)
    $('#runtime-note').textContent =
      runtimeMode === 'demo'
        ? '演示模式不调用模型或外网，天气为虚构样例。'
        : '真实请求由此浏览器发往你的模型服务；localhost 指访问者自己的电脑。';
  renderRequestTarget();
}
$('#runtime-mode').onchange = async (event) => {
  if (busy || !ready) return;
  setBusy(true);
  try {
    runtimeMode = (
      await api('/api/runtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: event.target.value }),
      })
    ).mode;
    updateRuntimeLabel();
  } catch (error) {
    event.target.value = runtimeMode;
    toast(error.message);
  } finally {
    setBusy(false);
    renderChat();
  }
};
let editing = null;
let toastTimer;
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 3000);
}
function save() {
  try {
    localStorage.setItem(
      STORAGE,
      JSON.stringify({
        ...(legacyPrompt ? { prompt: legacyPrompt } : {}),
        selected: state.selected,
        autoRoute: state.autoRoute,
        current: state.current,
        models: [],
        sessions: [],
      }),
    );
  } catch {
    toast('浏览器存储不可用，本次修改仅在当前页面保留');
  }
}
function id() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
const pageNames = {
  chat: '对话工作台',
  prompt: '系统提示词',
  models: '模型配置',
  tools: '工具扩展',
  sessions: '会话记录',
};
function navigate(page) {
  if (!pageNames[page]) page = 'chat';
  document
    .querySelectorAll('.page')
    .forEach((section) => (section.hidden = section.id !== `page-${page}`));
  document
    .querySelectorAll('[data-page]')
    .forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  $('#breadcrumb').textContent = pageNames[page];
  if (location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  if (page === 'sessions') renderSessions();
  if (page === 'models') renderModels();
}
function newChat() {
  if (busy) return toast('请等待当前回答完成');
  $('#tool-errors').replaceChildren();
  $('#tool-errors').hidden = true;
  state.current = null;
  save();
  renderChat();
  navigate('chat');
  $('#chat-input').focus();
}
function renderChat() {
  const session = state.sessions.find((item) => item.id === state.current);
  $('#clear-context').disabled = busy || !ready || !session;
  $('#chat-title').textContent = session?.title || '新的对话';
  const messages = $('#messages');
  messages.replaceChildren();
  if (!session?.messages.length) {
    const welcome = node('div', 'welcome');
    welcome.append(
      node('div', 'welcome-icon', '✦'),
      node('h2', '', '今天，想一起做点什么？'),
      node('p', '', '从一个问题开始，或整理下一项任务。\n这里是你的 Agent 工作空间。'),
    );
    const suggestions = node('div', 'suggestions');
    for (const text of browserRuntime
      ? ['北京今天的天气', '读取 README.md', '解释 Agent 的工具调用流程']
      : ['梳理一个项目的结构', '优化我的系统提示词', '规划下一步开发任务']) {
      const button = node('button', '', text);
      button.type = 'button';
      button.onclick = () => {
        $('#chat-input').value = text;
        $('#chat-input').focus();
      };
      suggestions.append(button);
    }
    welcome.append(suggestions);
    messages.append(welcome);
  } else {
    for (const message of session.messages) {
      const bubble = node('div', `message ${message.role === 'assistant' ? 'assistant' : 'user'}`);
      const header = node('div', 'message-header');
      const remove = node('button', 'message-delete', '删除');
      remove.type = 'button';
      remove.disabled = busy || !ready;
      remove.setAttribute(
        'aria-label',
        message.role === 'assistant' ? '删除助手回复' : '删除用户消息',
      );
      remove.onclick = () => deleteMessage(session, message);
      header.append(
        node('div', 'message-label', message.role === 'assistant' ? '助手' : '你'),
        remove,
      );
      bubble.append(header);
      if (message.role === 'assistant') {
        if (message.content) bubble.append(renderMarkdown(message.content));
        if (message === waitingMessage) bubble.append(renderWaiting(waitingText));
      } else bubble.append(node('div', '', message.content));
      messages.append(bubble);
    }
  }
  messages.scrollTop = messages.scrollHeight;
  $('#prompt-preview').textContent = state.prompt || '尚未设置系统提示词';
  const select = $('#chat-model');
  select.replaceChildren();
  for (const model of state.models) {
    const option = node('option', '', model.name);
    option.value = model.id;
    select.append(option);
  }
  if (!state.models.length) {
    const option = node('option', '', '请先添加模型');
    option.value = '';
    select.append(option);
  }
  select.value = state.selected || '';
  select.disabled = busy || state.autoRoute || !state.models.length;
  $('#auto-route').checked = state.autoRoute === true;
  if ($('#plan-execute')) $('#plan-execute').disabled = busy || !!browserRuntime;
  if ($('#multi-agent')) $('#multi-agent').disabled = busy || !!browserRuntime;
  $('#auto-route').disabled = busy;
  $('#routing-note').textContent = state.autoRoute
    ? '按任务规则自动选择本地模型；手动选择暂不生效。'
    : '使用下方手动选择的模型。';
  renderRequestTarget();
}
function ensureSession(text = '新的对话') {
  let session = state.sessions.find((item) => item.id === state.current);
  if (!session) {
    session = { id: id(), title: text.slice(0, 26), messages: [], updated: Date.now() };
    state.sessions.unshift(session);
    state.current = session.id;
  }
  return session;
}
async function deleteMessage(session, message) {
  if (busy || !ready) return;
  const question =
    message.role === 'user'
      ? '确定删除这条提问及对应回复吗？相关工具记录也会从上下文删除，无法撤销。'
      : '确定删除这条回复吗？相关工具记录也会从上下文删除，无法撤销。';
  if (!confirm(question)) return;
  setBusy(true);
  renderChat();
  try {
    if (message.id) {
      await api(
        `/api/sessions/${encodeURIComponent(session.id)}/messages/${encodeURIComponent(message.id)}`,
        { method: 'DELETE' },
      );
      // 同步隐藏上下文删除后的完整会话，避免后续请求重新带回已删除内容。
      await refreshSessions();
    } else {
      // 失败轮次未保存到 SQLite，只移除页面内的临时消息。
      const start = session.messages.indexOf(message);
      let end = start + 1;
      if (message.role === 'user')
        while (end < session.messages.length && session.messages[end].role !== 'user') end++;
      if (start >= 0) session.messages.splice(start, end - start);
      renderSessions();
    }
    save();
    toast('消息及相关上下文已删除');
  } catch (error) {
    toast(`删除失败：${error.message}`);
  } finally {
    setBusy(false);
    renderChat();
  }
}
$('#clear-context').onclick = async () => {
  const session = state.sessions.find((item) => item.id === state.current);
  if (busy || !ready || !session) return;
  if (!confirm('确定清空当前会话的上下文吗？历史消息将被删除，此操作无法撤销。')) return;
  setBusy(true);
  renderChat();
  try {
    // 复用会话删除接口，确保清理的是 SQLite 上下文，而非仅清空聊天气泡。
    await api('/api/sessions/' + encodeURIComponent(session.id), { method: 'DELETE' });
    state.sessions = state.sessions.filter((item) => item.id !== session.id);
    state.current = null;
    save();
    renderSessions();
    toast('当前会话上下文已清空');
  } catch (error) {
    toast(`清空失败：${error.message}`);
  } finally {
    setBusy(false);
    renderChat();
    $('#chat-input').focus();
  }
};
$('#chat-form').onsubmit = (event) => {
  event.preventDefault();
  const text = $('#chat-input').value.trim();
  if (text) sendMessage(text);
};
async function sendMessage(text) {
  if (!ready) return toast('Agent 服务尚未连接');
  if (busy) return;
  if (!state.selected) return toast('请先添加模型');
  const session = ensureSession(text);
  const controller = new AbortController();
  chatController = controller;
  $('#stop-generation').hidden = false;
  $('#stop-generation').disabled = false;
  const assistant = { role: 'assistant', content: '' };
  $('#tool-errors').replaceChildren();
  $('#tool-errors').hidden = true;
  const planProgress = $('#plan-progress');
  if (planProgress) {
    planProgress.textContent = '';
    planProgress.hidden = true;
  }
  waitingMessage = assistant;
  waitingText = '正在思考';
  session.messages.push({ role: 'user', content: text }, assistant);
  session.updated = Date.now();
  setBusy(true);
  $('#chat-input').value = '';
  $('#route-result').textContent = '正在选择模型…';
  lastRoute = null;
  save();
  renderChat();
  let completed = false;
  let toolWaitTimer;
  const stopToolWaitTimer = () => {
    clearInterval(toolWaitTimer);
    toolWaitTimer = undefined;
  };
  controller.signal.addEventListener(
    'abort',
    () => {
      stopToolWaitTimer();
      waitingMessage = null;
      renderChat();
    },
    { once: true },
  );
  try {
    const response = await appFetch('/api/chat', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        text,
        modelId: state.selected,
        autoRoute: state.autoRoute === true,
        planExecute: !browserRuntime && $('#plan-execute')?.checked === true,
        multiAgent: !browserRuntime && $('#multi-agent')?.checked === true,
      }),
    });
    if (!response.ok) throw new Error((await response.json()).error || '请求失败');
    for await (const event of readChatEvents(response, controller.signal)) {
      if (controller.signal.aborted) break;
      if (event.type === 'route') {
        const model = state.models.find((item) => item.id === event.modelId);
        if (model) lastRoute = { ...model, signature: routeSignature() };
        renderRequestTarget();
        $('#route-result').textContent = `本次模型：${event.modelName}。${event.reason}`;
      }
      if (event.type === 'delta') {
        stopToolWaitTimer();
        waitingMessage = null;
        assistant.content += event.text;
        renderChat();
      }
      if (event.type === 'plan') {
        stopToolWaitTimer();
        const labels = { pending: '待执行', running: '执行中', done: '已完成', blocked: '已暂停' };
        if (planProgress) {
          planProgress.hidden = false;
          planProgress.textContent =
            event.status === 'planning'
              ? '正在生成计划…'
              : event.steps
                  .map(
                    (step, index) =>
                      `${index + 1}. [${labels[step.status]}] ${step.title}${step.result ? `\n   ${step.result}` : ''}`,
                  )
                  .join('\n');
        }
        waitingMessage = assistant;
        waitingText =
          event.status === 'planning' ? '正在规划任务（最长 60 秒）' : '正在根据计划处理任务';
        renderChat();
      }
      if (event.type === 'review') {
        stopToolWaitTimer();
        waitingMessage = assistant;
        if (event.status === 'running') {
          const startedAt = Date.now();
          const updateReviewWait = () => {
            const elapsed = Math.floor((Date.now() - startedAt) / 1000);
            const limit = event.timeoutMs ? `，最长 ${Math.ceil(event.timeoutMs / 1000)} 秒` : '';
            waitingText = `正在复查答案（已等待 ${elapsed} 秒${limit}）`;
          };
          updateReviewWait();
          toolWaitTimer = setInterval(() => {
            updateReviewWait();
            renderChat();
          }, 1000);
        } else waitingText = '复查完成，正在输出';
        renderChat();
      }
      if (event.type === 'tool') {
        stopToolWaitTimer();
        waitingMessage = assistant;
        if (event.status === 'error') {
          const errors = $('#tool-errors');
          errors.hidden = false;
          const detail = node('details', 'tool-error');
          const summary = node('summary', 'tool-error-summary');
          const message = event.error || '未知错误';
          const description = /ENOENT/.test(message)
            ? '未找到文件'
            : /EACCES|EPERM/.test(message)
              ? '没有访问权限'
              : '执行失败';
          summary.append(
            node('span', 'tool-error-icon', '!'),
            node('code', 'tool-error-name', event.name),
            node('span', 'tool-error-description', description),
            node('span', 'tool-error-expand', '详情'),
          );
          detail.append(summary, node('pre', 'tool-error-detail', message));
          errors.append(detail);
          errors.scrollTop = errors.scrollHeight;
          const startedAt = Date.now();
          const updateToolWait = () => {
            const seconds = Math.floor((Date.now() - startedAt) / 1000);
            waitingText = `工具失败，模型正在决定下一步 (${seconds}) `;
          };
          updateToolWait();
          toolWaitTimer = setInterval(() => {
            updateToolWait();
            renderChat();
          }, 1000);
        } else {
          waitingText = event.status === 'running' ? `正在调用 ${event.name}` : '正在整理工具结果';
        }
        renderChat();
      }
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'done') {
        stopToolWaitTimer();
        completed = true;
        chatController = null;
        $('#stop-generation').hidden = true;
        waitingMessage = null;
        renderChat();
        break;
      }
    }
    if (!completed) throw new Error('连接中断，回答未保存');
    await refreshSessions();
  } catch (error) {
    stopToolWaitTimer();
    waitingMessage = null;
    const stopped = controller.signal.aborted;
    assistant.content += stopped
      ? '\n[已停止生成]'
      : `\n[失败：${error.message}。本轮未保存，请重试。]`;
    $('#chat-input').value = text;
    renderChat();
    toast(stopped ? '已停止生成' : error.message);
  } finally {
    stopToolWaitTimer();
    chatController = null;
    $('#stop-generation').hidden = true;
    waitingMessage = null;
    setBusy(false);
    renderChat();
    save();
  }
}

// 网络分块只在这里拼接为 SSE 事件，发送流程只关注回答和工具状态。
async function* readChatEvents(response, signal) {
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) yield JSON.parse(line.slice(5));
        }
      }
      if (done) break;
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
$('#chat-input').onkeydown = (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('#chat-form').requestSubmit();
  }
};
$('#chat-model').onchange = (event) => {
  state.selected = event.target.value;
  renderRequestTarget();
  save();
};
$('#auto-route').onchange = (event) => {
  state.autoRoute = event.target.checked;
  $('#route-result').textContent = '';
  save();
  renderChat();
};
$('#new-chat').onclick = newChat;
$('#session-new').onclick = newChat;
function applyPromptConfig(config) {
  promptConfig = config;
  const active = config.prompts.find((prompt) => prompt.id === config.activeId);
  state.prompt = active?.content || '';
  for (const selector of ['#chat-prompt', '#prompt-profile']) {
    const select = $(selector);
    select.replaceChildren();
    for (const prompt of config.prompts) {
      const option = node('option', '', prompt.name);
      option.value = prompt.id;
      select.append(option);
    }
    select.value = config.activeId;
  }
  $('#prompt-name').value = active?.name || '';
  $('#prompt-editor').value = state.prompt;
  countPrompt();
  renderChat();
}
async function switchPrompt(event) {
  if (!ready || busy) return;
  const dirty =
    $('#prompt-editor').value !== state.prompt ||
    $('#prompt-name').value !==
      promptConfig.prompts.find((p) => p.id === promptConfig.activeId)?.name;
  if (dirty && !confirm('编辑内容尚未保存，切换会放弃这些修改。继续？')) {
    event.target.value = promptConfig.activeId;
    return;
  }
  setBusy(true);
  try {
    applyPromptConfig(
      await api('/api/prompts/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: event.target.value }),
      }),
    );
    toast('助手已切换，下一轮生效；不同任务建议新建对话');
  } catch (error) {
    event.target.value = promptConfig.activeId;
    toast(error.message);
  } finally {
    setBusy(false);
    renderChat();
  }
}
$('#chat-prompt').onchange = switchPrompt;
$('#prompt-profile').onchange = switchPrompt;
function countPrompt() {
  $('#prompt-count').textContent = `${$('#prompt-editor').value.length} 字符`;
}
$('#prompt-editor').oninput = countPrompt;
countPrompt();
async function persistPrompt(create = false) {
  if (!ready || busy) return;
  const name = create ? window.prompt('新助手名称', '自定义助手') : $('#prompt-name').value;
  if (name === null) return;
  setBusy(true);
  try {
    applyPromptConfig(
      await api('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(create ? {} : { id: promptConfig.activeId }),
          name,
          content: $('#prompt-editor').value,
        }),
      }),
    );
    toast(`提示词已保存到${browserRuntime ? '浏览器' : ' SQLite'}，下一轮生效`);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    renderChat();
  }
}
$('#save-prompt').onclick = () => persistPrompt();
$('#new-prompt').onclick = () => persistPrompt(true);
$('#import-prompt').onclick = () => {
  try {
    const legacy = JSON.parse(localStorage.getItem(STORAGE));
    if (!legacy?.prompt) return toast('没有找到旧的浏览器提示词');
    $('#prompt-editor').value = legacy.prompt;
    countPrompt();
    toast('旧提示词已载入编辑器，保存或另存为新助手后生效');
  } catch {
    toast('无法读取旧提示词');
  }
};
$('#reset-prompt').onclick = () => {
  if (!confirm('放弃修改，恢复当前助手已保存的内容？')) return;
  $('#prompt-editor').value = state.prompt;
  $('#prompt-name').value =
    promptConfig.prompts.find((p) => p.id === promptConfig.activeId)?.name || '';
  countPrompt();
  toast('已恢复保存内容');
};
function openModel(model = null) {
  editing = model?.id ?? null;
  $('#model-form').reset();
  $('#dialog-title').textContent = model ? '编辑模型' : '添加模型';
  for (const name of ['name', 'model', 'url'])
    $('#model-form').elements.namedItem(name).value = model?.[name] ?? '';
  $('#model-form').elements.namedItem('key').value = '';
  $('#model-form').elements.namedItem('key').placeholder = model?.hasKey
    ? '已配置，留空保留；输入新值替换'
    : '不需要时留空';
  $('#model-dialog').showModal();
}
$('#add-model').onclick = () => openModel();
$('#close-dialog').onclick = $('#cancel-dialog').onclick = () => $('#model-dialog').close();
$('#model-form').onsubmit = async (event) => {
  try {
    event.preventDefault();
    const data = new FormData(event.target);
    const url = data.get('url').trim();
    if (!['http:', 'https:'].includes(new URL(url).protocol)) {
      toast('请求地址请使用 http 或 https');
      return;
    }
    const model = {
      id: editing ?? id(),
      name: data.get('name').trim(),
      url,
      model: data.get('model').trim(),
    };
    if (!model.name || !model.model) {
      toast('名称不能为空');
      return;
    }
    const key = data.get('key').trim();
    state.models = await api('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...model, id: editing, ...(key ? { key } : {}) }),
    });
    if (!state.selected) state.selected = state.models.at(-1)?.id || '';
    save();
    renderModels();
    renderChat();
    $('#model-dialog').close();
    $('#model-form').reset();
    toast(
      browserRuntime
        ? '配置已保存到浏览器；切换浏览器直连后发送消息进行验证'
        : '模型配置已保存到服务端',
    );
  } catch (error) {
    toast(error.message);
  }
};
function renderModels() {
  const grid = $('#model-grid');
  grid.replaceChildren();
  if (!state.models.length) {
    grid.append(node('div', 'empty-card', '还没有模型，点击“添加模型”创建配置。'));
    return;
  }
  for (const model of state.models) {
    const card = node('article', 'model-card');
    const top = node('div', 'model-top');
    top.append(
      node('span', 'model-icon', '◇'),
      node('span', 'model-badge', model.id === state.selected ? '当前选择' : '可选'),
    );
    card.append(top, node('h3', '', model.name), node('div', 'model-name', model.model));
    const detail = node('div', 'model-detail');
    for (const [label, value] of [
      ['请求地址', model.url],
      ['API Key', model.hasKey ? (browserRuntime ? '当前页面已配置' : '已在服务端配置') : '未设置'],
    ]) {
      const row = node('div');
      row.append(node('span', '', label), node('code', '', value));
      detail.append(row);
    }
    const actions = node('div', 'model-actions');
    const use = node(
      'button',
      'text-button',
      model.id === state.selected ? '✓ 当前模型' : '设为当前',
    );
    use.disabled = model.id === state.selected;
    use.onclick = () => {
      state.selected = model.id;
      save();
      renderModels();
      renderChat();
      toast('已切换页面中的当前模型');
    };
    const group = node('div');
    const edit = node('button', 'text-button', '编辑');
    edit.onclick = () => openModel(model);
    const remove = node('button', 'text-button danger', '删除');
    remove.onclick = async () => {
      if (!confirm(`删除模型配置“${model.name}”？`)) return;
      try {
        state.models = await api('/api/models/' + encodeURIComponent(model.id), {
          method: 'DELETE',
        });
        if (state.selected === model.id) state.selected = state.models[0]?.id ?? '';
        save();
        renderModels();
        renderChat();
      } catch (error) {
        toast(error.message);
      }
    };
    group.append(edit, remove);
    actions.append(use, group);
    card.append(detail, actions);
    grid.append(card);
  }
}
function renderSessions() {
  const search = $('#session-search').value.trim().toLowerCase();
  const sessions = state.sessions
    .filter((item) => item.title.toLowerCase().includes(search))
    .sort((a, b) => b.updated - a.updated);
  $('#session-count').textContent = state.sessions.length;
  const list = $('#session-list');
  list.replaceChildren();
  if (!sessions.length) {
    const row = node('tr');
    const cell = node(
      'td',
      'empty-table',
      search ? '没有匹配的会话' : '还没有会话，去工作台写下第一条消息吧。',
    );
    cell.colSpan = 4;
    row.append(cell);
    list.append(row);
    return;
  }
  for (const session of sessions) {
    const row = node('tr');
    row.append(
      node('td', '', session.title),
      node('td', '', session.messages.length),
      node(
        'td',
        '',
        new Date(session.updated).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
      ),
    );
    const actions = node('td');
    const open = node('button', 'text-button', '打开');
    open.onclick = () => {
      if (busy) return toast('请等待当前回答完成');
      state.current = session.id;
      save();
      renderChat();
      navigate('chat');
    };
    const remove = node('button', 'text-button danger', '删除');
    remove.onclick = async () => {
      if (busy) return toast('请等待当前回答完成');
      if (!confirm(`删除会话“${session.title}”？`)) return;
      try {
        await api('/api/sessions/' + encodeURIComponent(session.id), { method: 'DELETE' });
        if (state.current === session.id) state.current = null;
        await refreshSessions();
        save();
      } catch (error) {
        toast(error.message);
      }
    };
    actions.append(open, remove);
    row.append(actions);
    list.append(row);
  }
}
$('#session-search').oninput = renderSessions;
document
  .querySelectorAll('[data-page]')
  .forEach((button) => (button.onclick = () => navigate(button.dataset.page)));
document
  .querySelectorAll('[data-open]')
  .forEach((button) => (button.onclick = () => navigate(button.dataset.open)));
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
state.models = [];
state.sessions = [];
renderChat();
renderModels();
renderSessions();
navigate(location.hash.slice(1));
initialize();
