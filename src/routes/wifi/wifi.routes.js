const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const wifiController = require('../../controllers/wifi/wifi.controller');
const { authenticate, authorize, checkCompanyAccess } = require('../../middleware/auth');
const { checkSubscriptionFeature } = require('../../middleware/subscription');
const { validate } = require('../../middleware/validate');

// ==================== VALIDATION RULES ====================

// WiFi Network validations
const createNetworkValidation = [
  body('wifiName').notEmpty().trim().withMessage('WiFi name is required')
    .isLength({ max: 100 }).withMessage('WiFi name cannot exceed 100 characters'),
  body('expectedSpeed').isFloat({ min: 0 }).withMessage('Expected speed must be a positive number'),
  body('alertThreshold').isFloat({ min: 0 }).withMessage('Alert threshold must be a positive number'),
  body('emailAlertEnabled').optional().isBoolean().withMessage('Email alert enabled must be a boolean'),
  body('companyId').optional().isMongoId().withMessage('Invalid company ID'),
  // [SIM-BASED WIFI ACCESS CONTROL] - Validate assignedSims
  body('assignedSims')
    .optional()
    .isArray().withMessage('Assigned SIMs must be an array')
    .custom((value) => {
      if (Array.isArray(value)) {
        for (const id of value) {
          if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            throw new Error(`Invalid SIM ID: ${id}`);
          }
        }
      }
      return true;
    }),
  body('ssid').optional().trim().isLength({ max: 100 }),
  body('bssid').optional().trim().isLength({ max: 20 }),
  body('password').optional({ checkFalsy: true }).trim().isLength({ max: 100 }).withMessage('WiFi password cannot exceed 100 characters'),
];

const updateNetworkValidation = [
  param('id').isMongoId().withMessage('Invalid WiFi network ID'),
  body('wifiName').optional().notEmpty().trim().isLength({ max: 100 }),
  body('expectedSpeed').optional().isFloat({ min: 0 }),
  body('alertThreshold').optional().isFloat({ min: 0 }),
  body('emailAlertEnabled').optional().isBoolean(),
  // [SIM-BASED WIFI ACCESS CONTROL] - Validate assignedSims
  body('assignedSims')
    .optional()
    .isArray().withMessage('Assigned SIMs must be an array')
    .custom((value) => {
      if (Array.isArray(value)) {
        for (const id of value) {
          if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            throw new Error(`Invalid SIM ID: ${id}`);
          }
        }
      }
      return true;
    }),
  body('ssid').optional().trim().isLength({ max: 100 }),
  body('bssid').optional().trim().isLength({ max: 20 }),
  body('location').optional().trim().isLength({ max: 200 }).withMessage('Location cannot exceed 200 characters'),
  body('password').optional({ checkFalsy: true }).trim().isLength({ max: 100 }).withMessage('WiFi password cannot exceed 100 characters'),
];

// Device validations
const registerDeviceValidation = [
  body('deviceId').notEmpty().trim().withMessage('Device ID is required')
    .isLength({ max: 100 }).withMessage('Device ID cannot exceed 100 characters'),
  body('deviceName').notEmpty().trim().withMessage('Device name is required')
    .isLength({ max: 100 }).withMessage('Device name cannot exceed 100 characters'),
  body('companyId').isMongoId().withMessage('Invalid company ID'),
];

const assignDeviceValidation = [
  body('deviceId').notEmpty().trim().withMessage('Device ID is required'),
  body('wifiId').isMongoId().withMessage('Invalid WiFi network ID'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
];

const updateDeviceValidation = [
  param('deviceId').notEmpty().trim().withMessage('Device ID is required'),
  body('deviceName').optional().notEmpty().trim().isLength({ max: 100 }),
];

// Metrics validations
const submitMetricsValidation = [
  body('deviceId').notEmpty().trim().withMessage('Device ID is required'),
  body('wifiId').isMongoId().withMessage('Invalid WiFi network ID'),
  body('downloadSpeed').isFloat({ min: 0 }).withMessage('Download speed must be a positive number'),
  body('uploadSpeed').isFloat({ min: 0 }).withMessage('Upload speed must be a positive number'),
  body('latency').isFloat({ min: 0 }).withMessage('Latency must be a positive number'),
];

// Query validations
const networkQueryValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().trim(),
  query('sortBy').optional().isIn(['createdAt', 'wifiName', 'expectedSpeed']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
];

const deviceQueryValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().trim(),
  query('wifiId').optional().trim(),
  query('isActive').optional().isIn(['true', 'false']),
  query('sortBy').optional().isIn(['createdAt', 'deviceName', 'lastSeen']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
];

const alertQueryValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['active', 'resolved']),
  query('wifiId').optional().isMongoId(),
  query('sortBy').optional().isIn(['createdAt', 'avgSpeed']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
];

// ==================== ROUTES ====================

// All routes require authentication
router.use(authenticate);

// Feature check for WiFi Monitor (skip for super_admin)
router.use((req, res, next) => {
  if (req.user?.role === 'super_admin') return next();
  return checkSubscriptionFeature('wifiMonitor')(req, res, next);
});

// ==================== WIFI NETWORK ROUTES ====================

// Create new WiFi network (admin only)
router.post('/networks', authorize('super_admin', 'admin'), checkCompanyAccess, createNetworkValidation, validate, wifiController.createNetwork);

// Get all WiFi networks
router.get('/networks', networkQueryValidation, validate, wifiController.getNetworks);

// Get WiFi network by ID
router.get('/networks/:id', param('id').isMongoId().withMessage('Invalid WiFi network ID'), validate, wifiController.getNetworkById);

// Update WiFi network
router.put('/networks/:id', authorize('super_admin', 'admin'), updateNetworkValidation, validate, wifiController.updateNetwork);

// Delete WiFi network (soft delete)
router.delete('/networks/:id', authorize('super_admin', 'admin'), param('id').isMongoId().withMessage('Invalid WiFi network ID'), validate, wifiController.deleteNetwork);

// ==================== WIFI DEVICE ROUTES ====================

// Register device (public endpoint for mobile app - no company access check)
router.post('/register-device', registerDeviceValidation, validate, wifiController.registerDevice);

// Get device status (for mobile app - minimal auth check)
router.get('/my-device-status/:deviceId', param('deviceId').notEmpty().trim().withMessage('Device ID is required'), validate, wifiController.getDeviceStatus);

// Assign device to WiFi network (admin only)
router.put('/assign-device', authorize('super_admin', 'admin'), assignDeviceValidation, validate, wifiController.assignDevice);

// Unassign device from WiFi network (admin only)
router.put('/unassign-device/:deviceId', authorize('super_admin', 'admin'), param('deviceId').notEmpty().trim().withMessage('Device ID is required'), validate, wifiController.unassignDevice);

// Get all devices (admin only)
router.get('/devices', authorize('super_admin', 'admin'), deviceQueryValidation, validate, wifiController.getDevices);

// Update device
router.put('/devices/:deviceId', authorize('super_admin', 'admin'), updateDeviceValidation, validate, wifiController.updateDevice);

// Delete device
router.delete('/devices/:deviceId', authorize('super_admin', 'admin'), param('deviceId').notEmpty().trim().withMessage('Device ID is required'), validate, wifiController.deleteDevice);

// ==================== WIFI METRIC ROUTES ====================

// Submit metrics from device (public endpoint for mobile app)
router.post('/metrics', submitMetricsValidation, validate, wifiController.submitMetrics);

// Get metrics for a WiFi network
router.get('/metrics/:wifiId', param('wifiId').isMongoId().withMessage('Invalid WiFi network ID'), validate, wifiController.getMetrics);

// Get metrics for a device
router.get('/device-metrics/:deviceId', param('deviceId').notEmpty().trim().withMessage('Device ID is required'), validate, wifiController.getDeviceMetrics);

// ==================== WIFI ALERT ROUTES ====================

// Get alerts
router.get('/alerts', authorize('super_admin', 'admin'), alertQueryValidation, validate, wifiController.getAlerts);

// Resolve alert
router.put('/alerts/:id/resolve', authorize('super_admin', 'admin'), param('id').isMongoId().withMessage('Invalid alert ID'), validate, wifiController.resolveAlert);

// ==================== DASHBOARD ROUTES ====================

// Get WiFi dashboard stats
router.get('/dashboard/stats', authorize('super_admin', 'admin'), wifiController.getDashboardStats);

// Get hourly metrics for charts
router.get('/hourly-metrics/:wifiId', authorize('super_admin', 'admin'), param('wifiId').isMongoId().withMessage('Invalid WiFi network ID'), validate, wifiController.getHourlyMetrics);

// ==================== MANUAL ALERT CHECK (Testing) ====================

// Manually trigger WiFi alert check (admin only - for testing)
router.post('/check-alerts', authorize('super_admin', 'admin'), wifiController.checkAlerts);

// Manually trigger alert email for specific WiFi (admin only - for testing)
router.post('/test-alert/:wifiId', authorize('super_admin', 'admin'), param('wifiId').isMongoId().withMessage('Invalid WiFi network ID'), validate, wifiController.testAlertEmail);

// ==================== [SIM-BASED WIFI ACCESS CONTROL] ROUTES ====================

// Get eligible SIMs for WiFi assignment (admin only)
router.get('/eligible-sims', authorize('super_admin', 'admin'), query('companyId').optional().isMongoId(), validate, wifiController.getEligibleSims);

// Get SIMs assigned to a WiFi network
router.get('/networks/:id/assigned-sims', authorize('super_admin', 'admin'), param('id').isMongoId().withMessage('Invalid WiFi network ID'), validate, wifiController.getWifiAssignedSims);

module.exports = router;