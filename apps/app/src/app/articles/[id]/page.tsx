'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ArrowLeftIcon, LinkIcon } from '@/components/icons';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge, Spinner } from '@/components/ui';
import { useArticle, useMarkRead } from '@/lib/queries';
import { formatDateTime, readingMinutes } from '@/lib/utils';

export default function ArticleDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const { data: article, isLoading, error } = useArticle(id);
  const markRead = useMarkRead();

  useEffect(() => {
    if (article && !article.isRead) {
      markRead.mutate({ id: article.id, isRead: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article?.id]);

  return (
    <div className="min-h-dvh bg-white dark:bg-zinc-950">
      <header className="sticky top-0 z-20 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b border-zinc-100 bg-white/85 px-3 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex size-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          aria-label="返回"
        >
          <ArrowLeftIcon />
        </button>

        <div className="flex items-center gap-1">
          {article ? (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex size-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              aria-label="查看原文"
            >
              <LinkIcon />
            </a>
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pb-20 pt-6 sm:px-6">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Spinner className="text-zinc-400" />
          </div>
        ) : error || !article ? (
          <div className="py-20 text-center text-sm text-zinc-500">
            文章不存在或已被删除
            <div className="mt-4">
              <Link href="/" className="text-brand-600">
                返回首页
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* break-words：标题若含长链接或无空格长串，否则会顶破容器 */}
            <h1 className="break-words text-xl font-bold leading-snug text-zinc-900 sm:text-2xl dark:text-zinc-50">
              {article.title}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
              <span className="font-medium text-zinc-600 dark:text-zinc-300">{article.account.name}</span>
              {article.author ? <span>· {article.author}</span> : null}
              <span>· {formatDateTime(article.publishTime)}</span>
              <span>· 约 {readingMinutes(article.wordCount)} 分钟</span>
            </div>

            <hr className="my-5 border-zinc-100 dark:border-zinc-800" />

            <article className="article-content" dangerouslySetInnerHTML={{ __html: article.contentHtml }} />

            <div className="mt-10 border-t border-zinc-100 pt-5 text-center dark:border-zinc-800">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-zinc-100 px-4 text-sm font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                <LinkIcon className="size-4" />
                阅读公众号原文
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
