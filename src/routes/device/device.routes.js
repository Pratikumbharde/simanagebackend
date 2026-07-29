const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const deviceController = require('../../controllers/device/device.controller');
const callAutomationController = require('../../controllers/callAutomation/callAutomation.controller'); // [CALL AUTOMATION]
const { validate } = require('../../middleware/validate');

// ==================== VALIDATION RULES ====================

// Auto-auth validation
const autoAuthValidation = [
  body('simNumber')
    .notEmpty().withMessage('SIM number is required')
    .trim()
    .isLength({ min: 10, max: 15 }).withMessage('SIM number must be Must be 10-15 digits'),
  body('deviceId')
    .notEmpty().withMessage('Device ID is required')
    .trim()
    .isLength({ max: 100 }).withMessage('Device ID cannot exceed 100 characters'),
];

// Metrics validation (for device-submitted metrics)
const deviceMetricsValidation = [
  body('simNumber')
    .notEmpty().withMessage('SIM number is required')
    .trim(),
  body('deviceId')
    .notEmpty().withMessage('Device ID is required')
    .trim(),
  body('deviceToken')
    .notEmpty().withMessage('Device token is required')
    .trim(),
  body('ssid')
    .notEmpty().withMessage('WiFi SSID is required')
    .trim(),
  body('bssid')
    .notEmpty().withMessage('WiFi BSSID is required')
    .trim(),
  body('downloadSpeed')
    .isFloat({ min: 0 }).withMessage('Download speed must be a positive number'),
  body('uploadSpeed')
    .isFloat({ min: 0 }).withMessage('Upload speed must be a positive number'),
  body('latency')
    .optional()
    .isFloat({ min: 0 }).withMessage('Latency must be a positive number'),
];

// Validate device validation
const validateDeviceValidation = [
  query('simNumber')
    .notEmpty().withMessage('SIM number is required')
    .trim(),
  query('deviceId')
    .notEmpty().withMessage('Device ID is required')
    .trim(),
  query('deviceToken')
    .notEmpty().withMessage('Device token is required')
    .trim(),
];

// Refresh token validation
const refreshTokenValidation = [
  body('simNumber')
    .notEmpty().withMessage('SIM number is required')
    .trim(),
  body('deviceId')
    .notEmpty().withMessage('Device ID is required')
    .trim(),
  body('deviceToken')
    .notEmpty().withMessage('Device token is required')
    .trim(),
];

// ==================== ROUTES ====================

// All device routes are PUBLIC (no JWT authentication required)
// Authentication is done via SIM number + device token

/**
 * Auto-authenticate device using SIM number
 * POST /api/device/auto-auth
 *
 * Request body:
 * {
 *   "simNumber": "9876543210",
 *   "deviceId": "android-123"
 * }
 *
 * Response:
 * {
 *   "allowed": true,
 *   "deviceToken": "abc123...",
 *   "wifiConfig": [...]
 * }
 */
router.post('/auto-auth', autoAuthValidation, validate, deviceController.autoAuth);

/**
 * Submit WiFi metrics from device
 * POST /api/wifi/metrics
 *
 * Request body:
 * {
 *   "simNumber": "9876543210",
 *   "deviceId": "android-123",
 *   "deviceToken": "abc123",
 *   "ssid": "Office_WiFi",
 *   "bssid": "AA:BB:CC:DD:EE:FF",
 *   "downloadSpeed": 40,
 *   "uploadSpeed": 20,
 *   "latency": 10
 * }
 */
router.post('/metrics', deviceMetricsValidation, validate, deviceController.submitMetrics);

/**
 * Validate device token
 * GET /api/device/validate
 */
router.get('/validate', validateDeviceValidation, validate, deviceController.validateDevice);

/**
 * Refresh device token
 * POST /api/device/refresh-token
 */
router.post('/refresh-token', refreshTokenValidation, validate, deviceController.refreshToken);

// ==================== CALL AUTOMATION ROUTES ====================

/**
 * Get call automation config for device
 * GET /api/device/call-config
 *
 * Query params:
 * - simNumber: The SIM number to check role for
 *
 * Response:
 * {
 *   "role": "CALLER" | "RECEIVER" | "NONE",
 *   "targets": ["+91XXXXXXXXX1", "+91XXXXXXXXX2"],
 *   "callDuration": 10,
 *   "frequency": "daily",
 *   "isActive": true
 * }
 */
router.get('/call-config', callAutomationController.getDeviceConfig);

/**
 * Update last call run timestamp
 * POST /api/device/call-complete
 */
router.post('/call-complete', callAutomationController.updateLastRun);

module.exports = router;