const express = require('express');
const router = express.Router();
const smsController = require('../../controllers/sms/sms.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { checkSubscriptionFeature } = require('../../middleware/subscription');
const { validate } = require('../../middleware/validate');
const {
  syncValidation,
  queryValidation,
  exportValidation,
} = require('../../validations/sms/sms.validation');

// All routes require authentication
router.use(authenticate);

// Feature check for SMS Logs (skip for super_admin)
router.use((req, res, next) => {
  if (req.user?.role === 'super_admin') return next();
  return checkSubscriptionFeature('smsLogs')(req, res, next);
});

// Sync SMS from mobile device (user role)
router.post(
  '/sync',
  syncValidation,
  validate,
  smsController.sync
);

// Get all SMS logs with filters (admin role)
router.get(
  '/',
  authorize('admin', 'super_admin'),
  queryValidation,
  validate,
  smsController.getAll
);

// Get SMS statistics (admin role)
router.get(
  '/stats',
  authorize('admin', 'super_admin'),
  smsController.getStats
);

// Get unique senders (admin role)
router.get(
  '/senders',
  authorize('admin', 'super_admin'),
  smsController.getSenders
);

// Export SMS logs to Excel (admin role)
router.get(
  '/export',
  authorize('admin', 'super_admin'),
  exportValidation,
  validate,
  smsController.export
);

// Get SMS by ID (admin role)
router.get(
  '/:id',
  authorize('admin', 'super_admin'),
  smsController.getById
);

// Get SMS count by SIM (admin role)
router.get(
  '/sim/:simId/stats',
  authorize('admin', 'super_admin'),
  smsController.getSimStats
);

module.exports = router;