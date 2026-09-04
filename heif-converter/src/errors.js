export class ServiceError extends Error {
  constructor(status, code, message, options = {}) {
    super(message, options);
    this.name = 'ServiceError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export const badRequest = (code, message) => new ServiceError(400, code, message);
