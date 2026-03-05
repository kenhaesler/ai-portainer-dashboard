export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly userMessage: string,
    public readonly requestId?: string,
  ) {
    super(userMessage);
    this.name = 'ApiError';
  }
}
