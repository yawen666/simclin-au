export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function assertFound<T>(value: T | null | undefined, name = 'Resource'): T {
  if (value == null) throw new AppError(404, 'NOT_FOUND', `${name} not found`);
  return value;
}
