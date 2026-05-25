export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = "APP_ERROR"
  ) {
    super(message);
  }
}

export const notFound = (message: string) =>
  new AppError(404, message, "NOT_FOUND");

export const forbidden = (message: string) =>
  new AppError(403, message, "FORBIDDEN");

export const badRequest = (message: string) =>
  new AppError(400, message, "BAD_REQUEST");
