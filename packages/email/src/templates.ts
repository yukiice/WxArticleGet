import { escapeHtml, markdownToEmailHtml } from './markdown';

export interface DigestArticle {
  title: string;
  url: string;
  sourceUrl?: string | null;
  accountName: string;
  publishTime: string;
  digest?: string | null;
  coverUrl?: string | null;
}

export interface DigestTemplateData {
  date: string;
  /** 统计区间说明，如「09-12 08:30 → 09-13 08:30」 */
  rangeLabel?: string | null;
  summaryMarkdown?: string | null;
  summaryModel?: string | null;
  articles: DigestArticle[];
  siteUrl: string;
  maxArticles?: number;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export function renderDigestEmail(data: DigestTemplateData): RenderedMail {
  const maxArticles = data.maxArticles ?? 20;
  const articles = data.articles.slice(0, maxArticles);
  const subject = `【${data.date}】公众号文章 ${articles.length} 篇${data.summaryMarkdown ? ' · 含 AI 总结' : ''}`;

  const summaryBlock = data.summaryMarkdown
    ? `
      <tr>
        <td style="padding:0 24px 8px;">
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px;background:#f8fafc;">
            <div style="font-size:13px;color:#6b7280;margin-bottom:6px;">AI 每日总结${data.summaryModel ? ` · ${escapeHtml(data.summaryModel)}` : ''}</div>
            ${markdownToEmailHtml(data.summaryMarkdown)}
          </div>
        </td>
      </tr>`
    : '';

  const articleRows = articles
    .map((article, index) => {
      const cover = article.coverUrl
        ? `<td width="96" valign="top" style="padding:0 0 0 12px;">
             <img src="${escapeHtml(article.coverUrl)}" width="96" alt="" style="width:96px;height:auto;border-radius:6px;display:block;" />
           </td>`
        : '';

      return `
      <tr>
        <td style="padding:0 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #eef0f3;">
            <tr>
              <td valign="top" style="padding:16px 0;">
                <div style="font-size:12px;color:#9ca3af;margin-bottom:6px;">${index + 1}. ${escapeHtml(
                  article.accountName,
                )} · ${escapeHtml(article.publishTime)}</div>
                <div style="font-size:16px;font-weight:600;line-height:1.5;margin-bottom:6px;">
                  <a href="${escapeHtml(article.url)}" style="color:#111827;text-decoration:none;">${escapeHtml(
                    article.title,
                  )}</a>
                </div>
                ${
                  article.digest
                    ? `<div style="font-size:13px;color:#6b7280;line-height:1.7;">${escapeHtml(
                        truncate(article.digest, 140),
                      )}</div>`
                    : ''
                }
                ${
                  article.sourceUrl
                    ? `<div style="font-size:12px;margin-top:8px;"><a href="${escapeHtml(
                        article.sourceUrl,
                      )}" style="color:#9ca3af;">原文链接</a></div>`
                    : ''
                }
              </td>
              ${cover}
            </tr>
          </table>
        </td>
      </tr>`;
    })
    .join('\n');

  const emptyBlock = `
    <tr>
      <td style="padding:8px 24px 24px;color:#6b7280;font-size:14px;">今天没有抓取到新文章。</td>
    </tr>`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">
          <tr>
            <td style="padding:24px 24px 12px;">
              <div style="font-size:20px;font-weight:700;color:#111827;">公众号文章日报</div>
              <div style="font-size:13px;color:#6b7280;margin-top:6px;">${escapeHtml(data.date)} · 共 ${
                articles.length
              } 篇</div>
              ${
                data.rangeLabel
                  ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px;">统计区间 ${escapeHtml(
                      data.rangeLabel,
                    )}</div>`
                  : ''
              }
            </td>
          </tr>
          ${summaryBlock}
          ${articles.length > 0 ? articleRows : emptyBlock}
          <tr>
            <td style="padding:20px 24px 24px;border-top:1px solid #eef0f3;color:#9ca3af;font-size:12px;line-height:1.7;">
              由自建阅读器自动发送 · <a href="${escapeHtml(data.siteUrl)}" style="color:#6b7280;">${
                escapeHtml(new URL(data.siteUrl).host)
              }</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines = [
    `公众号文章 ${data.date}（共 ${articles.length} 篇）${data.rangeLabel ? ` · 统计区间 ${data.rangeLabel}` : ''}`,
    '',
    ...(data.summaryMarkdown ? ['【AI 总结】', data.summaryMarkdown, ''] : []),
    ...articles.map(
      (article, index) =>
        `${index + 1}. [${article.accountName}] ${article.title}\n   ${article.url}${
          article.digest ? `\n   ${truncate(article.digest, 100)}` : ''
        }`,
    ),
    '',
    `站点：${data.siteUrl}`,
  ];

  return { subject, html, text: textLines.join('\n') };
}

export function renderAlertEmail(subject: string, message: string): RenderedMail {
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:20px 22px;">
    <tr><td>
      <div style="font-size:18px;font-weight:700;color:#b91c1c;margin-bottom:10px;">${escapeHtml(subject)}</div>
      <div style="font-size:14px;color:#374151;line-height:1.8;white-space:pre-wrap;">${escapeHtml(message)}</div>
    </td></tr>
  </table>
</body></html>`;

  return { subject: `[告警] ${subject}`, html, text: `${subject}\n\n${message}` };
}

function truncate(text: string, length: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length)}…` : normalized;
}
