/** Application error with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Optional, safe, structured detail for the client (for example, which documents were not usable). */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
