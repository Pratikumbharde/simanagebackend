const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const userController = require('../../controllers/user/user.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { checkSubscriptionLimit } = require('../../middleware/subscription');
const { validate } = require('../../middleware/validate');

// Validation rules
const createUserValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('email').isEmail().withMessage('Valid email is required').trim(),
  // body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('password')
    .optional({ checkFalsy: true })
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
  // [PHONE VALIDATION FIX] - Accept phone with or without country code (same as SIM module)
  // Accepts: +9713211236540 (with country code) or 9876543210 (10 digits)
  body('phone').optional().matches(/^\+?\d{10,15}$/).withMessage('Invalid phone number (Must be 10-15 digits)'),
];

const updateUserValidation = [
  param('id').isMongoId().withMessage('Invalid user ID'),
  body('name').optional().trim().isLength({ max: 100 }),
  // [PHONE VALIDATION FIX] - Accept phone with or without country code (same as SIM module)
  // { checkFalsy: true } allows clearing the phone field (empty string, null, undefined skip validation)
  body('phone').optional({ checkFalsy: true }).matches(/^\+?\d{10,15}$/).withMessage('Invalid phone number (Must be 10-15 digits)'),
  body('isActive').optional().isBoolean(),
  body('dataSync').optional().isBoolean().withMessage('Data sync must be a boolean'),
];

const resetPasswordValidation = [
  param('id').isMongoId().withMessage('Invalid user ID'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

const queryValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  // [PHONE SEARCH FIX] - Sanitize search: trim and remove special characters that could break regex
  query('search').optional().trim().customSanitizer(value => {
    if (!value) return value;
    // Remove tabs, newlines, and extra spaces
    return value.replace(/[\t\n\r]+/g, '').trim();
  }),
  query('status').optional().isIn(['active', 'inactive']),
  query('role').optional().isIn(['user', 'admin']),
  query('sortBy').optional().isIn(['name', 'createdAt', 'email']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
];

// All routes require authentication and admin role
router.use(authenticate);
router.use(authorize('super_admin', 'admin'));

// Routes
router.get('/stats', userController.getStats);
router.get('/company', userController.getCompanyUsers);
router.get('/', queryValidation, validate, userController.getAll);
router.get('/:id', userController.getById);
router.post('/', checkSubscriptionLimit('users'), createUserValidation, validate, userController.create);
router.put('/:id', updateUserValidation, validate, userController.update);
router.delete('/:id', userController.delete);
router.post('/:id/reset-password', resetPasswordValidation, validate, userController.resetPassword);

module.exports = router;