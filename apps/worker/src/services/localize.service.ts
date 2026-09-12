import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchBinary, hashString, type ExtractedImage } from '@wx/wechat';

export interface LocalizeResult {
  contentHtml: string;
  succeeded: number;
  failed: number;
  files: Array<{ originalUrl: string; localPath: string }>;
}

@Injectable()
export class LocalizeService {
  private readonly logger = new Logger('Localize');
  private readonly dataDir: string;

  constructor(config: ConfigService) {
    this.dataDir = path.resolve(config.get<string>('DATA_DIR') ?? './data');
  }

  async localizeImages(articleId: string, contentHtml: string, images: ExtractedImage[]): Promise<LocalizeResult> {
    let html = contentHtml;
    let succeeded = 0;
    let failed = 0;
    const files: Array<{ originalUrl: string; localPath: string }> = [];

    for (const image of images) {
      try {
        const publicPath = await this.download(image.originalUrl, path.join('images', articleId));
        html = replaceAll(html, image.originalUrl, publicPath);
        files.push({ originalUrl: image.originalUrl, localPath: publicPath });
        succeeded += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`图片本地化失败 ${image.originalUrl}: ${(error as Error).message}`);
      }
    }

    return { contentHtml: html, succeeded, failed, files };
  }

  async localizeCover(articleId: string, coverUrl: string): Promise<string | null> {
    try {
      return await this.download(coverUrl, path.join('covers', articleId));
    } catch (error) {
      this.logger.warn(`封面本地化失败 ${coverUrl}: ${(error as Error).message}`);
      return null;
    }
  }

  private async download(url: string, relativeDir: string): Promise<string> {
    const response = await fetchBinary(url, {
      headers: { Referer: 'https://mp.weixin.qq.com/' },
      timeoutMs: 30_000,
      retries: 1,
    });

    const extension = guessExtension(response.contentType, url);
    const fileName = `${hashString(url).slice(0, 24)}${extension}`;
    const absoluteDir = path.join(this.dataDir, relativeDir);
    await mkdir(absoluteDir, { recursive: true });
    await writeFile(path.join(absoluteDir, fileName), response.data);

    return `/files/${relativeDir.split(path.sep).join('/')}/${fileName}`;
  }
}

function replaceAll(source: string, search: string, replacement: string): string {
  const escaped = search.replace(/&/g, '&amp;');
  return source.split(search).join(replacement).split(escaped).join(replacement);
}

function guessExtension(contentType: string | null, url: string): string {
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('gif')) return '.gif';
  if (contentType?.includes('webp')) return '.webp';
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return '.jpg';

  const wxFmt = /wx_fmt=(\w+)/.exec(url)?.[1];
  if (wxFmt) return `.${wxFmt === 'jpeg' ? 'jpg' : wxFmt}`;

  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return '';
    }
  })();
  const ext = path.extname(pathname).toLowerCase();
  return ['.png', '.gif', '.webp', '.jpg', '.jpeg'].includes(ext) ? ext : '.jpg';
}
