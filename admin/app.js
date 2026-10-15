// 配置和会话通过同源 Node 服务读取。
const $ = (selector) => document.querySelector(selector);
const STORAGE = 'agent-studio-ui-v1';
const defaultPrompt = `你是一个简洁、准确的助手，帮助用户完成任务。

能根据已有知识或对话内容完成的任务，直接回答。
需要访问外部数据或执行操作时，使用可用工具。

工具规则：
- 只使用已提供的工具，缺少必要参数时先询问用户。
- 不编造结果，不声称尚未完成的操作已成功。
- 收到工具结果后继续处理，信息足够时直接回答。`;
const freshState = () => ({
  prompt: defaultPrompt,
  selected: 'local',
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
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE));
  if (
    saved &&
    typeof saved.prompt === 'string' &&
    Array.isArray(saved.models) &&
    Array.isArray(saved.sessions)
  )
    state = { ...state, ...saved };
} catch {
  /* 存储不可用或数据损坏时使用默认页面。 */
}

let busy = false;
let ready = false;
let waitingMessage = null;
let waitingText = '正在思考';
function setBusy(value) {
  busy = value;
  $('.send-button').disabled = value;
}
async function api(path, options) {
  const response = await fetch(path, options);
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
    state.models = await api('/api/models');
    if (!state.models.some((model) => model.id === state.selected))
      state.selected = state.models[0]?.id || '';
    await refreshSessions();
    ready = true;
    renderModels();
    renderChat();
    $('.preview-tag').textContent = 'Agent 已连接';
  } catch (error) {
    toast(`连接失败：${error.message}，请通过 Node 服务打开页面`);
  }
}
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
        prompt: state.prompt,
        selected: state.selected,
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
    for (const text of ['梳理一个项目的结构', '优化我的系统提示词', '规划下一步开发任务']) {
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
  select.disabled = !state.models.length;
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
  const assistant = { role: 'assistant', content: '' };
  waitingMessage = assistant;
  waitingText = '正在思考';
  session.messages.push({ role: 'user', content: text }, assistant);
  session.updated = Date.now();
  setBusy(true);
  $('#chat-input').value = '';
  save();
  renderChat();
  let completed = false;
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        text,
        modelId: state.selected,
        prompt: state.prompt,
      }),
    });
    if (!response.ok) throw new Error((await response.json()).error || '请求失败');
    for await (const event of readChatEvents(response)) {
      if (event.type === 'delta') {
        waitingMessage = null;
        assistant.content += event.text;
        renderChat();
      }
      if (event.type === 'tool') {
        waitingMessage = assistant;
        waitingText = event.status === 'running' ? `正在调用 ${event.name}` : '正在整理工具结果';
        renderChat();
      }
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'done') completed = true;
    }
    if (!completed) throw new Error('连接中断，回答未保存');
    await refreshSessions();
  } catch (error) {
    waitingMessage = null;
    assistant.content += `\n[失败：${error.message}。本轮未保存，请重试。]`;
    $('#chat-input').value = text;
    renderChat();
    toast(error.message);
  } finally {
    waitingMessage = null;
    setBusy(false);
    renderChat();
    save();
  }
}

// 网络分块只在这里拼接为 SSE 事件，发送流程只关注回答和工具状态。
async function* readChatEvents(response) {
  const reader = response.body.getReader();
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
  save();
};
$('#new-chat').onclick = newChat;
$('#session-new').onclick = newChat;
$('#prompt-editor').value = state.prompt;
function countPrompt() {
  $('#prompt-count').textContent = `${$('#prompt-editor').value.length} 字符`;
}
$('#prompt-editor').oninput = countPrompt;
countPrompt();
$('#save-prompt').onclick = () => {
  state.prompt = $('#prompt-editor').value;
  save();
  renderChat();
  toast('提示词已保存到浏览器');
};
$('#reset-prompt').onclick = () => {
  if (!confirm('将编辑器内容恢复为默认提示词？')) return;
  $('#prompt-editor').value = defaultPrompt;
  countPrompt();
  toast('已恢复默认，点击保存后生效');
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
    if (!state.selected) state.selected = model.id;
    save();
    renderModels();
    renderChat();
    $('#model-dialog').close();
    $('#model-form').reset();
    toast('模型配置已保存到服务端');
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
      ['API Key', model.hasKey ? '已在服务端配置' : '未设置'],
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
