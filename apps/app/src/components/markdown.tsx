'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('markdown-body text-[15px] text-zinc-700 dark:text-zinc-300', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

