import type { RequestHandler } from 'express';

/** 也阻止升级前可能已落盘的 HTML/SVG 文件被同源执行。 */
export const imageFilesOnly: RequestHandler = (request, response, next) => {
  if (!/^\/(images|covers)\/[a-z0-9]+\/[a-f0-9]{24}\.(png|jpe?g|gif|webp)$/.test(request.path)) {
    response.sendStatus(404);
    return;
  }
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  next();
};
