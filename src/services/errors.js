// Errors a service throws on purpose. A service knows nothing about HTTP:
// src/routes/errors.js turns each class into a status code.
export class ServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidInput extends ServiceError {}

export class WrongCredentials extends ServiceError {
  constructor() {
    super('Wrong email or password.');
  }
}

export class NotSignedIn extends ServiceError {
  constructor() {
    super('Sign in first.');
  }
}
