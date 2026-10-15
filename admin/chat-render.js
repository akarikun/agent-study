// Markdown 先解析再清理；数据库仍保存原始文本，刷新和流式生成使用同一渲染路径。
function renderMarkdown(text) {
  const content = document.createElement('div');
  content.className = 'markdown-body';
  content.innerHTML = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }), {
    USE_PROFILES: { html: true },
  });
  for (const link of content.querySelectorAll('a')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  return content;
}

function renderWaiting(text = '正在思考') {
  const status = document.createElement('div');
  status.className = 'reply-loading';
  status.setAttribute('role', 'status');
  const dots = document.createElement('span');
  dots.className = 'loading-dots';
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('i');
    dot.textContent = '.';
    dots.append(dot);
  }
  const label = document.createElement('span');
  label.textContent = text;
  status.append(label, dots);
  return status;
}
