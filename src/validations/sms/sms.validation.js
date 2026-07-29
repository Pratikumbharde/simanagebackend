const { body, query, param } = require('express-validator');

// Validation rules for SMS sync (mobile API)
const syncValidation = [
  body('simNumber')
    .notEmpty()
    .withMessage('SIM number is required')
    .matches(/^\+?\d{10,15}$/)
    .withMessage('Valid SIM number required (Must be 10-15 digits)'),
  body('messages')
    .isArray({ min: 1 })
    .withMessage('Messages array is required'),
  body('messages.*.sender')
    .notEmpty()
    .withMessage('Sender is required')
    .isString()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Sender cannot exceed 50 characters'),
  body('messages.*.message')
    .notEmpty()
    .withMessage('Message is required')
    .isString()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Message cannot exceed 5000 characters'),
  body('messages.*.timestamp')
    .isISO8601()
    .withMessage('Valid timestamp is required'),
  body('messages.*.type')
    .optional()
    .isIn(['inbox', 'sent'])
    .withMessage('Type must be inbox or sent'),
];

// Validation rules for SMS query (admin API)
const queryValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('userId')
    .optional()
    .isMongoId()
    .withMessage('Invalid user ID'),
  query('simId')
    .optional()
    .isMongoId()
    .withMessage('Invalid SIM ID'),
  query('type')
    .optional()
    .isIn(['inbox', 'sent'])
    .withMessage('Type must be inbox or sent'),
  query('sender')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Sender cannot exceed 50 characters'),
  query('search')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Search cannot exceed 200 characters'),
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid from date'),
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid to date'),
  query('sortBy')
    .optional()
    .isIn(['timestamp', 'sender', 'type'])
    .withMessage('Invalid sort field'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Sort order must be asc or desc'),
];

// Validation for export
const exportValidation = [
  query('userId')
    .optional()
    .isMongoId()
    .withMessage('Invalid user ID'),
  query('simId')
    .optional()
    .isMongoId()
    .withMessage('Invalid SIM ID'),
  query('type')
    .optional()
    .isIn(['inbox', 'sent'])
    .withMessage('Type must be inbox or sent'),
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid from date'),
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid to date'),
];

module.exports = {
  syncValidation,
  queryValidation,
  exportValidation,
};