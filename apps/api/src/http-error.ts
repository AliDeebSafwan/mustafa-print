import { formatIssues, type ApiErrorCode } from '@mpe/shared';
import type { z } from 'zod';

/** An error that maps directly to an HTTP response: { error: <code>, message }. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly headers: Record<string, string>;

  constructor(status: number, code: ApiErrorCode, message?: string, headers: Record<string, string> = {}) {
    super(message ?? code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export { formatIssues };

/** Validate untrusted input with a shared schema; failures become a 400 the client can show. */
export function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'invalid_request', formatIssues(result.error));
  return result.data;
}
