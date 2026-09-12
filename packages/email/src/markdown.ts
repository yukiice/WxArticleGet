/** 极简 Markdown -> HTML，仅覆盖 AI 总结用到的语法，避免为邮件引入额外依赖 */
export function markdownToEmailHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;
    html.push(`<ul style="margin:8px 0;padding-left:22px;">${listBuffer.join('')}</ul>`);
    listBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length + 1, 4);
      const size = level === 2 ? 18 : level === 3 ? 16 : 15;
      html.push(
        `<h${level} style="margin:16px 0 8px;font-size:${size}px;line-height:1.5;color:#111827;">${inline(
          heading[2],
        )}</h${level}>`,
      );
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      listBuffer.push(`<li style="margin:4px 0;line-height:1.7;">${inline(bullet[1])}</li>`);
      continue;
    }

    const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      listBuffer.push(`<li style="margin:4px 0;line-height:1.7;">${inline(ordered[2])}</li>`);
      continue;
    }

    flushList();
    html.push(`<p style="margin:8px 0;line-height:1.7;color:#374151;">${inline(line)}</p>`);
  }

  flushList();
  return html.join('\n');
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" style="color:#2563eb;">$1</a>');
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

