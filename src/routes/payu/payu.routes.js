/**
 * PayU Payment Gateway & BBPS Recharge Plan Routes
 *
 * Public routes:
 * - POST /payu/success   — PayU success redirect
 * - POST /payu/failure   — PayU failure redirect
 * - POST /payu/webhook   — PayU server-to-server notification
 *
 * Authenticated routes:
 * - POST /payu/initiate-payment — Create pending recharge + get PayU form data
 * - GET  /payu/status/:txnid   — Check payment status
 *
 * BBPS Plan Routes (authenticated):
 * - GET  /payu/plans/operator-circle  — Detect operator & circle from mobile number
 * - GET  /payu/plans/operators         — List all operators
 * - GET  /payu/plans/circles            — List all circles
 * - GET  /payu/plans                    — Fetch plans by operatorId + circleId
 * - GET  /payu/plans/by-number/:mobile — Auto-detect & fetch plans for a number
 * - GET  /payu/plans/by-sim/:simId     — Fetch plans for an existing SIM
 * - GET  /payu/plans/custom             — Fetch personalized plans for a number
 */

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const payuController = require('../../controllers/payu/payu.controller');
const bbpsController = require('../../controllers/payu/bbps.controller');
const { authenticate } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');

// ============ VALIDATION RULES ============

const initiatePaymentValidation = [
  body('simId').isMongoId().withMessage('Valid SIM ID is required'),
  body('amount').isFloat({ min: 1 }).withMessage('Valid amount is required (minimum ₹1)'),
  body('validity').optional().isInt({ min: 1 }).withMessage('Validity must be at least 1 day'),
  body('plan.name').optional().isString().trim().isLength({ max: 100 }),
  body('plan.validity').optional().isInt({ min: 1 }),
  body('plan.data').optional().isString().trim(),
  body('plan.calls').optional().isString().trim(),
  body('plan.sms').optional().isString().trim(),
  body('notes').optional().isString().trim().isLength({ max: 500 }),
];

const txnIdValidation = [
  param('txnid').notEmpty().withMessage('Transaction ID is required'),
];

const mobileValidation = [
  param('mobile').notEmpty().withMessage('Mobile number is required'),
];

const simIdValidation = [
  param('simId').isMongoId().withMessage('Valid SIM ID is required'),
];

// ============ PUBLIC ROUTES (No Auth Required) ============

// PayU success redirect (browser POST from PayU)
router.post('/success', payuController.successCallback);

// PayU failure redirect (browser POST from PayU)
router.post('/failure', payuController.failureCallback);

// PayU server-to-server webhook
router.post('/webhook', payuController.webhook);

// ============ AUTHENTICATED ROUTES ============

router.use(authenticate);

// Create recharge payment (initiates PayU checkout)
router.post(
  '/initiate-payment',
  initiatePaymentValidation,
  validate,
  payuController.initiatePayment
);

// Check payment status
router.get(
  '/status/:txnid',
  txnIdValidation,
  validate,
  payuController.getPaymentStatus
);

// ============ BBPS PLAN ROUTES (Authenticated) ============

// Detect operator & circle from mobile number
router.get(
  '/plans/operator-circle',
  bbpsController.getOperatorAndCircle
);

// List all available operators
router.get(
  '/plans/operators',
  bbpsController.getOperators
);

// List all available circles
router.get(
  '/plans/circles',
  bbpsController.getCircles
);

// Fetch plans by operatorId + circleId (query params)
router.get(
  '/plans',
  bbpsController.getPlans
);

// Fetch custom/personalized plans for a mobile number
router.get(
  '/plans/custom',
  bbpsController.getCustomPlans
);

// Auto-detect operator & fetch plans for a mobile number
router.get(
  '/plans/by-number/:mobile',
  mobileValidation,
  validate,
  bbpsController.getPlansByNumber
);

// Fetch plans for an existing SIM (uses stored operator/circle)
router.get(
  '/plans/by-sim/:simId',
  simIdValidation,
  validate,
  bbpsController.getPlansBySim
);

module.exports = router;