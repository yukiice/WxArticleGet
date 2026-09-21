/** 登录后只允许跳转到当前站点内的路径。 */
export function loginRedirect(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const base = 'https://local.invalid';
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}
