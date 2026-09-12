import { describe, expect, it } from 'vitest';
import { cleanAccountName, parseDecemberpeiCatalog, parseWechat2rssCatalog } from './catalog';

const DECEMBERPEI_HTML = `
<article class="post">
  <ul>
    <li>微信公众号-人民日报: https://decemberpei.cyou/rssbox/wechat-renminribao.xml</li>
    <li>微信公众号-三联生活周刊: https://decemberpei.cyou/rssbox/wechat-sanlianshenghuozhoukan.xml</li>
    <li>微信公众号-36氪Pro: https://decemberpei.cyou/rssbox/wechat-sanliukepro.xml</li>
  </ul>
</article>
`;

const WECHAT2RSS_HTML = `
<h2 id="安全" tabindex="-1">安全</h2>
<p><a href="https://wechat2rss.xlab.app/feed/5b925323244e9737c39285596c53e3a2f4a30774.xml" target="_blank" rel="noreferrer">思想花火</a></p>
<p><a href="https://wechat2rss.xlab.app/feed/90c827b8290310a96ef80a13df9dbcc06ab69892.xml" target="_blank" rel="noreferrer">吾爱破解论坛</a></p>
`;

describe('parseDecemberpeiCatalog', () => {
  it('解析「名称: feed 地址」列表', () => {
    const entries = parseDecemberpeiCatalog(DECEMBERPEI_HTML);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      name: '人民日报',
      feedUrl: 'https://decemberpei.cyou/rssbox/wechat-renminribao.xml',
      source: 'decemberpei',
    });
    expect(entries[2]?.name).toBe('36氪Pro');
  });

  it('页面结构变化时返回空数组', () => {
    expect(parseDecemberpeiCatalog('<html><body>没有列表</body></html>')).toEqual([]);
  });
});

describe('parseWechat2rssCatalog', () => {
  it('解析 a 标签中的名称与 feed 地址', () => {
    const entries = parseWechat2rssCatalog(WECHAT2RSS_HTML);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      name: '思想花火',
      feedUrl: 'https://wechat2rss.xlab.app/feed/5b925323244e9737c39285596c53e3a2f4a30774.xml',
      source: 'wechat2rss',
    });
  });

  it('忽略非 feed 链接', () => {
    expect(parseWechat2rssCatalog('<a href="https://example.com/other.xml">别的</a>')).toEqual([]);
  });
});

describe('cleanAccountName', () => {
  it('去掉「微信公众号-」前缀并压缩空白', () => {
    expect(cleanAccountName('微信公众号-财新网')).toBe('财新网');
    expect(cleanAccountName('  微信公众号 -  LatePost  ')).toBe('LatePost');
    expect(cleanAccountName('财新网')).toBe('财新网');
  });
});
