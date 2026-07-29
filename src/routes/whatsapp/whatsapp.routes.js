const express = require('express');
const router = express.Router();
const whatsAppController = require('../../controllers/whatsapp/whatsapp.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { checkSubscriptionFeature } = require('../../middleware/subscription');
const { validate } = require('../../middleware/validate');
const {
  sendBulkValidation,
  queryValidation,
  statsValidation,
} = require('./whatsapp.validation');

// =============================================
// PUBLIC ROUTES (No Authentication Required)
// MUST BE BEFORE authenticate middleware
// =============================================

/**
 * Test Webhook Endpoint (for debugging)
 * GET /api/whatsapp/webhook-test
 */
router.get('/webhook-test', (req, res) => {
  res.json({
    success: true,
    message: 'WhatsApp webhook endpoint is accessible',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Twilio Webhook Endpoint
 * POST /api/whatsapp/webhook
 * This endpoint receives incoming WhatsApp messages from Twilio
 * PUBLIC - No authentication required
 */
router.post('/webhook', whatsAppController.handleWebhook);

// =============================================
// PROTECTED ROUTES (Authentication Required)
// All routes below require authentication
// =============================================
router.use(authenticate);

/**
 * Get eligible recipients (SIMs and Users)
 * GET /api/whatsapp/recipients
 */
router.get('/recipients', checkSubscriptionFeature('whatsappStatus'), whatsAppController.getRecipients);

/**
 * Get WhatsApp messages for company
 * GET /api/whatsapp/messages
 */
router.get('/messages', checkSubscriptionFeature('whatsappStatus'), queryValidation, validate, whatsAppController.getMessages);

/**
 * Get message statistics
 * GET /api/whatsapp/stats
 */
router.get('/stats', checkSubscriptionFeature('whatsappStatus'), statsValidation, validate, whatsAppController.getStats);

/**
 * Send bulk WhatsApp messages
 * POST /api/whatsapp/send-bulk
 * Requires admin role
 */
router.post(
  '/send-bulk',
  checkSubscriptionFeature('whatsappStatus'),
  authorize('super_admin', 'admin'),
  sendBulkValidation,
  validate,
  whatsAppController.sendBulk
);

/**
 * Manually process inactive messages (Admin only)
 * POST /api/whatsapp/process-inactive
 */
router.post(
  '/process-inactive',
  checkSubscriptionFeature('whatsappStatus'),
  authorize('super_admin', 'admin'),
  whatsAppController.processInactive
);

module.exports = router;