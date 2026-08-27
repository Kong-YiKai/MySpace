export class FrameworkError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'FrameworkError';
    this.code = code;
    this.details = details;
  }
}

