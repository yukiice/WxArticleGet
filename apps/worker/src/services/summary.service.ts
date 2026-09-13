import OpenAI from 'openai';
import { Injectable, Logger } from '@nestjs/common';
import {
  dateKey,
  formatDateTime,
  formatRange,
  type JobPayloads,
} from '@wx/shared';
import { resolveDigestWindow, type Article } from '@wx/db';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotifyService } from './notify.service';
import { waitForFetch } from './fetch-dependencies';

const PROMPT_VERSION = 'v2';

const EMPTY_CONTENT = '这个时间段没有新文章。';

const SYSTEM_PROMPT = `你是一名严谨的中文内容编辑。你会收到某个时间段内公众号发布的文章列表与正文摘录。
请输出一份可直接阅读的 Markdown 日报，结构固定为：
## 核心要点
用 3-5 条要点提炼这段时间最重要的信息。
## 分篇速览
每篇文章一行，格式为「标题 — 一句话概括」。
## 值得细读
挑出 1-2 篇并说明理由（没有则写「本期无」）。
要求：只依据给定内容，不要编造事实，不要输出与结构无关的客套话。`;

export interface SummaryRunResult {
  skipped: boolean;
  articleCount: number;
}

interface PersistInput {
  dateOnly: Date;
  windowFrom: Date;
  windowTo: Date;
  model: string;
  contentMd: string;
  articleCount: number;
  tokenIn: number;
  tokenOut: number;
  status: string;
}

@Injectable()
export class SummaryService {
  private readonly logger = new Logger('Summary');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notify: NotifyService,
  ) {}

  /** 所有入口优先复用已保存的统计窗口，并等待该批抓取重试完成。 */
  async run(payload: JobPayloads['summarize-day']): Promise<SummaryRunResult> {
    const target = payload.date ?? dateKey();
    const dateOnly = new Date(`${target}T00:00:00.000Z`);
    await waitForFetch(this.prisma, dateOnly);
    const { from, to } = await resolveDigestWindow(this.prisma, target, payload.windowTo ? new Date(payload.windowTo) : undefined);
    const range = formatRange(from, to);
    const settings = await this.settings.resolveAll();

    const existing = await this.prisma.summary.findFirst({ where: { date: dateOnly, scope: 'global' } });
    if (existing?.status === 'done' && !payload.force) {
      return { skipped: true, articleCount: existing.articleCount };
    }

    const articles = await this.prisma.article.findMany({
      where: { publishTime: { gte: from, lt: to } },
      orderBy: { publishTime: 'asc' },
      include: { account: true },
    });

    // 区间内没有新文章：不调用模型、不发邮件，只留一条记录便于后台查看
    if (articles.length === 0) {
      await this.persist({
        dateOnly,
        windowFrom: from,
        windowTo: to,
        model: settings.llm.model,
        contentMd: EMPTY_CONTENT,
        articleCount: 0,
        tokenIn: 0,
        tokenOut: 0,
        status: 'empty',
      });
      this.logger.log(`${range} 没有新文章，未调用模型`);
      return { skipped: false, articleCount: 0 };
    }

    if (!settings.llm.apiKey) {
      const message = '未配置 LLM API Key，无法生成总结';
      await this.persist({
        dateOnly,
        windowFrom: from,
        windowTo: to,
        model: settings.llm.model,
        contentMd: message,
        articleCount: articles.length,
        tokenIn: 0,
        tokenOut: 0,
        status: 'failed',
      });
      await this.notify.alert('AI 总结失败', message);
      throw new Error(message);
    }

    const client = new OpenAI({ apiKey: settings.llm.apiKey, baseURL: settings.llm.baseUrl });

    try {
      const completion = await client.chat.completions.create({
        model: settings.llm.model,
        temperature: settings.llm.temperature,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildUserPrompt(range, articles, settings.llm.maxInputCharsPerArticle),
          },
        ],
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) throw new Error('模型返回了空内容');

      await this.persist({
        dateOnly,
        windowFrom: from,
        windowTo: to,
        model: settings.llm.model,
        contentMd: content,
        articleCount: articles.length,
        tokenIn: completion.usage?.prompt_tokens ?? 0,
        tokenOut: completion.usage?.completion_tokens ?? 0,
        status: 'done',
      });
      this.logger.log(`已生成 ${target} 的总结（${range}，${articles.length} 篇）`);
      return { skipped: false, articleCount: articles.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.persist({
        dateOnly,
        windowFrom: from,
        windowTo: to,
        model: settings.llm.model,
        contentMd: existing?.contentMd ?? '',
        articleCount: articles.length,
        tokenIn: 0,
        tokenOut: 0,
        status: 'failed',
      });
      await this.notify.alert(`AI 总结失败（${target}）`, `原因：${message}`);
      throw error;
    }
  }

  private async persist(input: PersistInput): Promise<void> {
    const data = {
      windowFrom: input.windowFrom,
      windowTo: input.windowTo,
      model: input.model,
      promptVer: PROMPT_VERSION,
      contentMd: input.contentMd,
      articleCount: input.articleCount,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      status: input.status,
    };

    const existing = await this.prisma.summary.findFirst({
      where: { date: input.dateOnly, scope: 'global' },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.summary.update({ where: { id: existing.id }, data });
      return;
    }

    await this.prisma.summary.create({ data: { ...data, date: input.dateOnly, scope: 'global' } });
  }
}

function buildUserPrompt(
  range: string,
  articles: Array<Article & { account: { name: string } }>,
  maxChars: number,
): string {
  const blocks = articles.map((article, index) => {
    const content = article.contentText.slice(0, maxChars);
    return [
      `### ${index + 1}. ${article.title}`,
      `公众号：${article.account.name}`,
      `发布时间：${formatDateTime(article.publishTime)}`,
      `正文摘录：`,
      content,
    ].join('\n');
  });

  return `统计区间：${range}\n共 ${articles.length} 篇文章。\n\n${blocks.join('\n\n---\n\n')}`;
}
