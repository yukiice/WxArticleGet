import { BadRequestException } from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';

export function parseOrThrow<TSchema extends ZodTypeAny>(schema: TSchema, data: unknown): z.infer<TSchema> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const message = result.error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('；');
  throw new BadRequestException(message || '请求参数不合法');
}
