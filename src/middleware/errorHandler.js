const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  // Log all errors for debugging
  console.error('[ERROR]', {
    message: err.message,
    code: err.code || err.errorCode,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  logger.error('Error occurred', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
    user: req.user?._id,
  });

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((el) => ({
      field: el.path,
      message: el.message,
    }));

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    let message = `${field} already exists`;

    // [GLOBAL UNIQUE EMAIL] Provide more specific error messages
    if (field === 'email') {
      message = 'This Email ID is already registered in the system. Each email can only be used once.';
    } else if (field === 'mobileNumber') {
      message = 'This phone number is already registered in the system. Please use a different phone number.';
    }

    return res.status(409).json({
      success: false,
      message,
      errors: [{ field, message }],
    });
  }

  // Mongoose cast error (invalid ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid ${err.path}: ${err.value}`,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired',
    });
  }

  // Operational errors (trusted)
  if (err instanceof AppError && err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errorCode: err.errorCode,
      errors: err.errors || null,
    });
  }

  // Programming or unknown errors
  return res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Something went wrong'
      : err.message,
  });
};

module.exports = errorHandler;