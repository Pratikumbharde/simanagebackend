const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const reportScheduleController = require('../../controllers/reportSchedule/reportSchedule.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');

// Validation rules
const createValidation = [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email')
    .normalizeEmail(),
  body('name')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Name cannot exceed 100 characters'),
  body('schedules')
    .isArray({ min: 1 })
    .withMessage('At least one schedule frequency is required'),
  body('schedules.*')
    .isIn(['daily', 'weekly', 'monthly'])
    .withMessage('Each schedule must be daily, weekly, or monthly'),
  body('time')
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .withMessage('Time must be in HH:mm format (24-hour)'),
  body('timezone')
    .optional()
    .isString()
    .withMessage('Timezone must be a string'),
  body('daysOfWeek')
    .optional()
    .isArray()
    .withMessage('Days of week must be an array'),
  body('daysOfWeek.*')
    .optional()
    .isInt({ min: 0, max: 6 })
    .withMessage('Each day of week must be 0-6 (Sunday=0, Saturday=6)'),
  body('daysOfMonth')
    .optional()
    .isArray()
    .withMessage('Days of month must be an array'),
  body('daysOfMonth.*')
    .optional()
    .isInt({ min: 1, max: 31 })
    .withMessage('Each day of month must be 1-31'),
  body('reportTypes')
    .isArray({ min: 1 })
    .withMessage('At least one report type is required'),
  body('reportTypes.*')
    .isIn(['overview', 'sims', 'recharges', 'callLogs'])
    .withMessage('Each report type must be overview, sims, recharges, or callLogs'),
];

const updateValidation = [
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please enter a valid email')
    .normalizeEmail(),
  body('name')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Name cannot exceed 100 characters'),
  body('schedules')
    .optional()
    .isArray({ min: 1 })
    .withMessage('At least one schedule frequency is required'),
  body('schedules.*')
    .optional()
    .isIn(['daily', 'weekly', 'monthly'])
    .withMessage('Each schedule must be daily, weekly, or monthly'),
  body('time')
    .optional()
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .withMessage('Time must be in HH:mm format (24-hour)'),
  body('timezone')
    .optional()
    .isString()
    .withMessage('Timezone must be a string'),
  body('daysOfWeek')
    .optional()
    .isArray()
    .withMessage('Days of week must be an array'),
  body('daysOfWeek.*')
    .optional()
    .isInt({ min: 0, max: 6 })
    .withMessage('Each day of week must be 0-6'),
  body('daysOfMonth')
    .optional()
    .isArray()
    .withMessage('Days of month must be an array'),
  body('daysOfMonth.*')
    .optional()
    .isInt({ min: 1, max: 31 })
    .withMessage('Each day of month must be 1-31'),
  body('reportTypes')
    .optional()
    .isArray({ min: 1 })
    .withMessage('At least one report type is required'),
  body('reportTypes.*')
    .optional()
    .isIn(['overview', 'sims', 'recharges', 'callLogs'])
    .withMessage('Each report type must be overview, sims, recharges, or callLogs'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
];

const idValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid schedule ID'),
];

// All routes require authentication and admin role
router.use(authenticate);
router.use(authorize('admin', 'super_admin'));

// Routes
router.get('/', reportScheduleController.getAll);
router.get('/:id', idValidation, validate, reportScheduleController.getById);
router.post('/', createValidation, validate, reportScheduleController.create);
router.put('/:id', idValidation, updateValidation, validate, reportScheduleController.update);
router.patch('/:id/toggle', idValidation, validate, reportScheduleController.toggle);
router.delete('/:id', idValidation, validate, reportScheduleController.delete);
router.post('/test', reportScheduleController.sendTest);
router.post('/debug-email', reportScheduleController.debugEmail);

module.exports = router;