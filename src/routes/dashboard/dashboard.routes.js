const express = require('express');
const router = express.Router();
const { query } = require('express-validator');
const dashboardController = require('../../controllers/dashboard/dashboard.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');

// Validation rules
const queryValidation = [
  query('companyId').optional().isMongoId(),
  query('period').optional().isIn(['week', 'month', 'year']),
  query('month').optional().isInt({ min: 1, max: 12 }),
  query('year').optional().isInt({ min: 2020, max: 2030 }),
];

// All routes require authentication
router.use(authenticate);

// Routes
router.get('/overview', queryValidation, validate, dashboardController.getOverview);
router.get('/sims', queryValidation, validate, dashboardController.getSimStats);
router.get('/recharges', queryValidation, validate, dashboardController.getRechargeStats);
router.get('/calls', queryValidation, validate, dashboardController.getCallStats);
router.get('/monthly-report', queryValidation, validate, dashboardController.getMonthlyReport);

// Super admin only
router.get('/admin/overview', authorize('super_admin'), dashboardController.getSuperAdminOverview);

module.exports = router;