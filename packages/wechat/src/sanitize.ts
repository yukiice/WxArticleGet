import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'a',
  'blockquote',
  'br',
  'caption',
  'code',
  'col',
  'colgroup',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'section',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
];

const ALLOWED_ATTR = [
  'alt',
  'class',
  'colspan',
  'data-ratio',
  'data-src',
  'data-type',
  'data-w',
  'height',
  'href',
  'loading',
  'referrerpolicy',
  'rowspan',
  'rel',
  'src',
  'style',
  'target',
  'title',
  'width',
];

const ALLOWED_STYLES: sanitizeHtml.IOptions['allowedStyles'] = {
  '*': {
    'background-color': [/^.*$/],
    'border': [/^.*$/],
    'border-radius': [/^.*$/],
    'color': [/^.*$/],
    'font-family': [/^.*$/],
    'font-size': [/^.*$/],
    'font-style': [/^.*$/],
    'font-weight': [/^.*$/],
    'height': [/^.*$/],
    'letter-spacing': [/^.*$/],
    'line-height': [/^.*$/],
    'margin': [/^.*$/],
    'margin-bottom': [/^.*$/],
    'margin-left': [/^.*$/],
    'margin-right': [/^.*$/],
    'margin-top': [/^.*$/],
    'max-width': [/^.*$/],
    'padding': [/^.*$/],
    'padding-bottom': [/^.*$/],
    'padding-left': [/^.*$/],
    'padding-right': [/^.*$/],
    'padding-top': [/^.*$/],
    'text-align': [/^.*$/],
    'text-decoration': [/^.*$/],
    'text-indent': [/^.*$/],
    'vertical-align': [/^.*$/],
    'white-space': [/^.*$/],
    'width': [/^.*$/],
    'word-break': [/^.*$/],
  },
};

const BLOCKED_STYLE_URL = /url\s*\(/i;

export function sanitizeContentHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { '*': ALLOWED_ATTR },
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: ['http', 'https', 'data', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    disallowedTagsMode: 'discard',
    transformTags: {
      img: (tagName, attribs) => {
        const src = attribs['data-src'] || attribs.src || '';
        const style = attribs.style && !BLOCKED_STYLE_URL.test(attribs.style) ? attribs.style : undefined;
        return {
          tagName,
          attribs: {
            src,
            alt: attribs.alt ?? '',
            loading: 'lazy',
            referrerpolicy: 'no-referrer',
            ...(attribs.width ? { width: attribs.width } : {}),
            ...(attribs.height ? { height: attribs.height } : {}),
            ...(style ? { style } : {}),
            ...(attribs['data-w'] ? { 'data-w': attribs['data-w'] } : {}),
            ...(attribs['data-ratio'] ? { 'data-ratio': attribs['data-ratio'] } : {}),
          },
        };
      },
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          href: attribs.href ?? '#',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    },
  });
}

export function htmlToPlainText(html: string): string {
  const $ = cheerio.load(`<div id="__root__">${html}</div>`);
  const text = $('#__root__').text();
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, all) => line.length > 0 || (index > 0 && all[index - 1].length > 0))
    .join('\n')
    .trim();
}

/** 中文按字计，英文按词计 */
export function countWords(text: string): number {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9_'-]+/g)?.length ?? 0;
  return cjk + latin;
}

export interface ExtractedImage {
  originalUrl: string;
  width?: number;
  height?: number;
}

export function extractImages(html: string): ExtractedImage[] {
  const $ = cheerio.load(`<div id="__root__">${html}</div>`);
  const images: ExtractedImage[] = [];
  const seen = new Set<string>();

  $('#__root__ img').each((_, element) => {
    const src = $(element).attr('src');
    if (!src || !/^https?:\/\//i.test(src) || seen.has(src)) return;
    seen.add(src);

    const width = Number($(element).attr('data-w') ?? '') || undefined;
    const ratio = Number($(element).attr('data-ratio') ?? '') || undefined;
    const height = width && ratio ? Math.round(width * ratio) : undefined;

    images.push({ originalUrl: src, width, height });
  });

  return images;
}
