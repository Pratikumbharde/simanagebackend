/**
 * Call Automation Routes
 *
 * API routes for call automation configuration management.
 * UPDATED: Now supports per-target caller assignment.
 */

const express = require('express');
const router = express.Router();
const { body, query, param } = require('express-validator');
const callAutomationController = require('../../controllers/callAutomation/callAutomation.controller');
const { authenticate, authorize, checkCompanyAccess } = require('../../middleware/auth');
const { checkSubscriptionFeature } = require('../../middleware/subscription');
const { validate } = require('../../middleware/validate');

// =============================================
// VALIDATION RULES
// =============================================

// Updated validation for new format with targetCallerMappings
const saveConfigValidation = [
  body('targetCallerMappings')
    .isArray({ min: 1 })
    .withMessage('At least one target-caller mapping is required'),
  body('targetCallerMappings.*.targetSimId')
    .isMongoId()
    .withMessage('Each mapping must have a valid target SIM ID'),
  body('targetCallerMappings.*.callerSimIds')
    .isArray({ min: 1 })
    .withMessage('Each target must have at least one caller SIM'),
  body('targetCallerMappings.*.callerSimIds.*')
    .isMongoId()
    .withMessage('Each caller SIM ID must be a valid MongoDB ID'),
  body('targetCallerMappings.*.callDuration')
    .optional()
    .isInt({ min: 10, max: 60 })
    .withMessage('Per-target call duration must be between 10 and 60 seconds'),
  body('callDuration')
    .optional()
    .isInt({ min: 10, max: 60 })
    .withMessage('Global call duration must be between 10 and 60 seconds'),
  body('frequency')
    .optional()
    .isIn(['hourly', 'daily', 'weekly'])
    .withMessage('Frequency must be hourly, daily, or weekly'),
  body('scheduledTime')
    .optional()
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .withMessage('Scheduled time must be in HH:MM format'),
  body('scheduledDay')
    .optional()
    .isIn(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])
    .withMessage('Scheduled day must be a valid day of week'),
  body('hourlyShiftStartTime')
    .optional()
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .withMessage('Hourly shift start time must be in HH:MM format'),
  body('hourlyShiftEndTime')
    .optional()
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .withMessage('Hourly shift end time must be in HH:MM format'),
  // Custom validation: shift start and end must not be the same
  body('hourlyShiftStartTime').custom((startTime, { req }) => {
    const endTime = req.body.hourlyShiftEndTime;
    // Only validate if both are provided
    if (startTime && endTime && startTime === endTime) {
      throw new Error('Hourly shift start time and end time cannot be the same');
    }
    return true;
  }),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  // Custom validation: no overlap between callers and targets
  body('targetCallerMappings').custom((mappings) => {
    const allTargetIds = mappings.map(m => m.targetSimId);
    const allCallerIds = mappings.flatMap(m => m.callerSimIds);
    const overlap = allTargetIds.filter(id => allCallerIds.includes(id));
    if (overlap.length > 0) {
      throw new Error('A SIM cannot be both a caller and a target');
    }
    return true;
  }),
];

const toggleValidation = [
  body('isActive')
    .isBoolean()
    .withMessage('isActive must be a boolean'),
];

const addMappingValidation = [
  body('targetSimId')
    .isMongoId()
    .withMessage('Target SIM ID must be a valid MongoDB ID'),
  body('callerSimIds')
    .isArray({ min: 1 })
    .withMessage('At least one caller SIM is required'),
  body('callerSimIds.*')
    .isMongoId()
    .withMessage('Each caller SIM ID must be a valid MongoDB ID'),
  body('callDuration')
    .optional()
    .isInt({ min: 10, max: 60 })
    .withMessage('Call duration must be between 10 and 60 seconds'),
];

const removeMappingValidation = [
  param('targetSimId')
    .isMongoId()
    .withMessage('Target SIM ID must be a valid MongoDB ID'),
];

const deviceConfigValidation = [
  query('simNumber')
    .optional()
    .matches(/^\+?\d{10,15}$/)
    .withMessage('Invalid SIM number format'),
];

// =============================================
// ADMIN ROUTES (require authentication)
// =============================================

// All routes below require authentication
router.use(authenticate);

// Feature check for Call Automation (skip for super_admin)
router.use((req, res, next) => {
  if (req.user?.role === 'super_admin') return next();
  return checkSubscriptionFeature('callAutomation')(req, res, next);
});

// Save/update configuration (admin only)
router.post(
  '/config',
  authorize('super_admin', 'admin'),
  checkCompanyAccess,
  saveConfigValidation,
  validate,
  callAutomationController.saveConfig
);

// Get configuration (admin only)
router.get(
  '/config',
  authorize('super_admin', 'admin'),
  checkCompanyAccess,
  callAutomationController.getConfig
);

// Toggle active status (admin only)
router.put(
  '/toggle',
  authorize('super_admin', 'admin'),
  checkCompanyAccess,
  toggleValidation,
  validate,
  callAutomationController.toggleActive
);

// Delete configuration (admin only)
router.delete(
  '/config',
  authorize('super_admin', 'admin'),
  checkCompanyAccess,
  callAutomationController.deleteConfig
);

// Get eligible SIMs for selection (admin only)
router.get(
  '/eligible-sims',
  authorize('super_admin', 'admin'),
  checkCompanyAccess,
  callAutomationController.getEligibleSims
);

// Add a new target-caller mapping (admin only)
router.post(
  '/mapping',
  authorize('super_admin', 'admin'),
  checkCompanyAccess,
  addMappingValidation,
  validate,
  callAutomationController.addTargetMapping
);

// Remove a target-caller mapping (admin only)
router.delete(
  '/mapping/:targetSimId',
  authorize('super_admin', 'admin'),
  checkCompanyAccess,
  removeMappingValidation,
  validate,
  callAutomationController.removeTargetMapping
);

// Get call attempt history (admin only)
router.get(
  '/call-attempts',
  authorize('super_admin', 'admin'),
  checkCompanyAccess,
  callAutomationController.getCallAttempts
);

// Get connection status for each target SIM (admin only)
router.get(
  '/connection-status',
  authorize('super_admin', 'admin'),
  checkCompanyAccess,
  callAutomationController.getConnectionStatus
);

// =============================================
// DEVICE ROUTES (public, uses SIM auth)
// =============================================

// Note: Device routes are registered separately in server.js under /api/device
// This file only handles /api/call-automation routes

module.exports = router;