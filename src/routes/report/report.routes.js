const express = require('express');
const router = express.Router();
const { query } = require('express-validator');
const reportController = require('../../controllers/report/report.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { checkSubscriptionLimit, checkSubscriptionFeature } = require('../../middleware/subscription');
const { validate } = require('../../middleware/validate');

// Validation rules
const reportValidation = [
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  query('format').optional().isIn(['json', 'excel', 'csv']).withMessage('Invalid format'),
  query('download').optional().isBoolean().withMessage('Download must be boolean'),
  query('uniqueOnly').optional().isIn(['true', 'false']).withMessage('uniqueOnly must be true or false'),
];

/**
 * Conditional middleware: Check excelExport feature only if downloading
 * Allows JSON format without excelExport check
 */
const checkExportIfNeeded = (req, res, next) => {
  const format = req.query.format;
  const download = req.query.download;

  // If requesting excel/csv or download=true, check excelExport feature
  if ((format === 'excel' || format === 'csv' || download === 'true' || download === true)) {
    return checkSubscriptionFeature('excelExport')(req, res, next);
  }

  // For JSON format, just proceed
  next();
};

// All routes require authentication
router.use(authenticate);

// SIM Report
router.get('/sims', checkSubscriptionLimit('reports'), checkExportIfNeeded, reportValidation, validate, reportController.generateSimReport);

// Recharge Report
router.get('/recharges', checkSubscriptionLimit('reports'), checkExportIfNeeded, reportValidation, validate, reportController.generateRechargeReport);

// Call Log Report
router.get('/calllogs', checkSubscriptionLimit('reports'), checkExportIfNeeded, reportValidation, validate, reportController.generateCallLogReport);

// Company Report (Super Admin only)
router.get('/companies', authorize('super_admin'), checkExportIfNeeded, reportValidation, validate, reportController.generateCompanyReport);

module.exports = router;