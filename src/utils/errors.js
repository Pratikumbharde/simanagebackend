class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(errors) {
    // If errors is a string, use it as the message directly for clear toast display
    if (typeof errors === 'string') {
      super(errors, 400, 'VALIDATION_ERROR');
      this.errors = null;
    } else {
      super('Validation failed', 400, 'VALIDATION_ERROR');
      this.errors = errors;
    }
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden - Insufficient permissions') {
    super(message, 403, 'FORBIDDEN');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400, 'BAD_REQUEST');
  }
}

class SubscriptionLimitError extends AppError {
  constructor(feature, limit) {
    super(`Subscription limit reached for ${feature}. Limit: ${limit}`, 403, 'SUBSCRIPTION_LIMIT');
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  BadRequestError,
  SubscriptionLimitError,
};