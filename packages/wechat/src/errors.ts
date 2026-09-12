export class ArticleUnavailableError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
    this.name = 'ArticleUnavailableError';
  }
}

export class ProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderNotConfiguredError';
  }
}
