const whatsAppService = require('../../services/whatsapp/whatsapp.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, paginatedResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

class WhatsAppController {
  /**
   * Send bulk WhatsApp messages
   * POST /api/whatsapp/send-bulk
   */
  async sendBulk(req, res, next) {
    try {
      const { simIds = [], userIds = [], message } = req.body;

      // Validate that at least one recipient is provided
      if (simIds.length === 0 && userIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one SIM or User must be selected',
        });
      }

      // Validate message
      if (!message || message.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Message is required',
        });
      }

      // Send bulk messages
      const result = await whatsAppService.sendBulkMessages(
        { simIds, userIds, message },
        req.user
      );

      // Determine if single or bulk send
      const isSingleSend = simIds.length === 1 && userIds.length === 0;
      const auditAction = isSingleSend ? 'WHATSAPP_MESSAGE_SEND' : 'WHATSAPP_MESSAGE_SEND_BULK';

      // Audit log
      await auditLogService.logAction({
        action: auditAction,
        module: 'WHATSAPP',
        description: isSingleSend
          ? `Sent WhatsApp message to SIM ${result.messages[0]?.phoneNumber || 'unknown'}`
          : `Sent bulk WhatsApp messages: ${result.sent} sent, ${result.failed} failed`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: req.user.companyId,
        entityId: isSingleSend ? simIds[0] : null,
        entityType: isSingleSend ? 'SIM' : null,
        metadata: {
          total: result.total,
          sent: result.sent,
          failed: result.failed,
          messageLength: message.length,
          simIds: isSingleSend ? undefined : simIds.slice(0, 50),
        },
        req,
      });

      return successResponse(res, result, `Messages sent: ${result.sent}, Failed: ${result.failed}`);
    } catch (error) {
      logger.error('[WhatsApp Controller] Send bulk error', {
        error: error.message,
        userId: req.user?._id,
      });
      next(error);
    }
  }

  /**
   * Handle Twilio webhook for incoming messages
   * POST /api/whatsapp/webhook
   * This is a public endpoint (no auth required)
   */
  async handleWebhook(req, res, next) {
    try {
      // Log ALL incoming data for debugging
      logger.info('[WhatsApp Webhook] ===== INCOMING WEBHOOK =====');
      logger.info('[WhatsApp Webhook] Request body:', JSON.stringify(req.body, null, 2));
      logger.info('[WhatsApp Webhook] From:', req.body.From);
      logger.info('[WhatsApp Webhook] To:', req.body.To);
      logger.info('[WhatsApp Webhook] Body:', req.body.Body);
      logger.info('[WhatsApp Webhook] MessageSid:', req.body.MessageSid);

      // Process webhook
      const result = await whatsAppService.handleWebhook(req.body);

      // Audit log for webhook reply
      if (result.success && result.messageId) {
        await auditLogService.logAction({
          action: 'WHATSAPP_WEBHOOK_REPLY',
          module: 'WHATSAPP',
          description: `Received WhatsApp reply from ${req.body.From}${result.isActive ? ' (SIM marked active)' : ''}`,
          performedBy: null,
          role: 'system',
          companyId: result.companyId || null,
          entityId: result.simId || null,
          entityType: result.simId ? 'WHATSAPP_MESSAGE' : null,
          metadata: {
            from: req.body.From,
            isActive: result.isActive,
            messageId: result.messageId,
          },
          req,
        });
      }

      logger.info('[WhatsApp Webhook] Result:', JSON.stringify(result, null, 2));

      // Always return 200 to Twilio
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[WhatsApp Webhook] Error:', error.message);
      logger.error('[WhatsApp Webhook] Stack:', error.stack);
      // Return 200 to prevent Twilio retries
      return res.status(200).json({
        success: false,
        message: 'Error processing webhook',
        error: error.message,
      });
    }
  }

  /**
   * Get messages for company
   * GET /api/whatsapp/messages
   */
  async getMessages(req, res, next) {
    try {
      const result = await whatsAppService.getMessages(req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      logger.error('[WhatsApp Controller] Get messages error', {
        error: error.message,
      });
      next(error);
    }
  }

  /**
   * Get message statistics
   * GET /api/whatsapp/stats
   */
  async getStats(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const stats = await whatsAppService.getStats(req.user, startDate, endDate);
      return successResponse(res, stats);
    } catch (error) {
      logger.error('[WhatsApp Controller] Get stats error', {
        error: error.message,
      });
      next(error);
    }
  }

  /**
   * Manual trigger for processing inactive messages (Admin only)
   * POST /api/whatsapp/process-inactive
   */
  async processInactive(req, res, next) {
    try {
      const result = await whatsAppService.processInactiveMessages();

      // Audit log
      await auditLogService.logAction({
        action: 'WHATSAPP_SIM_INACTIVE',
        module: 'WHATSAPP',
        description: `Processed inactive WhatsApp messages: ${result.processed} messages, ${result.simsUpdated} SIMs marked inactive`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: req.user.companyId,
        metadata: {
          processed: result.processed,
          simsUpdated: result.simsUpdated,
        },
        req,
      });

      return successResponse(res, result, 'Inactive messages processed');
    } catch (error) {
      logger.error('[WhatsApp Controller] Process inactive error', {
        error: error.message,
      });
      next(error);
    }
  }

  /**
   * Get eligible recipients (SIMs and Users) for sending messages
   * GET /api/whatsapp/recipients
   */
  async getRecipients(req, res, next) {
    try {
      const Sim = require('../../models/sim/sim.model');
      const User = require('../../models/auth/user.model');

      // Get SIMs with phone numbers
      const sims = await Sim.find({
        companyId: req.user.companyId,
        isActive: true,
        status: 'active',
      })
        .select('mobileNumber operator status assignedTo')
        .populate('assignedTo', 'name email');

      // Get Users with phone numbers
      const users = await User.find({
        companyId: req.user.companyId,
        isActive: true,
        phone: { $exists: true, $ne: '' },
      }).select('name email phone');

      return successResponse(res, {
        sims: sims.map((s) => ({
          _id: s._id,
          mobileNumber: s.mobileNumber,
          operator: s.operator,
          assignedTo: s.assignedTo,
          type: 'sim',
        })),
        users: users.map((u) => ({
          _id: u._id,
          phone: u.phone,
          name: u.name,
          email: u.email,
          type: 'user',
        })),
      });
    } catch (error) {
      logger.error('[WhatsApp Controller] Get recipients error', {
        error: error.message,
      });
      next(error);
    }
  }
}

module.exports = new WhatsAppController();