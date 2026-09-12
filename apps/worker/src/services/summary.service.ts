import OpenAI from 'openai';
import { Injectable, Logger } from '@nestjs/common';
import { dateKey, dayRange, formatDateTime } from '@wx/shared';
import type { Article } from '@wx/db';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotifyService } from './notify.service';

const PROMPT_VERSION = 'v1';

const SYSTEM_PROMPT = `你是一名严谨的中文内容编辑。你会收到某个公众号当天发布的文章列表与正文摘录。
请输出一份可直接阅读的 Markdown 日报，结构固定为：
## 今日要点
用 3-5 条要点提炼当天最重要的信息。
## 分篇速览
每篇文章一行，格式为「标题 — 一句话概括」。
## 值得细读
挑出 1-2 篇并说明理由（没有则写「今日无」）。
要求：只依据给定内容，不要编造事实，不要输出与结构无关的客套话。`;

export interface SummaryRunResult {
  skipped: boolean;
  articleCount: number;
}

@Injectable()
export class SummaryService {
  private readonly logger = new Logger('Summary');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notify: NotifyService,
  ) {}

  async run(date?: string, force = false): Promise<SummaryRunResult> {
    const target = date ?? dateKey();
    const dateOnly = new Date(`${target}T00:00:00.000Z`);
    const { start, end } = dayRange(target);
    const settings = await this.settings.resolveAll();

    const existing = await this.prisma.summary.findFirst({
      where: { date: dateOnly, scope: 'global' },
    });
    if (existing?.status === 'done' && !force) {
      return { skipped: true, articleCount: existing.articleCount };
    }

    const articles = await this.prisma.article.findMany({
      where: { publishTime: { gte: start, lt: end } },
      orderBy: { publishTime: 'asc' },
      include: { account: true },
    });

    if (articles.length === 0) {
      await this.persist(dateOnly, settings.llm.model, '今天没有新的文章。', 0, 0, 0, 'done');
      return { skipped: false, articleCount: 0 };
    }

    if (!settings.llm.apiKey) {
      const message = '未配置 LLM API Key，无法生成总结';
      await this.persist(dateOnly, settings.llm.model, message, articles.length, 0, 0, 'failed');
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
          { role: 'user', content: buildUserPrompt(target, articles, settings.llm.maxInputCharsPerArticle) },
        ],
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) throw new Error('模型返回了空内容');

      await this.persist(
        dateOnly,
        settings.llm.model,
        content,
        articles.length,
        completion.usage?.prompt_tokens ?? 0,
        completion.usage?.completion_tokens ?? 0,
        'done',
      );
      this.logger.log(`已生成 ${target} 的总结（${articles.length} 篇）`);
      return { skipped: false, articleCount: articles.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.persist(dateOnly, settings.llm.model, existing?.contentMd ?? '', articles.length, 0, 0, 'failed');
      await this.notify.alert(`AI 总结失败（${target}）`, `原因：${message}`);
      throw error;
    }
  }

  private async persist(
    dateOnly: Date,
    model: string,
    contentMd: string,
    articleCount: number,
    tokenIn: number,
    tokenOut: number,
    status: string,
  ): Promise<void> {
    const existing = await this.prisma.summary.findFirst({ where: { date: dateOnly, scope: 'global' } });
    const data = {
      model,
      promptVer: PROMPT_VERSION,
      contentMd,
      articleCount,
      tokenIn,
      tokenOut,
      status,
    };

    if (existing) {
      await this.prisma.summary.update({ where: { id: existing.id }, data });
      return;
    }

    await this.prisma.summary.create({ data: { ...data, date: dateOnly, scope: 'global' } });
  }
}

function buildUserPrompt(
  date: string,
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

  return `日期：${date}\n共 ${articles.length} 篇文章。\n\n${blocks.join('\n\n---\n\n')}`;
}

