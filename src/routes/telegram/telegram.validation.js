const { body, query, param } = require('express-validator');

/**
 * Validation for sending bulk Telegram messages
 */
const sendBulkValidation = [
  body('simIds')
    .isArray({ min: 1 })
    .withMessage('SIM IDs must be a non-empty array'),
  body('simIds.*')
    .isMongoId()
    .withMessage('Each SIM ID must be a valid MongoDB ObjectId'),
  body('message')
    .trim()
    .notEmpty()
    .withMessage('Message is required')
    .isLength({ min: 10 })
    .withMessage('Message must be at least 10 characters')
    .isLength({ max: 4096 })
    .withMessage('Message cannot exceed 4096 characters'),
];

/**
 * Validation for query parameters
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
  query('simId')
    .optional()
    .isMongoId()
    .withMessage('SIM ID must be a valid MongoDB ObjectId'),
  query('chatId')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Chat ID cannot be empty'),
  query('batchId')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Batch ID cannot be empty'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
];

/**
 * Validation for statistics
 */
const statsValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
];

/**
 * Validation for SIM ID parameter
 */
const simIdValidation = [
  param('simId')
    .isMongoId()
    .withMessage('SIM ID must be a valid MongoDB ObjectId'),
];

/**
 * Validation for setting webhook
 */
const setWebhookValidation = [
  body('webhookUrl')
    .trim()
    .notEmpty()
    .withMessage('Webhook URL is required')
    .isURL({ protocols: ['http', 'https'] })
    .withMessage('Webhook URL must be a valid URL'),
];

module.exports = {
  sendBulkValidation,
  queryValidation,
  statsValidation,
  simIdValidation,
  setWebhookValidation,
};