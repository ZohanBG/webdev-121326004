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

/** Too many failed sign-ins for one email from one address (AC-45). */
export class TooManyAttempts extends ServiceError {
  constructor() {
    super('Too many sign-in attempts. Try again in 15 minutes.');
  }
}

export class NotSignedIn extends ServiceError {
  constructor() {
    super('Sign in first.');
  }
}

/** Signed in, but this person may not do this. */
export class Forbidden extends ServiceError {}

export class NotFound extends ServiceError {}

/** The request is fine, but it clashes with what is already in the database. */
export class Conflict extends ServiceError {}
