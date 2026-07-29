const express = require('express');
const router = express.Router();
const telegramController = require('../../controllers/telegram/telegram.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { checkSubscriptionFeature } = require('../../middleware/subscription');
const { validate } = require('../../middleware/validate');
const {
  sendBulkValidation,
  queryValidation,
  statsValidation,
  simIdValidation,
  setWebhookValidation,
} = require('./telegram.validation');

// =============================================
// PUBLIC ROUTES (No Authentication Required)
// MUST BE BEFORE authenticate middleware
// =============================================

/**
 * Test Webhook Endpoint (for debugging)
 * GET /api/telegram/webhook-test
 */
router.get('/webhook-test', telegramController.testWebhook);

/**
 * Telegram Webhook Endpoint
 * POST /api/telegram/webhook
 * This endpoint receives incoming Telegram updates
 * PUBLIC - No authentication required
 */
router.post('/webhook', telegramController.handleWebhook);

// =============================================
// PROTECTED ROUTES (Authentication Required)
// All routes below require authentication
// =============================================
router.use(authenticate);

/**
 * Get eligible SIMs (with telegramChatId)
 * GET /api/telegram/sims
 */
router.get('/sims', checkSubscriptionFeature('telegramStatus'), telegramController.getEligibleSIMs);

/**
 * Get Telegram messages for company
 * GET /api/telegram/messages
 */
router.get('/messages', checkSubscriptionFeature('telegramStatus'), queryValidation, validate, telegramController.getMessages);

/**
 * Get message statistics
 * GET /api/telegram/stats
 */
router.get('/stats', checkSubscriptionFeature('telegramStatus'), statsValidation, validate, telegramController.getStats);

/**
 * Generate deep link for SIM
 * GET /api/telegram/link/:simId
 */
router.get('/link/:simId', checkSubscriptionFeature('telegramStatus'), simIdValidation, validate, telegramController.generateLink);

/**
 * Unlink Telegram from SIM
 * DELETE /api/telegram/unlink/:simId
 */
router.delete('/unlink/:simId', checkSubscriptionFeature('telegramStatus'), simIdValidation, validate, telegramController.unlinkSIM);

/**
 * Send Telegram link to single user via email
 * POST /api/telegram/send-link-email
 * Requires admin role
 */
router.post(
  '/send-link-email',
  checkSubscriptionFeature('telegramStatus'),
  authorize('super_admin', 'admin'),
  telegramController.sendLinkEmail
);

/**
 * Send Telegram links to all users (bulk email)
 * POST /api/telegram/send-link-email-bulk
 * Requires admin role
 */
router.post(
  '/send-link-email-bulk',
  checkSubscriptionFeature('telegramStatus'),
  authorize('super_admin', 'admin'),
  telegramController.sendLinkEmailBulk
);

/**
 * Send bulk Telegram messages
 * POST /api/telegram/send-bulk
 * Requires admin role
 */
router.post(
  '/send-bulk',
  checkSubscriptionFeature('telegramStatus'),
  authorize('super_admin', 'admin'),
  sendBulkValidation,
  validate,
  telegramController.sendBulk
);

/**
 * Manually process inactive messages (Admin only)
 * POST /api/telegram/process-inactive
 */
router.post(
  '/process-inactive',
  checkSubscriptionFeature('telegramStatus'),
  authorize('super_admin', 'admin'),
  telegramController.processInactive
);

/**
 * Set webhook URL (Super admin only)
 * POST /api/telegram/set-webhook
 */
router.post(
  '/set-webhook',
  authorize('super_admin'),
  setWebhookValidation,
  validate,
  telegramController.setWebhook
);

/**
 * Get webhook info (Admin only)
 * GET /api/telegram/webhook-info
 */
router.get(
  '/webhook-info',
  authorize('super_admin', 'admin'),
  telegramController.getWebhookInfo
);

module.exports = router;