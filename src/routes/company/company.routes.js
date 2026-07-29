const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const companyController = require('../../controllers/company/company.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');

// Validation rules
const createCompanyValidation = [
  body('name').trim().notEmpty().withMessage('Company name is required').isLength({ max: 100 }),
  body('email').isEmail().withMessage('Valid email is required').trim(),
  // Phone is optional — allow empty string, null, or undefined; validate format only when provided
  body('phone').optional({ checkFalsy: true }).matches(/^\+?\d{10,15}$/).withMessage('Invalid phone number (Must be 10-15 digits)'),
  body('subscriptionId').isMongoId().withMessage('Valid subscription ID is required'),
  body('billingCycle').optional().isIn(['monthly', 'yearly']).withMessage('Billing cycle must be monthly or yearly'),
  body('address.street').optional().isString(),
  body('address.city').optional().isString(),
  body('address.state').optional().isString(),
  body('address.country').optional().isString(),
  body('address.zipCode').optional().isString(),
];

const updateCompanyValidation = [
  param('id').isMongoId().withMessage('Invalid company ID'),
  body('name').optional().trim().isLength({ max: 100 }),
  // Phone is optional — allow empty string; validate format only when provided
  body('phone').optional({ checkFalsy: true }).matches(/^\+?\d{10,15}$/).withMessage('Invalid phone number (Must be 10-15 digits)'),
  body('logo').optional().isString(),
  body('settings.currency').optional().isString(),
  body('settings.timezone').optional().isString(),
  body('settings.dateFormat').optional().isString(),
  body('settings.notificationsEnabled').optional().isBoolean(),
  body('settings.rechargeReminderDays').optional().isInt({ min: 1, max: 30 }),
  body('settings.inactiveSimDays').optional().isInt({ min: 1, max: 90 }),
];

// Validation for admin updating their own company
const updateMyCompanyValidation = [
  body('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Company name must be between 1 and 100 characters'),
  body('email').optional().isEmail().withMessage('Valid email is required').trim(),
  body('phone').optional({ checkFalsy: true }).matches(/^\+?\d{10,15}$/).withMessage('Invalid phone number (Must be 10-15 digits)'),
  body('website').optional().isURL().withMessage('Valid website URL is required'),
  body('address.street').optional().trim().isLength({ max: 200 }).withMessage('Street address cannot exceed 200 characters')
    .matches(/^[a-zA-Z0-9\s,.\-/'()#&]*$/).withMessage('Street can only contain letters, numbers, spaces, comma, period, hyphen, slash, apostrophe, parentheses, hash, and ampersand'),
  body('address.city').optional().trim().isLength({ max: 50 }).withMessage('City cannot exceed 50 characters')
    .matches(/^[\p{L}\s\-'.]*$/u).withMessage('City can only contain letters, spaces, hyphens, apostrophes, and periods'),
  body('address.state').optional().trim().isLength({ max: 50 }).withMessage('State cannot exceed 50 characters')
    .matches(/^[\p{L}\s\-'.]*$/u).withMessage('State can only contain letters, spaces, hyphens, apostrophes, and periods'),
  body('address.country').optional().trim().isLength({ max: 50 }).withMessage('Country cannot exceed 50 characters')
    .matches(/^[\p{L}\s\-'.]*$/u).withMessage('Country can only contain letters, spaces, hyphens, apostrophes, and periods'),
  body('address.zipCode').optional().isString(),
];

const renewSubscriptionValidation = [
  param('id').isMongoId().withMessage('Invalid company ID'),
  body('subscriptionId').isMongoId().withMessage('Valid subscription ID is required'),
  body('billingCycle').optional().isIn(['monthly', 'yearly']).withMessage('Billing cycle must be monthly or yearly'),
];

const extendTrialValidation = [
  param('id').isMongoId().withMessage('Invalid company ID'),
  body('days').isInt({ min: 1, max: 30 }).withMessage('Days must be between 1 and 30'),
];

// Admin validation
const createAdminValidation = [
  param('companyId').isMongoId().withMessage('Invalid company ID'),
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 50 }),
  body('email').isEmail().withMessage('Valid email is required').trim(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  // Phone is optional — allow empty string; validate format only when provided
  body('phone').optional({ checkFalsy: true }).matches(/^\+?\d{10,15}$/).withMessage('Invalid phone number (Must be 10-15 digits)'),
];

const updateAdminValidation = [
  param('adminId').isMongoId().withMessage('Invalid admin ID'),
  body('name').optional().trim().isLength({ max: 50 }),
  // Phone is optional — allow empty string; validate format only when provided
  body('phone').optional({ checkFalsy: true }).matches(/^\+?\d{10,15}$/).withMessage('Invalid phone number (Must be 10-15 digits)'),
  body('isActive').optional().isBoolean(),
];

const resetPasswordValidation = [
  param('adminId').isMongoId().withMessage('Invalid admin ID'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

const queryValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
  query('search').optional().trim(),
  query('status').optional().isIn(['active', 'inactive', 'expired']),
  query('sortBy').optional().isIn(['name', 'createdAt', 'subscriptionEndDate']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
];

const historyQueryValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit'),
];

// All routes require authentication and super admin role
router.use(authenticate);

// Public endpoint: Check if company name is available (accessible by any authenticated user)
router.get('/check-name', companyController.checkCompanyName);
router.get('/check-admin-email', companyController.checkAdminEmail);

// Admin-only route to get their company's subscription
router.get('/my-subscription', authorize('admin'), companyController.getMySubscription);

// [NEW] Get company details for logged-in user - accessible by admin and super_admin
router.get('/my', companyController.getMyCompany);

// [NEW] Update own company profile - accessible by admin
router.put('/my', authorize('admin'), updateMyCompanyValidation, validate, companyController.updateMyCompany);

// [NEW] Company Email Change Routes - accessible by admin
router.post('/my/email-change/request', authorize('admin'), companyController.requestCompanyEmailChange);
router.post('/my/email-change/verify-old', authorize('admin'), companyController.verifyCompanyEmailOld);
router.post('/my/email-change/verify-new', authorize('admin'), companyController.verifyCompanyEmailNew);
router.post('/my/email-change/cancel', authorize('admin'), companyController.cancelCompanyEmailChange);
router.post('/my/email-change/resend', authorize('admin'), companyController.resendCompanyEmailChangeOTP);

// [NEW] Get company details by ID - super_admin can access any, admin only their own
router.get('/details/:companyId', authorize('admin', 'super_admin'), companyController.getCompanyDetailsById);

router.use(authorize('super_admin'));

// Routes
router.post('/', createCompanyValidation, validate, companyController.create);
router.get('/', queryValidation, validate, companyController.getAll);
router.get('/list', companyController.getList);
router.get('/expiring', companyController.getExpiring);
router.get('/overview', companyController.getDashboardOverview);
router.get('/:id', companyController.getById);
router.put('/:id', updateCompanyValidation, validate, companyController.update);
router.delete('/:id', companyController.delete);
router.post('/:id/renew-subscription', renewSubscriptionValidation, validate, companyController.renewSubscription);
router.post('/:id/extend-trial', extendTrialValidation, validate, companyController.extendTrial);
router.get('/:id/subscription-history', historyQueryValidation, validate, companyController.getSubscriptionHistory);
router.get('/:id/stats', companyController.getStats);

// Admin Management Routes
router.post('/:companyId/admins', createAdminValidation, validate, companyController.createAdmin);
router.get('/:companyId/admins', companyController.getCompanyAdmins);
router.get('/admins/:adminId', companyController.getAdminById);
router.put('/admins/:adminId', updateAdminValidation, validate, companyController.updateAdmin);
router.delete('/admins/:adminId', companyController.deleteAdmin);
router.post('/admins/:adminId/reset-password', resetPasswordValidation, validate, companyController.resetAdminPassword);

module.exports = router;