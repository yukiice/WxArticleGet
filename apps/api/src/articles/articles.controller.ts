import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { articleQuerySchema, importArticleSchema, type ArticleDetailDto, type ArticleListItemDto, type Paginated } from '@wx/shared';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { parseOrThrow } from '../common/zod';
import { ArticlesService } from './articles.service';

const markReadSchema = z.object({ isRead: z.boolean() });

@Controller('articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  list(@Query() query: unknown): Promise<Paginated<ArticleListItemDto>> {
    return this.articles.list(parseOrThrow(articleQuerySchema, query));
  }

  @UseGuards(AdminGuard)
  @Post('import')
  import(@Body() body: unknown): Promise<{ accountId: string; queued: boolean }> {
    return this.articles.importArticle(parseOrThrow(importArticleSchema, body));
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<ArticleDetailDto> {
    return this.articles.detail(id);
  }

  @Patch(':id')
  markRead(@Param('id') id: string, @Body() body: unknown): Promise<{ ok: boolean }> {
    const input = parseOrThrow(markReadSchema, body);
    return this.articles.markRead(id, input.isRead);
  }
}

