import type { Request, Response, NextFunction } from 'express';
import type { AnyZodObject } from 'zod';
import { ZodError } from 'zod';
import { AppError } from '../errors/index';

/**
 * Validates body/query/params/cookies against a zod schema and writes the parsed
 * values back, so transforms (e.g. email lowercasing, coercion) reach the handler.
 */
export function validate(schema: AnyZodObject) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
        cookies: req.cookies,
      });
      if (parsed.body !== undefined) req.body = parsed.body;
      if (parsed.params !== undefined) req.params = parsed.params;
      // Express 5 exposes req.query as a getter, so redefine it to hold the parsed copy.
      if (parsed.query !== undefined) {
        Object.defineProperty(req, 'query', { value: parsed.query, writable: true });
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of err.errors) {
          const path = issue.path.join('.');
          if (!fieldErrors[path]) fieldErrors[path] = [];
          fieldErrors[path].push(issue.message);
        }
        throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', fieldErrors);
      }
      next(err);
    }
  };
}
