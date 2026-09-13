import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchImage } from '../image';
import { fetchArticle } from '../providers/lookup';
import { hashString } from '../url-utils';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const url = args.find((arg) => !arg.startsWith('--'));
  const downloadImages = args.includes('--download-images');

  if (!url) {
    console.log(`用法: node dist/scripts/poc.js <公众号文章链接> [--download-images]

示例:
  pnpm --filter @wx/wechat poc "https://mp.weixin.qq.com/s?__biz=...&mid=...&idx=1&sn=..." --download-images
`);
    process.exit(1);
  }

  const id = hashString(url).slice(0, 12);
  const outputDir = path.resolve(process.cwd(), 'data', 'poc', id);
  await mkdir(outputDir, { recursive: true });

  console.log(`[poc] 抓取文章: ${url}`);
  const startedAt = Date.now();
  const { parsed } = await fetchArticle(url);
  console.log(`[poc] 耗时 ${Date.now() - startedAt}ms`);

  console.log('--------------------------------------------------');
  console.log(`标题      : ${parsed.title}`);
  console.log(`公众号    : ${parsed.accountName ?? '(未解析)'}`);
  console.log(`作者      : ${parsed.author ?? '(未解析)'}`);
  console.log(`发布时间  : ${parsed.publishTime?.toISOString() ?? '(未解析)'}`);
  console.log(`biz/mid/idx: ${parsed.biz ?? '?'} / ${parsed.mid ?? '?'} / ${parsed.idx ?? '?'}`);
  console.log(`封面      : ${parsed.coverUrl ?? '(无)'}`);
  console.log(`字数      : ${parsed.wordCount}`);
  console.log(`图片      : ${parsed.images.length} 张`);
  console.log(`正文长度  : ${parsed.contentHtml.length} 字符`);
  console.log('--------------------------------------------------');
  console.log('正文预览:');
  console.log(parsed.contentText.slice(0, 300));
  console.log('--------------------------------------------------');

  await writeFile(path.join(outputDir, 'article.json'), JSON.stringify(parsed, null, 2), 'utf8');
  await writeFile(path.join(outputDir, 'content.html'), parsed.contentHtml, 'utf8');

  if (downloadImages && parsed.images.length > 0) {
    console.log(`[poc] 下载 ${parsed.images.length} 张图片到 ${outputDir}/images`);
    const imageDir = path.join(outputDir, 'images');
    await mkdir(imageDir, { recursive: true });

    let index = 0;
    for (const image of parsed.images) {
      index += 1;
      try {
        const { data, contentType, extension } = await fetchImage(image.originalUrl, {
          headers: { Referer: 'https://mp.weixin.qq.com/' },
        });
        const file = `${String(index).padStart(2, '0')}-${hashString(image.originalUrl).slice(0, 8)}${extension}`;
        await writeFile(path.join(imageDir, file), data);
        console.log(`  ✓ ${file} (${(data.byteLength / 1024).toFixed(0)} KB, ${contentType ?? 'unknown'})`);
      } catch (error) {
        console.log(`  ✗ ${image.originalUrl} -> ${(error as Error).message}`);
      }
    }
  }

  console.log(`[poc] 结果已写入 ${outputDir}`);
}

main().catch((error) => {
  console.error('[poc] 失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});

