const { validationResult } = require('express-validator');
const { ValidationError } = require('../utils/errors');

const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map((error) => ({
      field: error.path,
      message: error.msg,
    }));

    console.error('[Validation] FAILED - Method:', req.method, 'Path:', req.originalUrl);
    console.error('[Validation] Request body:', JSON.stringify(req.body, null, 2));
    console.error('[Validation] Errors:', JSON.stringify(formattedErrors, null, 2));

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: formattedErrors,
    });
  }

  next();
};

const validateRequest = (schema) => {
  return async (req, res, next) => {
    try {
      await schema.validateAsync(req.body, { abortEarly: false });
      next();
    } catch (error) {
      if (error.name === 'ValidationError') {
        const errors = error.details.map((detail) => ({
          field: detail.path.join('.'),
          message: detail.message,
        }));

        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors,
        });
      }
      next(error);
    }
  };
};

module.exports = {
  validate,
  validateRequest,
};