// 仅前端演示：普通配置存在浏览器，密钥只保留在当前页面内存中。
const $ = selector => document.querySelector(selector);
const STORAGE = 'agent-studio-ui-v1';
const defaultPrompt = `你是一个简洁、准确的助手，帮助用户完成任务。

能根据已有知识或对话内容完成的任务，直接回答。
需要访问外部数据或执行操作时，使用可用工具。

工具规则：
- 只使用已提供的工具，缺少必要参数时先询问用户。
- 不编造结果，不声称尚未完成的操作已成功。
- 收到工具结果后继续处理，信息足够时直接回答。`;
const freshState = () => ({ prompt: defaultPrompt, selected: 'local', models: [{ id: 'local', name: '本地 Qwen', model: 'sachasayan/interimlabs-huihui-qwen3.5-4b-abliterated:q4_k_m', url: 'http://localhost:11434/v1/chat/completions' }], sessions: [], current: null });
let state = freshState();
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE));
  if (saved && typeof saved.prompt === 'string' && Array.isArray(saved.models) && Array.isArray(saved.sessions)) state = { ...state, ...saved };
} catch { /* 存储不可用或数据损坏时使用默认页面。 */ }
const keys = new Map();
let editing = null;
let toastTimer;
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3000); }
function save() {
  try { localStorage.setItem(STORAGE, JSON.stringify(state)); }
  catch { toast('浏览器存储不可用，本次修改仅在当前页面保留'); }
}
function id() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
const pageNames = { chat: '对话工作台', prompt: '系统提示词', models: '模型配置', sessions: '会话记录' };
function navigate(page) {
  if (!pageNames[page]) page = 'chat';
  document.querySelectorAll('.page').forEach(section => section.hidden = section.id !== `page-${page}`);
  document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('#breadcrumb').textContent = pageNames[page];
  if (location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  if (page === 'sessions') renderSessions();
  if (page === 'models') renderModels();
}
function newChat() { state.current = null; save(); renderChat(); navigate('chat'); $('#chat-input').focus(); }
function renderChat() {
  const session = state.sessions.find(item => item.id === state.current);
  $('#chat-title').textContent = session?.title || '新的对话';
  const messages = $('#messages'); messages.replaceChildren();
  if (!session?.messages.length) {
    const welcome = node('div', 'welcome');
    welcome.append(node('div', 'welcome-icon', '✦'), node('h2', '', '今天，想一起做点什么？'), node('p', '', '从一个问题开始，或整理下一项任务。\n这里是你的 Agent 工作空间。'));
    const suggestions = node('div', 'suggestions');
    for (const text of ['梳理一个项目的结构', '优化我的系统提示词', '规划下一步开发任务']) {
      const button = node('button', '', text); button.type = 'button';
      button.onclick = () => { $('#chat-input').value = text; $('#chat-input').focus(); };
      suggestions.append(button);
    }
    welcome.append(suggestions); messages.append(welcome);
  } else {
    for (const message of session.messages) {
      const bubble = node('div', 'message user');
      bubble.append(node('div', 'message-label', '你'), node('div', '', message.content)); messages.append(bubble);
    }
  }
  messages.scrollTop = messages.scrollHeight;
  $('#prompt-preview').textContent = state.prompt || '尚未设置系统提示词';
  const select = $('#chat-model'); select.replaceChildren();
  for (const model of state.models) { const option = node('option', '', model.name); option.value = model.id; select.append(option); }
  if (!state.models.length) { const option = node('option', '', '请先添加模型'); option.value = ''; select.append(option); }
  select.value = state.selected || ''; select.disabled = !state.models.length;
}
$('#chat-form').onsubmit = event => {
  event.preventDefault(); const text = $('#chat-input').value.trim(); if (!text) return;
  let session = state.sessions.find(item => item.id === state.current);
  if (!session) { session = { id: id(), title: text.slice(0, 26), messages: [], updated: Date.now() }; state.sessions.unshift(session); state.current = session.id; }
  session.messages.push({ content: text }); session.updated = Date.now();
  $('#chat-input').value = ''; save(); renderChat(); toast('消息已保存为本地草稿，暂未连接模型');
};
$('#chat-input').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#chat-form').requestSubmit(); } };
$('#chat-model').onchange = event => { state.selected = event.target.value; save(); };
$('#new-chat').onclick = newChat; $('#session-new').onclick = newChat;
$('#prompt-editor').value = state.prompt;
function countPrompt() { $('#prompt-count').textContent = `${$('#prompt-editor').value.length} 字符`; }
$('#prompt-editor').oninput = countPrompt; countPrompt();
$('#save-prompt').onclick = () => { state.prompt = $('#prompt-editor').value; save(); renderChat(); toast('提示词已保存到浏览器'); };
$('#reset-prompt').onclick = () => { if (!confirm('将编辑器内容恢复为默认提示词？')) return; $('#prompt-editor').value = defaultPrompt; countPrompt(); toast('已恢复默认，点击保存后生效'); };
function openModel(model = null) {
  editing = model?.id ?? null; $('#model-form').reset(); $('#dialog-title').textContent = model ? '编辑模型' : '添加模型';
  for (const name of ['name', 'model', 'url']) $('#model-form').elements.namedItem(name).value = model?.[name] ?? '';
  $('#model-form').elements.namedItem('key').value = model ? keys.get(model.id) ?? '' : '';
  $('#model-dialog').showModal();
}
$('#add-model').onclick = () => openModel();
$('#close-dialog').onclick = $('#cancel-dialog').onclick = () => $('#model-dialog').close();
$('#model-form').onsubmit = event => {
  event.preventDefault(); const data = new FormData(event.target); const url = data.get('url').trim();
  if (!['http:', 'https:'].includes(new URL(url).protocol)) { toast('请求地址请使用 http 或 https'); return; }
  const model = { id: editing ?? id(), name: data.get('name').trim(), url, model: data.get('model').trim() };
  if (!model.name || !model.model) { toast('名称不能为空'); return; }
  const key = data.get('key').trim(); if (key) keys.set(model.id, key); else keys.delete(model.id);
  const index = state.models.findIndex(item => item.id === editing);
  if (index >= 0) state.models[index] = model; else state.models.push(model);
  if (!state.selected) state.selected = model.id;
  save(); renderModels(); renderChat(); $('#model-dialog').close(); toast('模型展示配置已保存');
};
function renderModels() {
  const grid = $('#model-grid'); grid.replaceChildren();
  if (!state.models.length) { grid.append(node('div', 'empty-card', '还没有模型，点击“添加模型”创建配置。')); return; }
  for (const model of state.models) {
    const card = node('article', 'model-card'); const top = node('div', 'model-top');
    top.append(node('span', 'model-icon', '◇'), node('span', 'model-badge', model.id === state.selected ? '当前选择' : '未连接'));
    card.append(top, node('h3', '', model.name), node('div', 'model-name', model.model));
    const detail = node('div', 'model-detail');
    for (const [label, value] of [['请求地址', model.url], ['API Key', keys.has(model.id) ? '••••••••（本次页面）' : '未设置']]) { const row = node('div'); row.append(node('span', '', label), node('code', '', value)); detail.append(row); }
    const actions = node('div', 'model-actions'); const use = node('button', 'text-button', model.id === state.selected ? '✓ 当前模型' : '设为当前');
    use.disabled = model.id === state.selected; use.onclick = () => { state.selected = model.id; save(); renderModels(); renderChat(); toast('已切换页面中的当前模型'); };
    const group = node('div'); const edit = node('button', 'text-button', '编辑'); edit.onclick = () => openModel(model);
    const remove = node('button', 'text-button danger', '删除'); remove.onclick = () => { if (!confirm(`删除模型配置“${model.name}”？`)) return; state.models = state.models.filter(item => item.id !== model.id); keys.delete(model.id); if (state.selected === model.id) state.selected = state.models[0]?.id ?? ''; save(); renderModels(); renderChat(); };
    group.append(edit, remove); actions.append(use, group); card.append(detail, actions); grid.append(card);
  }
}
function renderSessions() {
  const search = $('#session-search').value.trim().toLowerCase();
  const sessions = state.sessions.filter(item => item.title.toLowerCase().includes(search)).sort((a, b) => b.updated - a.updated);
  $('#session-count').textContent = state.sessions.length;
  const list = $('#session-list'); list.replaceChildren();
  if (!sessions.length) { const row = node('tr'); const cell = node('td', 'empty-table', search ? '没有匹配的会话' : '还没有会话，去工作台写下第一条消息吧。'); cell.colSpan = 4; row.append(cell); list.append(row); return; }
  for (const session of sessions) {
    const row = node('tr'); row.append(node('td', '', session.title), node('td', '', session.messages.length), node('td', '', new Date(session.updated).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })));
    const actions = node('td'); const open = node('button', 'text-button', '打开'); open.onclick = () => { state.current = session.id; save(); renderChat(); navigate('chat'); };
    const remove = node('button', 'text-button danger', '删除'); remove.onclick = () => { if (!confirm(`删除会话“${session.title}”？`)) return; state.sessions = state.sessions.filter(item => item.id !== session.id); if (state.current === session.id) state.current = null; save(); renderSessions(); renderChat(); };
    actions.append(open, remove); row.append(actions); list.append(row);
  }
}
$('#session-search').oninput = renderSessions;
document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => navigate(button.dataset.page));
document.querySelectorAll('[data-open]').forEach(button => button.onclick = () => navigate(button.dataset.open));
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
renderChat(); renderModels(); renderSessions(); navigate(location.hash.slice(1));
