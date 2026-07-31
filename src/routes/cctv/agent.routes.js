const express = require('express');
const router = express.Router();
const agentAuth = require('../../middleware/agentAuth');
const agentController = require('../../controllers/cctv/agent.controller');
const { authenticate, authorize, checkCompanyAccess } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const {
  generateActivationCodeValidation,
  activateAgentValidation,
  heartbeatValidation,
  cameraStatusUpdateValidation,
} = require('../../validations/cctv/cctv.validation');

// Simple in-memory rate limiter for activation endpoint
const activationAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 50; // 5 attempts per IP per window

const activationRateLimiter = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const record = activationAttempts.get(ip);

  if (!record || now - record.firstAttempt > RATE_LIMIT_WINDOW) {
    activationAttempts.set(ip, { firstAttempt: now, count: 1 });
    return next();
  }

  record.count += 1;
  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      success: false,
      message: 'Too many activation attempts. Please try again later.',
    });
  }

  next();
};

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of activationAttempts) {
    if (now - record.firstAttempt > RATE_LIMIT_WINDOW) {
      activationAttempts.delete(ip);
    }
  }
}, 60 * 1000); // Every minute

// ==================== Public Routes ====================

// Agent activation (public - uses activation code, rate limited)
router.post(
  '/activate',
  activationRateLimiter,
  activateAgentValidation,
  validate,
  agentController.activateAgent
);

// ==================== Agent Auth Routes ====================

// Agent heartbeat
router.post(
  '/heartbeat',
  agentAuth,
  heartbeatValidation,
  validate,
  agentController.heartbeat
);

// Get agent config (cameras to monitor)
router.get(
  '/config',
  agentAuth,
  agentController.getConfig
);

// Update camera statuses from agent
router.post(
  '/camera-status',
  agentAuth,
  cameraStatusUpdateValidation,
  validate,
  agentController.updateCameraStatus
);

// ==================== Admin Routes ====================

// All admin routes require authentication
router.use(authenticate);

// Generate activation code (admin only)
router.post(
  '/activation-code',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  generateActivationCodeValidation,
  validate,
  agentController.generateActivationCode
);

// List agents (admin only)
router.get(
  '/',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  agentController.getAll
);

// Get agent by ID
router.get(
  '/:id',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  agentController.getById
);

// Get agent status
router.get(
  '/:id/status',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  agentController.getStatus
);

// Revoke agent (admin only)
router.post(
  '/:id/revoke',
  authorize('admin', 'super_admin'),
  checkCompanyAccess,
  agentController.revoke
);

module.exports = router;