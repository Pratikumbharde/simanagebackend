const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const callLogController = require('../../controllers/callLog/callLog.controller');
const { authenticate, checkCompanyAccess } = require('../../middleware/auth');
const { checkSubscriptionLimit, checkSubscriptionFeature } = require('../../middleware/subscription');
const { validate } = require('../../middleware/validate');
// [PHONE NORMALIZATION FIX]
const { normalizePhoneNumber } = require('../../utils/response');

// Validation rules
const syncValidation = [
  body('simId').isMongoId().withMessage('Valid SIM ID is required'),
  body('callLogs').isArray({ min: 1 }).withMessage('Call logs array is required'),
  body('callLogs.*.phoneNumber').notEmpty().withMessage('Phone number is required'),
  body('callLogs.*.callType').isIn(['incoming', 'outgoing', 'missed']).withMessage('Invalid call type'),
  body('callLogs.*.duration').optional().isInt({ min: 0 }),
  body('callLogs.*.timestamp').isISO8601().withMessage('Valid timestamp is required'),
  body('callLogs.*.contactName').optional().isString(),
];

// [PHONE NORMALIZATION FIX] - Validation rules for device sync (public endpoint)
// Custom validator for Contact Number (accepts 10 digits or with country code)
const validateMobileNumberForCallLog = (value) => {
  const { valid } = normalizePhoneNumber(value);
  return valid;
};

const deviceSyncValidation = [
  body('mobileNumber')
    .custom(validateMobileNumberForCallLog)
    .withMessage('Invalid Contact Number. Enter 10 digits or number with country code (e.g., +91XXXXXXXXXX)')
    .trim()
    .customSanitizer(value => {
      // [PHONE NORMALIZATION FIX] - Sanitize: normalize the phone number
      const { normalized } = normalizePhoneNumber(value);
      return normalized || value;
    }),
  body('callLogs').isArray({ min: 1 }).withMessage('Call logs array is required'),
  body('callLogs.*.phoneNumber').notEmpty().withMessage('Phone number is required'),
  body('callLogs.*.callType').isIn(['incoming', 'outgoing', 'missed']).withMessage('Invalid call type'),
  body('callLogs.*.duration').optional().isInt({ min: 0 }),
  body('callLogs.*.timestamp').isISO8601().withMessage('Valid timestamp is required'),
  body('callLogs.*.contactName').optional().isString(),
];

// [MULTI-SIM SUPPORT] - Validation rules for user-specific call log sync
const userSyncValidation = [
  body('simNumber')
    .notEmpty()
    .withMessage('SIM number is required')
    .matches(/^\+?\d{10,15}$/)
    .withMessage('Valid SIM number required (Must be 10-15 digits)'),
  body('callLogs').isArray({ min: 1 }).withMessage('Call logs array is required'),
  body('callLogs.*.phoneNumber').notEmpty().withMessage('Phone number is required'),
  body('callLogs.*.callType').isIn(['incoming', 'outgoing', 'missed']).withMessage('Invalid call type'),
  body('callLogs.*.duration').optional().isInt({ min: 0 }),
  body('callLogs.*.timestamp').isISO8601().withMessage('Valid timestamp is required'),
  body('callLogs.*.contactName').optional().isString(),
];

const queryValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('simId').optional().isMongoId(),
  query('callType').optional().isIn(['incoming', 'outgoing', 'missed']),
  // [PHONE SEARCH FIX] - Sanitize phone number: trim and remove special characters that could break regex
  query('phoneNumber').optional().trim().customSanitizer(value => {
    if (!value) return value;
    // Remove tabs, newlines, and extra spaces
    return value.replace(/[\t\n\r\s]+/g, ' ').trim();
  }),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('uniqueOnly').optional().isIn(['true', 'false']),
  query('sortBy').optional().isIn(['timestamp', 'duration', 'callType']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
];

const flagValidation = [
  param('id').isMongoId().withMessage('Invalid call log ID'),
  body('flagged').isBoolean().withMessage('Flagged must be a boolean'),
  body('reason').optional().isString().isLength({ max: 200 }),
];

// Public routes (no authentication required)
router.post('/device-sync', deviceSyncValidation, validate, callLogController.deviceSync);

// All routes below require authentication
router.use(authenticate);

// Routes
router.post('/sync', checkSubscriptionLimit('callLogSync'), syncValidation, validate, callLogController.sync);
router.post('/sync-user', userSyncValidation, validate, callLogController.syncUserLogs);
router.get('/', queryValidation, validate, callLogController.getAll);
router.get('/stats', callLogController.getStats);
router.get('/export', checkSubscriptionFeature('excelExport'), callLogController.export);
router.get('/:id', callLogController.getById);
router.get('/sim/:simId/stats', callLogController.getSimStats);
router.patch('/:id/flag', flagValidation, validate, callLogController.flag);

module.exports = router;