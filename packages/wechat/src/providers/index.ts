import type { RawArticle } from '@wx/shared';
import { RssProvider } from './rss';
import type { AccountSource, Provider, ProviderContext } from './types';

export * from './lookup';
export * from './rss';
export * from './types';

/** manual 类型不做自动发现，文章通过链接手动导入 */
class ManualProvider implements Provider {
  readonly type = 'manual';

  async fetchArticles(): Promise<RawArticle[]> {
    return [];
  }
}

export function createProvider(type: string): Provider {
  switch (type) {
    case 'rss':
    case 'rsshub':
      return new RssProvider();
    case 'manual':
    default:
      return new ManualProvider();
  }
}

export async function fetchArticlesForAccount(
  account: AccountSource,
  since: Date,
  context: ProviderContext = {},
): Promise<RawArticle[]> {
  const provider = createProvider(account.providerType);
  return provider.fetchArticles(account, since, context);
}
