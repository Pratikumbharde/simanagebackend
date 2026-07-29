const { body, param, query } = require('express-validator');

/**
 * Validation rules for sending bulk WhatsApp messages
 */
const sendBulkValidation = [
  body('simIds')
    .optional()
    .isArray()
    .withMessage('simIds must be an array')
    .custom((value) => {
      if (value && value.length > 0) {
        const isValid = value.every((id) => /^[0-9a-fA-F]{24}$/.test(id));
        if (!isValid) {
          throw new Error('All simIds must be valid MongoDB ObjectIds');
        }
      }
      return true;
    }),

  body('userIds')
    .optional()
    .isArray()
    .withMessage('userIds must be an array')
    .custom((value) => {
      if (value && value.length > 0) {
        const isValid = value.every((id) => /^[0-9a-fA-F]{24}$/.test(id));
        if (!isValid) {
          throw new Error('All userIds must be valid MongoDB ObjectIds');
        }
      }
      return true;
    }),

  body('message')
    .notEmpty()
    .withMessage('Message is required')
    .trim()
    .isLength({ min: 10, max: 4096 })
    .withMessage('Message must be between 10 and 4096 characters'),

  // Custom validation: at least one of simIds or userIds must have elements
  body().custom((value) => {
    const hasSimIds = value.simIds && value.simIds.length > 0;
    const hasUserIds = value.userIds && value.userIds.length > 0;

    if (!hasSimIds && !hasUserIds) {
      throw new Error('At least one SIM or User must be selected');
    }
    return true;
  }),
];

/**
 * Validation rules for query parameters when fetching messages
 */
const queryValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  query('status')
    .optional()
    .isIn(['sent', 'delivered', 'failed', 'replied', 'inactive'])
    .withMessage('Invalid status value'),

  query('phoneNumber')
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage('Phone number query too long'),

  query('batchId')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Batch ID query too long'),

  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),

  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format'),
];

/**
 * Validation rules for stats endpoint
 */
const statsValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),

  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format'),
];

module.exports = {
  sendBulkValidation,
  queryValidation,
  statsValidation,
};