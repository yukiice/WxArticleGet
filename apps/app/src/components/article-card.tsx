'use client';

import Link from 'next/link';
import type { ArticleListItemDto } from '@wx/shared';
import { relativeTime, readingMinutes } from '@/lib/utils';

export function ArticleCard({ article }: { article: ArticleListItemDto }) {
  return (
    <Link
      href={`/articles/${article.id}`}
      className="group block border-b border-zinc-100 px-4 py-4 transition-colors last:border-b-0 hover:bg-zinc-50 sm:px-5 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
    >
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-500">
            <span className="font-medium text-zinc-600 dark:text-zinc-300">{article.account.name}</span>
            <span aria-hidden>·</span>
            <span>{relativeTime(article.publishTime)}</span>
            {!article.isRead ? <span className="size-1.5 rounded-full bg-brand-600" aria-label="未读" /> : null}
          </div>

          <h3 className="mb-1.5 line-clamp-2 text-[15px] font-semibold leading-snug text-zinc-900 group-hover:text-brand-700 dark:text-zinc-100 dark:group-hover:text-brand-500">
            {article.title}
          </h3>

          {article.digest ? (
            <p className="line-clamp-2 text-[13px] leading-relaxed text-zinc-500">{article.digest}</p>
          ) : null}

          <div className="mt-2 text-[11px] text-zinc-400">约 {readingMinutes(article.wordCount)} 分钟</div>
        </div>

        {article.coverLocal || article.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.coverLocal ?? article.coverUrl ?? undefined}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-20 shrink-0 rounded-lg object-cover sm:size-24"
          />
        ) : null}
      </div>
    </Link>
  );
}

