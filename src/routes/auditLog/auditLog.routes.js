const express = require('express');
const router = express.Router();
const auditLogController = require('../../controllers/auditLog/auditLog.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { body, query, param } = require('express-validator');
const { validate } = require('../../middleware/validate');

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/audit-logs
 * @desc    Get all audit logs with filters and pagination
 * @access  Private (All authenticated users)
 * @query   page, limit, module, action, startDate, endDate, userId, entityType, search
 */
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('module').optional().isIn(['AUTH', 'SIM', 'RECHARGE', 'USER', 'REPORT', 'COMPANY', 'SUBSCRIPTION', 'PAYMENT', 'CALL_LOG', 'NOTIFICATION', 'DASHBOARD', 'SETTINGS', 'WHATSAPP', 'TELEGRAM', 'WIFI', 'CALL_AUTOMATION', 'SMS', 'DEVICE', 'LANDING_CONTENT']),
    query('action').optional().isString().trim(),
    query('startDate').optional().isISO8601().withMessage('Invalid start date'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date'),
    query('userId').optional().isMongoId().withMessage('Invalid user ID'),
    query('entityType').optional().isIn(['SIM', 'USER', 'RECHARGE', 'COMPANY', 'SUBSCRIPTION', 'PAYMENT', 'REPORT', 'CALL_LOG', 'NOTIFICATION', 'TELEGRAM_MESSAGE', 'WHATSAPP_MESSAGE']),
    query('search').optional().isString().trim(),
  ],
  validate,
  auditLogController.getAll
);

/**
 * @route   GET /api/audit-logs/stats
 * @desc    Get audit log statistics
 * @access  Private (Admin and Super Admin only)
 */
router.get(
  '/stats',
  authorize('admin', 'super_admin'),
  auditLogController.getStats
);

/**
 * @route   GET /api/audit-logs/modules
 * @desc    Get all available modules
 * @access  Private
 */
router.get('/modules', auditLogController.getModules);

/**
 * @route   GET /api/audit-logs/actions/:module
 * @desc    Get available actions for a module
 * @access  Private
 */
router.get('/actions/:module', auditLogController.getActions);

/**
 * @route   GET /api/audit-logs/export
 * @desc    Export audit logs to Excel
 * @access  Private (Admin and Super Admin only)
 */
router.get(
  '/export',
  authorize('admin', 'super_admin'),
  auditLogController.export
);

/**
 * @route   GET /api/audit-logs/:id
 * @desc    Get single audit log by ID
 * @access  Private
 */
router.get(
  '/:id',
  [
    param('id').isMongoId().withMessage('Invalid log ID'),
  ],
  validate,
  auditLogController.getById
);

module.exports = router;