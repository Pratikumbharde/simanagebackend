/**
 * RechargePlan Routes
 *
 * Public (authenticated):
 * - GET  /                      — List plans with filters
 * - GET  /:id                   — Get plan by ID
 * - GET  /operators             — Get distinct operators
 * - GET  /circles/:operator     — Get circles for an operator
 *
 * Admin only:
 * - POST /                      — Create a plan
 * - PUT  /:id                   — Update a plan
 * - DELETE /:id                 — Delete a plan
 * - PATCH /:id/toggle-status    — Toggle active/inactive
 * - POST /seed                  — Bulk seed plans
 */

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const rechargePlanController = require('../../controllers/rechargePlan/rechargePlan.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');

// ============ PUBLIC (AUTHENTICATED) ROUTES ============

router.use(authenticate);

// List plans with optional filters
router.get(
  '/',
  rechargePlanController.getAll
);

// Get distinct operators with active plans
router.get(
  '/operators',
  rechargePlanController.getOperators
);

// Get distinct circles for an operator
router.get(
  '/circles/:operator',
  rechargePlanController.getCircles
);

// Get single plan by ID
router.get(
  '/:id',
  rechargePlanController.getById
);

// ============ ADMIN-ONLY ROUTES ============

// Create a new plan
router.post(
  '/',
  authorize('super_admin', 'admin'),
  [
    body('operator').notEmpty().withMessage('Operator is required').trim(),
    body('amount').isFloat({ min: 1 }).withMessage('Amount must be at least ₹1'),
    body('validity').isInt({ min: 1 }).withMessage('Validity must be at least 1 day'),
    body('plan.name').notEmpty().withMessage('Plan name is required').trim(),
    body('circle').optional().isString().trim(),
    body('planType').optional().isIn(['popular', 'data', 'unlimited', 'talktime', 'combo', 'annual', 'other']),
    body('plan.data').optional().isString().trim(),
    body('plan.calls').optional().isString().trim(),
    body('plan.sms').optional().isString().trim(),
    body('plan.description').optional().isString().trim(),
    body('isActive').optional().isBoolean(),
    body('sortOrder').optional().isInt(),
  ],
  validate,
  rechargePlanController.create
);

// Update a plan
router.put(
  '/:id',
  authorize('super_admin', 'admin'),
  rechargePlanController.update
);

// Delete a plan
router.delete(
  '/:id',
  authorize('super_admin', 'admin'),
  rechargePlanController.delete
);

// Toggle active/inactive status
router.patch(
  '/:id/toggle-status',
  authorize('super_admin', 'admin'),
  rechargePlanController.toggleStatus
);

// Bulk seed plans
router.post(
  '/seed',
  authorize('super_admin'),
  rechargePlanController.seed
);

module.exports = router;