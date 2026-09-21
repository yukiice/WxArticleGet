import { describe, expect, it } from 'vitest';
import {
  sanitizeContentHtml,
  htmlToPlainText,
  extractImages,
  countWords,
} from '@wx/wechat';

const STRESS_TITLE = '压力';

function makeHtml(paragraphs: number): string {
  return `<section style="text-align:justify;">${Array.from({ length: paragraphs }, (_, i) =>
    `<p style="color:#333333;font-size:16px;line-height:1.75;">第 ${i} 段正文，含链接 <a href="https://mp.weixin.qq.com/s/x">文章链接</a>。</p>`,
  ).join('')}</section>`;
}

describe('正文解析与清洗压力', () => {
  it(`10,000 段、约 ${10_000 * 40} 字的超大正文：sanitize/提取图片/纯文本转换均不退化`, () => {
    const html = makeHtml(10_000);
    expect(html.length).toBeGreaterThan(500_000);
    const clean = sanitizeContentHtml(html);
    expect(clean).toContain('第 9999 段正文');
    expect(extractImages(clean)).toEqual([]);
    const text = htmlToPlainText(clean);
    expect(text).toContain('第 9999 段正文');
    expect(countWords(text)).toBeGreaterThan(100_000); // 中文按字计
  });

  it.each([
    ['script 标签', '<p>正文</p><script>alert(1)</script>', '<script>'],
    ['onerror 属性', '<img src="https://x.com/a.png" onerror="fetch(//evil)">', 'onerror'],
    ['javascript: 协议', '<a href="javascript:alert(1)">点</a>', 'javascript:'],
    ['data:text/html 链接', '<a href="data:text/html,<script>alert(1)</script>">点</a>', 'data:text/html'],
    ['style 里的 url()', '<p style="background-image:url(https://evil/x.png)">x</p>', 'url('],
    ['style 里的 expression()', '<p style="width:expression(alert(1))">x</p>', 'expression'],
    ['iframe', '<iframe src="https://evil"></iframe><p>正文</p>', 'iframe'],
    ['form 表单', '<form action="https://evil"><input name="x"></form>', '<form'],
  ])('剔除恶意片段：%s', (_name, html, forbidden) => {
    const clean = sanitizeContentHtml(html);
    expect(clean.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });

  it('微信公众号图片格式保留：data-src / data-w / data-ratio 归一化', () => {
    const html = '<img data-src="https://mmbiz.qpic.cn/a.png" data-w="1080" data-ratio="0.75" alt="图" style="width:100%;">';
    const clean = sanitizeContentHtml(html);
    expect(clean).toContain('src="https://mmbiz.qpic.cn/a.png"');
    expect(clean).toContain('data-w="1080"');
    expect(clean).toContain('data-ratio="0.75"');
    const images = extractImages(clean);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ originalUrl: 'https://mmbiz.qpic.cn/a.png', width: 1080 });
    expect(images[0].height).toBe(810); // 1080 * 0.75
  });

  it('1000 张相同 URL 的图片只保留一条（去重）', () => {
    const html = Array.from({ length: 1000 }, () => '<img src="https://mmbiz.qpic.cn/same.png">').join('');
    expect(extractImages(html)).toHaveLength(1);
  });

  it('空/畸形输入不抛错', () => {
    expect(sanitizeContentHtml('')).toBe('');
    expect(htmlToPlainText('')).toBe('');
    expect(extractImages('')).toEqual([]);
    expect(htmlToPlainText('<p>')).toBe('');
    expect(htmlToPlainText('<<<>>>')).toBe('<<<>>>');
    expect(sanitizeContentHtml('<p style="color:'.repeat(50))).not.toContain('color:');
  });

  it('data:image 保留为图片，data:text/html 链接整体丢弃', () => {
    const dataImage = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==">';
    expect(sanitizeContentHtml(dataImage)).toContain('data:image/png');
    const dataLink = '<a href="data:text/html,<script>alert(1)</script>">点</a>';
    // href 被剥离后 transformTags 回落成 #，无法构成可点击的 data: URL
    expect(sanitizeContentHtml(dataLink)).not.toContain('data:');
    expect(sanitizeContentHtml(dataLink)).not.toContain('text/html');
  });

  it('中英文混排字数统计：中文按字、英文按词', () => {
    expect(countWords('你好世界')).toBe(4);
    expect(countWords('hello world foo')).toBe(3);
    // AI 按词计 1，时代 2 字，hello/world 各 1 → 5
    expect(countWords('AI 时代 hello world')).toBe(5);
  });
});
