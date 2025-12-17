export class BaseError extends Error {
  public statusCode: number;
  public code: string;
  public data?: unknown;

  constructor(message: string, statusCode = 500, code = "INTERNAL_ERROR", data?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;
  }

  toJSON() {
    return {
      success: false,
      message: this.message,
      statusCode: this.statusCode,
      code: this.code,
      data: this.data ?? null,
    };
  }
}
