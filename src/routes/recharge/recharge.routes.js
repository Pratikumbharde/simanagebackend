const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const rechargeController = require('../../controllers/recharge/recharge.controller');
const { authenticate, authorize, optionalAuth } = require('../../middleware/auth');
const { checkSubscriptionFeature } = require('../../middleware/subscription');
const { validate } = require('../../middleware/validate');
const { optionalReceiptUpload } = require('../../middleware/upload');

// =============================================
// AUTO-RECHARGE ROUTE (for SMS integration)
// =============================================
// This endpoint is placed BEFORE authenticate middleware
// so it can be called without authentication for external SMS processing systems
// If auth token is provided, it will be used for audit logging
const autoCreateRechargeValidation = [
  body('mobileNumber')
    .notEmpty().withMessage('Contact Number is required')
    .custom((value) => {
      // Accept 10 digits, or with country code (+91XXXXXXXXXX, 91XXXXXXXXXX)
      const cleaned = value.replace(/[\s\-\(\)]/g, '');
      if (/^\+?\d{10,15}$/.test(cleaned)) return true;
      throw new Error('Invalid Contact Number format. Must be Must be 10-15 digits');
    }),
  body('amount')
    .notEmpty().withMessage('Amount is required')
    .isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  body('operator')
    .optional()
    .isIn(['Jio', 'Airtel', 'Vi', 'BSNL', 'MTNL', 'Other'])
    .withMessage('Invalid operator'),
  body('planName')
    .optional()
    .isString()
    .withMessage('Plan name must be a string'),
  body('validity')
    .optional()
    .custom((value) => {
      // Accept number or string like "28 days" or "28"
      if (typeof value === 'number' && value > 0) return true;
      if (typeof value === 'string' && /^\d+(\s*days?)?$/i.test(value.trim())) return true;
      throw new Error('Validity must be a number or string like "28 days"');
    }),
  body('rechargeDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid recharge date format'),
  body('smsText')
    .optional()
    .isString()
    .withMessage('SMS text must be a string'),
  body('transactionId')
    .optional()
    .isString()
    .withMessage('Transaction ID must be a string'),
];

router.post(
  '/auto-create',
  optionalAuth,
  autoCreateRechargeValidation,
  validate,
  rechargeController.createAuto
);

// =============================================
// AUTHENTICATED ROUTES (require authentication)
// =============================================
// All routes below require authentication
router.use(authenticate);

// Validation rules for manual recharge
const createRechargeValidation = [
  body('simId').isMongoId().withMessage('Valid SIM ID is required'),
  body('amount').isFloat({ min: 0 }).withMessage('Valid amount is required'),
  body('validity').optional().isInt({ min: 1 }).withMessage('Validity must be at least 1 day'),
  body('rechargeDate').optional().isISO8601().withMessage('Invalid date'),
  body('paymentMethod').optional().isIn(['cash', 'upi', 'card', 'netbanking', 'wallet', 'other']),
  body('transactionId').optional().isString(),
  body('notes').optional().isString().isLength({ max: 500 }),
  body('plan.name').optional().isString(),
  body('plan.validity').optional().isInt(),
  body('plan.data').optional().isString(),
  body('plan.calls').optional().isString(),
  body('plan.sms').optional().isString(),
];

const updateRechargeValidation = [
  param('id').isMongoId().withMessage('Invalid recharge ID'),
  body('amount').optional().isFloat({ min: 0 }),
  body('validity').optional().isInt({ min: 1 }),
  body('notes').optional().isString().isLength({ max: 500 }),
  body('status').optional().isIn(['pending', 'completed', 'failed', 'refunded']),
];

const queryValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('simId').optional().isMongoId(),
  query('status').optional().isIn(['pending', 'completed', 'failed', 'refunded']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('sortBy').optional().isIn(['rechargeDate', 'amount', 'nextRechargeDate']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
];

// Routes
router.post('/', optionalReceiptUpload, createRechargeValidation, validate, rechargeController.create);
router.get('/', queryValidation, validate, rechargeController.getAll);
router.get('/export', checkSubscriptionFeature('excelExport'), rechargeController.export);
router.get('/upcoming', rechargeController.getUpcoming);
router.get('/overdue', rechargeController.getOverdue);
router.get('/stats', rechargeController.getStats);
router.get('/history/:simId', rechargeController.getHistory);
router.get('/:id', rechargeController.getById);
router.put('/:id', optionalReceiptUpload, updateRechargeValidation, validate, rechargeController.update);
router.delete('/:id', authorize('super_admin', 'admin'), rechargeController.delete);

// Admin only - manual trigger
router.post('/process-reminders', authorize('super_admin'), rechargeController.processReminders);

module.exports = router;