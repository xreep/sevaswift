export interface ProblemDetails {
  status: number;
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  instance?: string;
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>
  ) {
    super(message);
    this.name = 'AppError';
  }

  toProblemDetails(instance?: string): ProblemDetails {
    return {
      status: this.status,
      code: this.code,
      message: this.message,
      fieldErrors: this.fieldErrors,
      instance,
    };
  }
}

export function badRequest(code: string, message: string, fieldErrors?: Record<string, string[]>): AppError {
  return new AppError(400, code, message, fieldErrors);
}

export function unauthorized(code: string, message: string): AppError {
  return new AppError(401, code, message);
}

export function forbidden(code: string, message: string): AppError {
  return new AppError(403, code, message);
}

export function notFound(code: string, message: string): AppError {
  return new AppError(404, code, message);
}

export function conflict(code: string, message: string): AppError {
  return new AppError(409, code, message);
}

export function tooManyRequests(code: string, message: string): AppError {
  return new AppError(429, code, message);
}

export function internal(code: string, message: string): AppError {
  return new AppError(500, code, message);
}