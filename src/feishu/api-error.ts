export class FeishuApiError extends Error {
  readonly status: number;
  readonly responseCode?: number;
  readonly responseBody?: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      responseCode?: number;
      responseBody?: unknown;
    }
  ) {
    super(message);
    this.name = "FeishuApiError";
    this.status = options.status;
    this.responseCode = options.responseCode;
    this.responseBody = options.responseBody;
  }
}
