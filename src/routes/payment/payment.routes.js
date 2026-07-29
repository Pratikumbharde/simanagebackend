const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const paymentController = require('../../controllers/payment/payment.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');

// Validation rules
const createOrderValidation = [
  body('subscriptionId').isMongoId().withMessage('Valid subscription ID is required'),
  body('billingCycle').isIn(['monthly', 'yearly']).withMessage('Billing cycle must be monthly or yearly'),
];

const verifyPaymentValidation = [
  body('razorpay_order_id').notEmpty().withMessage('Order ID is required'),
  body('razorpay_payment_id').notEmpty().withMessage('Payment ID is required'),
  body('razorpay_signature').notEmpty().withMessage('Signature is required'),
];

// Registration order validation
const createOrderForRegistrationValidation = [
  body('subscriptionId').isMongoId().withMessage('Valid subscription ID is required'),
  body('billingCycle').isIn(['monthly', 'yearly']).withMessage('Billing cycle must be monthly or yearly'),
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 50 }),
  body('email').isEmail().withMessage('Valid email is required').trim(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('companyName').trim().notEmpty().withMessage('Company name is required').isLength({ max: 100 }),
  body('phone').optional({ checkFalsy: true }).matches(/^\+?\d{10,15}$/).withMessage('Invalid phone number'),
];

// ============ PUBLIC ROUTES (No Auth Required) ============

// Create order for new registration
router.post(
  '/public/create-order',
  createOrderForRegistrationValidation,
  validate,
  paymentController.createOrderForRegistration
);

// Free trial registration (no payment required)
router.post(
  '/public/free-trial-register',
  [
    body('subscriptionId').isMongoId().withMessage('Valid subscription ID is required'),
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 50 }),
    body('email').isEmail().withMessage('Valid email is required').trim(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('companyName').trim().notEmpty().withMessage('Company name is required').isLength({ max: 100 }),
    body('phone').optional({ checkFalsy: true }).matches(/^\+?\d{10,15}$/).withMessage('Invalid phone number'),
  ],
  validate,
  paymentController.freeTrialRegister
);

// Verify payment and complete registration
router.post(
  '/public/verify-and-register',
  verifyPaymentValidation,
  validate,
  paymentController.verifyPaymentAndRegister
);

// Webhook endpoint (called by Razorpay)
router.post('/webhook', paymentController.handleWebhook);

// ============ PROTECTED ROUTES (Auth Required) ============

// All routes below require authentication
router.use(authenticate);

// Create order (admin/super_admin)
router.post(
  '/create-order',
  createOrderValidation,
  validate,
  paymentController.createOrder
);

// Verify payment
router.post(
  '/verify',
  verifyPaymentValidation,
  validate,
  paymentController.verifyPayment
);

// Get payment history
router.get('/history', paymentController.getHistory);

// Get all payment history (Super Admin only)
router.get(
  '/history/all',
  authenticate,
  authorize('super_admin'),
  paymentController.getAllHistory
);

// Get single payment
router.get('/:id', paymentController.getPayment);

// Revenue stats (Super Admin only)
router.get(
  '/stats/revenue',
  authorize('super_admin'),
  paymentController.getStats
);

module.exports = router;