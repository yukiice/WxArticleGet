import { describe, expect, it } from 'vitest';
import { ArticleUnavailableError } from './errors';
import { parseArticleHtml } from './parse-article';
import { countWords, sanitizeContentHtml } from './sanitize';

const ARTICLE_URL =
  'https://mp.weixin.qq.com/s?__biz=MzA5MTIzNDU2Nw==&mid=2247483647&idx=1&sn=abcdef123456';

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="页面标题" />
  <meta property="og:image" content="https://mmbiz.qpic.cn/mmbiz_jpg/cover/0?wx_fmt=jpeg" />
  <title>页面标题</title>
</head>
<body>
<script>
  var msg_title = "测试文章标题";
  var nickname = "测试公众号";
  var ct = "1700000000";
  var msg_cdn_url = "https://mmbiz.qpic.cn/mmbiz_jpg/cover/0?wx_fmt=jpeg";
  var biz = "MzA5MTIzNDU2Nw==";
  var mid = "2247483647";
  var idx = "1";
</script>
<div id="js_article" class="rich_media">
  <h1 class="rich_media_title" id="activity-name">  测试文章标题  </h1>
  <div id="meta_content" class="rich_media_meta_list">
    <span id="js_author_name" class="rich_media_meta rich_media_meta_text">张三</span>
    <a id="js_name" class="rich_media_meta rich_media_meta_link">测试公众号</a>
    <em id="publish_time" class="rich_media_meta rich_media_meta_text">2023-11-15 06:53</em>
  </div>
  <div class="rich_media_content js_underline_content" id="js_content" style="visibility: hidden;">
    <p style="text-align: center;"><span style="font-size: 18px; color: #ff0000;">第一段正文</span></p>
    <p><img data-src="https://mmbiz.qpic.cn/mmbiz_png/pic/640?wx_fmt=png" data-w="1080" data-ratio="0.5625" src="data:image/svg+xml,placeholder" /></p>
    <p>第二段正文，包含一个<a href="https://example.com/a?b=1&amp;c=2" onclick="alert(1)">外链</a>。</p>
    <script>alert('xss')</script>
    <section><p>第三段正文</p></section>
    <iframe class="video_iframe" src="https://v.qq.com/iframe/player.html"></iframe>
    <p><img data-src="https://mmbiz.qpic.cn/mmbiz_jpg/pic2/640?wx_fmt=jpeg" data-w="600" data-ratio="1" /></p>
  </div>
</div>
</body>
</html>`;

describe('parseArticleHtml', () => {
  it('解析公众号文章的核心字段', () => {
    const parsed = parseArticleHtml(SAMPLE_HTML, ARTICLE_URL);

    expect(parsed.title).toBe('测试文章标题');
    expect(parsed.accountName).toBe('测试公众号');
    expect(parsed.author).toBe('张三');
    expect(parsed.biz).toBe('MzA5MTIzNDU2Nw==');
    expect(parsed.mid).toBe('2247483647');
    expect(parsed.idx).toBe(1);
    expect(parsed.publishTime?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(parsed.coverUrl).toContain('mmbiz.qpic.cn');
    expect(parsed.wordCount).toBeGreaterThan(10);
  });

  it('清洗脚本、事件属性与 iframe，并保留正文与样式', () => {
    const parsed = parseArticleHtml(SAMPLE_HTML, ARTICLE_URL);

    expect(parsed.contentHtml).not.toContain('<script');
    expect(parsed.contentHtml).not.toContain('onclick');
    expect(parsed.contentHtml).not.toContain('<iframe');
    expect(parsed.contentHtml).toContain('第一段正文');
    expect(parsed.contentHtml).toContain('text-align:center');
    expect(parsed.contentHtml).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(parsed.contentHtml).toContain('rel="noopener noreferrer"');
  });

  it('图片使用 data-src 真实地址并提取尺寸', () => {
    const parsed = parseArticleHtml(SAMPLE_HTML, ARTICLE_URL);

    expect(parsed.images).toHaveLength(2);
    expect(parsed.images[0].originalUrl).toContain('mmbiz_png/pic/640');
    expect(parsed.images[0].width).toBe(1080);
    expect(parsed.images[0].height).toBe(608);
    expect(parsed.contentHtml).toContain('referrerpolicy="no-referrer"');
    expect(parsed.contentHtml).not.toContain('data:image/svg+xml');
  });

  it('正文文本去除标签并归一化空白', () => {
    const parsed = parseArticleHtml(SAMPLE_HTML, ARTICLE_URL);

    expect(parsed.contentText).toContain('第一段正文');
    expect(parsed.contentText).toContain('第二段正文');
    expect(parsed.contentText).not.toContain('<p>');
  });

  it('识别被删除的文章并抛出明确错误', () => {
    const deletedHtml = `<html><body><div class="weui-msg"><h2>该内容已被发布者删除</h2></div></body></html>`;

    expect(() => parseArticleHtml(deletedHtml, ARTICLE_URL)).toThrow(ArticleUnavailableError);
  });

  it('缺少正文时抛出错误', () => {
    expect(() => parseArticleHtml('<html><body><p>空页面</p></body></html>', ARTICLE_URL)).toThrow(
      ArticleUnavailableError,
    );
  });
});

describe('sanitizeContentHtml', () => {
  it('剔除危险样式与协议', () => {
    const html = `<p style="background-image: url(javascript:alert(1))">文本</p><img src="javascript:alert(1)" />`;
    const cleaned = sanitizeContentHtml(html);

    expect(cleaned).not.toContain('javascript:');
  });
});

describe('countWords', () => {
  it('中文按字、英文按词统计', () => {
    expect(countWords('你好世界 hello world')).toBe(6);
  });
});
