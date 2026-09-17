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

// 样式值按语义归类：颜色（hex / rgb / hsl / 关键字）、长度（数值+单位 / 0 / auto）、
// 单值关键字的固定枚举。不再用 "任意字符串" 正则，避免 style 被用来藏 href 一样的攻击面。
const CSS_COLOR = /^(?:[-a-z]+|#[0-9a-fA-F]{3,8}|rgba?\([\d\s,.%]+\)$|hsla?\((?:[\d\s,.%]|deg)+\))$/i;
const CSS_LENGTH = /^(?:0|auto|normal|(?:\d+(?:\.\d+)?(?:px|%|em|rem|pt|vh|vw|ex|ch)?)\s*)+(?:,[-\w'" ]+)?$/;
const CSS_KEYWORD_ONLY = /^[a-z-]+$/;
const CSS_BORDER = /^(?:(?:\d+(?:\.\d+)?(?:px|pt|em|rem|%)?|none|hidden|dashed|dotted|double|groove|inset|outset|ridge|solid|transparent|[-a-z]+|#[0-9a-fA-F]{3,8}|rgba?\([\d\s,.%]+\)|hsla?\((?:[\d\s,.%]|deg)+\))(?:\s+|$))+$/i;

const ALLOWED_STYLES: sanitizeHtml.IOptions['allowedStyles'] = {
  '*': {
    'background-color': [CSS_COLOR],
    'border': [CSS_BORDER],
    'border-radius': [CSS_LENGTH],
    'color': [CSS_COLOR],
    'font-family': [/^[^();<>{}]+$/],
    'font-size': [CSS_LENGTH],
    'font-style': [CSS_KEYWORD_ONLY],
    'font-weight': [/^(?:[1-9]00|bold|normal|lighter|bolder)$/],
    'height': [CSS_LENGTH],
    'letter-spacing': [/^(?:0|normal|(?:\d+(?:\.\d+)?(?:px|%|em|rem|pt)?))$/],
    'line-height': [/^(?:\d+(?:\.\d+)?(?:px|%|em|rem)?|normal)$/],
    'margin': [CSS_LENGTH],
    'margin-bottom': [CSS_LENGTH],
    'margin-left': [CSS_LENGTH],
    'margin-right': [CSS_LENGTH],
    'margin-top': [CSS_LENGTH],
    'max-width': [/^(?:none|(?:\d+(?:\.\d+)?(?:px|%|em|rem|pt|vh|vw)?))$/],
    'padding': [CSS_LENGTH],
    'padding-bottom': [CSS_LENGTH],
    'padding-left': [CSS_LENGTH],
    'padding-right': [CSS_LENGTH],
    'padding-top': [CSS_LENGTH],
    'text-align': [/^(?:left|right|center|justify|start|end)$/],
    'text-decoration': [/^(?:none|underline(?:\s+[-\w]+)*|overline(?:\s+[-\w]+)*|line-through(?:\s+[-\w]+)*)$/],
    'text-indent': [CSS_LENGTH],
    'vertical-align': [/^(?:top|middle|bottom|baseline|sub|super|text-top|text-bottom|(?:\d+(?:\.\d+)?(?:px|%|em|rem)?)|-?)$/],
    'white-space': [/^(?:normal|pre|nowrap|pre-wrap|pre-line|break-spaces)$/],
    'width': [CSS_LENGTH],
    'word-break': [/^(?:normal|break-all|keep-all|break-word)$/],
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
