const telegramService = require('../../services/telegram/telegram.service');
const Sim = require('../../models/sim/sim.model');
const User = require('../../models/auth/user.model');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const emailService = require('../../utils/emailService');
const auditLogService = require('../../services/auditLog/auditLog.service');

class TelegramController {
  /**
   * Handle Telegram webhook
   * POST /api/telegram/webhook
   * Public endpoint - no authentication required
   */
  async handleWebhook(req, res, next) {
    try {
      const update = req.body;

      // Always respond 200 to Telegram
      res.status(200).json({ ok: true });

      // Process the update asynchronously
      const result = await telegramService.handleWebhook(update);

      logger.info('[Telegram Controller] Webhook processed', { result });
    } catch (error) {
      logger.error('[Telegram Controller] Webhook error', { error: error.message });
      // Always respond 200 even on error
      res.status(200).json({ ok: true });
    }
  }

  /**
   * Send bulk Telegram messages
   * POST /api/telegram/send-bulk
   * Requires admin role
   */
  async sendBulk(req, res, next) {
    try {
      const { simIds, message } = req.body;
      const user = req.user;

      if (!simIds || !Array.isArray(simIds) || simIds.length === 0) {
        throw new AppError('SIM IDs are required', 400);
      }

      if (!message || message.trim().length === 0) {
        throw new AppError('Message is required', 400);
      }

      const result = await telegramService.sendToSIMs({ simIds, message }, user);

      // Determine if single or bulk send
      const isSingleSend = simIds.length === 1;
      const auditAction = isSingleSend ? 'TELEGRAM_MESSAGE_SEND' : 'TELEGRAM_MESSAGE_SEND_BULK';

      // Create audit log
      await auditLogService.logAction({
        action: auditAction,
        module: 'TELEGRAM',
        description: isSingleSend
          ? `Sent Telegram message to SIM ${result.messages[0]?.mobileNumber || 'unknown'}`
          : `Sent bulk Telegram messages: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`,
        performedBy: user._id,
        role: user.role,
        companyId: user.companyId,
        entityId: isSingleSend ? simIds[0] : null,
        entityType: isSingleSend ? 'SIM' : null,
        metadata: {
          totalSims: result.total,
          sent: result.sent,
          failed: result.failed,
          skipped: result.skipped,
          messageLength: message.length,
          simIds: isSingleSend ? undefined : simIds.slice(0, 50), // Store SIM IDs for bulk, limit to 50
        },
        req,
      });

      res.status(200).json({
        success: true,
        message: `Sent ${result.sent} messages, ${result.failed} failed, ${result.skipped} skipped`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Telegram messages for company
   * GET /api/telegram/messages
   */
  async getMessages(req, res, next) {
    try {
      const result = await telegramService.getMessages(req.query, req.user);

      res.status(200).json({
        success: true,
        data: result.data,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: Math.ceil(result.total / result.limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get message statistics
   * GET /api/telegram/stats
   */
  async getStats(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const stats = await telegramService.getStats(req.user, startDate, endDate);

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get eligible SIMs (with telegramChatId)
   * GET /api/telegram/sims
   */
  async getEligibleSIMs(req, res, next) {
    try {
      const sims = await telegramService.getEligibleSIMs(req.user);

      res.status(200).json({
        success: true,
        count: sims.length,
        data: sims,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Generate deep link for SIM
   * GET /api/telegram/link/:simId
   */
  async generateLink(req, res, next) {
    try {
      const { simId } = req.params;
      const user = req.user;

      // Verify SIM exists and belongs to user's company
      const sim = await Sim.findOne({
        _id: simId,
        companyId: user.companyId,
        isActive: true,
      });

      if (!sim) {
        throw new AppError('SIM not found', 404);
      }

      const link = telegramService.generateDeepLink(simId);

      res.status(200).json({
        success: true,
        data: {
          simId: sim._id,
          mobileNumber: sim.mobileNumber,
          telegramChatId: sim.telegramChatId,
          telegramEnabled: sim.telegramEnabled,
          deepLink: link,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Unlink Telegram from SIM
   * DELETE /api/telegram/unlink/:simId
   */
  async unlinkSIM(req, res, next) {
    try {
      const { simId } = req.params;
      const user = req.user;

      // Verify SIM exists and belongs to user's company
      const sim = await Sim.findOne({
        _id: simId,
        companyId: user.companyId,
      });

      if (!sim) {
        throw new AppError('SIM not found', 404);
      }

      // Unlink Telegram
      sim.telegramChatId = null;
      sim.telegramEnabled = false;
      await sim.save();

      // Create audit log
      await auditLogService.logAction({
        action: 'TELEGRAM_SIM_UNLINK',
        module: 'TELEGRAM',
        description: `Telegram unlinked from SIM ${sim.mobileNumber}`,
        performedBy: user._id,
        role: user.role,
        companyId: user.companyId,
        entityId: sim._id,
        entityType: 'SIM',
        metadata: {
          simMobileNumber: sim.mobileNumber,
        },
        req,
      });

      res.status(200).json({
        success: true,
        message: 'Telegram unlinked from SIM',
        data: {
          simId: sim._id,
          mobileNumber: sim.mobileNumber,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Manually process inactive messages
   * POST /api/telegram/process-inactive
   */
  async processInactive(req, res, next) {
    try {
      const result = await telegramService.processInactiveMessages();

      res.status(200).json({
        success: true,
        message: `Processed ${result.processed} messages, ${result.simsUpdated} SIMs marked inactive`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Set webhook URL
   * POST /api/telegram/set-webhook
   * Super admin only
   */
  async setWebhook(req, res, next) {
    try {
      const { webhookUrl } = req.body;

      if (!webhookUrl) {
        throw new AppError('Webhook URL is required', 400);
      }

      const result = await telegramService.setWebhook(webhookUrl);

      res.status(200).json({
        success: true,
        message: 'Webhook set successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get webhook info
   * GET /api/telegram/webhook-info
   * Admin only
   */
  async getWebhookInfo(req, res, next) {
    try {
      const info = await telegramService.getWebhookInfo();

      res.status(200).json({
        success: true,
        data: info,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Test webhook endpoint
   * GET /api/telegram/webhook-test
   */
  async testWebhook(req, res) {
    res.json({
      success: true,
      message: 'Telegram webhook endpoint is accessible',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send Telegram link to single user via email
   * POST /api/telegram/send-link-email
   * Admin only
   */
  async sendLinkEmail(req, res, next) {
    try {
      const { simId } = req.body;
      const user = req.user;

      if (!simId) {
        throw new AppError('SIM ID is required', 400);
      }

      // Get SIM with assigned user
      const sim = await Sim.findOne({
        _id: simId,
        companyId: user.companyId,
        isActive: true,
      }).populate('assignedTo', 'name email');

      if (!sim) {
        throw new AppError('SIM not found', 404);
      }

      // Generate Telegram link
      const telegramLink = telegramService.generateDeepLink(simId);

      // Check if user is assigned and has email
      const recipientEmail = sim.assignedTo?.email;
      const recipientName = sim.assignedTo?.name || 'User';

      // Try to send email, but don't fail if it doesn't work
      let emailSent = false;
      let emailError = null;

      if (recipientEmail) {
        try {
          const emailResult = await emailService.sendTelegramLinkEmail(
            { email: recipientEmail, name: recipientName },
            sim,
            telegramLink,
            user
          );
          emailSent = emailResult.success;
          if (!emailResult.success) {
            emailError = emailResult.error;
            logger.warn('[Telegram] Email sending failed, returning link directly', {
              error: emailResult.error,
              simId: sim._id,
            });
          }
        } catch (err) {
          emailError = err.message;
          logger.error('[Telegram] Email sending error', {
            error: err.message,
            simId: sim._id,
          });
        }
      } else {
        logger.info('[Telegram] No email assigned to SIM, returning link directly', {
          simId: sim._id,
        });
      }

      // Create audit log
      await auditLogService.logAction({
        action: emailSent ? 'TELEGRAM_LINK_SEND' : 'TELEGRAM_LINK_GENERATED',
        module: 'TELEGRAM',
        description: emailSent
          ? `Telegram link email sent for SIM ${sim.mobileNumber} to ${recipientEmail}`
          : `Telegram link generated for SIM ${sim.mobileNumber} (email not sent: ${emailError || 'no email'})`,
        performedBy: user._id,
        role: user.role,
        companyId: user.companyId,
        entityId: sim._id,
        entityType: 'SIM',
        metadata: {
          simMobileNumber: sim.mobileNumber,
          recipientEmail: recipientEmail || null,
          recipientName: recipientName,
          emailSent,
          link: telegramLink,
        },
        req,
      });

      // Always return the link (even if email failed)
      res.status(200).json({
        success: true,
        message: emailSent
          ? `Telegram link sent to ${recipientEmail}`
          : `Telegram link generated. ${emailError ? `Email failed: ${emailError}. ` : ''}Share the link manually.`,
        data: {
          simId: sim._id,
          mobileNumber: sim.mobileNumber,
          operator: sim.operator,
          email: recipientEmail || null,
          emailSent,
          emailError: emailSent ? null : emailError,
          link: telegramLink,
          // Include QR code link for easy sharing
          qrLink: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(telegramLink)}`,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Send Telegram links to all users (bulk email)
   * POST /api/telegram/send-link-email-bulk
   * Admin only
   */
  async sendLinkEmailBulk(req, res, next) {
    try {
      const { simIds } = req.body;
      const user = req.user;

      if (!simIds || !Array.isArray(simIds) || simIds.length === 0) {
        throw new AppError('SIM IDs are required', 400);
      }

      // Get SIMs with assigned users
      const sims = await Sim.find({
        _id: { $in: simIds },
        companyId: user.companyId,
        isActive: true,
      }).populate('assignedTo', 'name email');

      if (sims.length === 0) {
        throw new AppError('No valid SIMs found', 404);
      }

      // Prepare results with links (always return links)
      const results = {
        sent: 0,
        failed: 0,
        skipped: 0,
        details: [],
        links: [], // Always include links for manual sharing
      };

      // Generate links for all SIMs
      for (const sim of sims) {
        const link = telegramService.generateDeepLink(sim._id);
        results.links.push({
          simId: sim._id,
          mobileNumber: sim.mobileNumber,
          operator: sim.operator,
          assignedTo: sim.assignedTo?.name || null,
          email: sim.assignedTo?.email || null,
          link,
          qrLink: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}`,
        });
      }

      // Group SIMs by user email for bulk emails
      const userSimMap = new Map();

      for (const sim of sims) {
        if (sim.assignedTo && sim.assignedTo.email) {
          const userEmail = sim.assignedTo.email;
          if (!userSimMap.has(userEmail)) {
            userSimMap.set(userEmail, {
              user: sim.assignedTo,
              simLinks: [],
            });
          }
          userSimMap.get(userEmail).simLinks.push({
            sim: {
              _id: sim._id,
              mobileNumber: sim.mobileNumber,
              operator: sim.operator,
              status: sim.status,
              circle: sim.circle,
            },
            link: telegramService.generateDeepLink(sim._id),
          });
        }
      }

      // Try to send emails (but don't fail if email doesn't work)
      for (const [email, { simLinks }] of userSimMap) {
        try {
          const emailResult = await emailService.sendBulkTelegramLinkEmail(
            { email, name: simLinks[0].sim.assignedTo?.name || 'User' },
            simLinks,
            user
          );

          if (emailResult.success) {
            results.sent++;
            results.details.push({
              email,
              status: 'sent',
              simCount: simLinks.length,
            });
          } else {
            results.failed++;
            results.details.push({
              email,
              status: 'failed',
              error: emailResult.error,
              simCount: simLinks.length,
              // Include links for manual sharing
              links: simLinks.map(sl => ({ mobileNumber: sl.sim.mobileNumber, link: sl.link })),
            });
          }
        } catch (error) {
          results.failed++;
          results.details.push({
            email,
            status: 'failed',
            error: error.message,
            simCount: simLinks.length,
            // Include links for manual sharing
            links: simLinks.map(sl => ({ mobileNumber: sl.sim.mobileNumber, link: sl.link })),
          });
        }
      }

      // Count skipped SIMs (no assigned user or no email)
      const skippedSims = sims.filter((s) => !s.assignedTo || !s.assignedTo.email);
      results.skipped = skippedSims.length;

      // Create audit log
      await auditLogService.logAction({
        action: 'TELEGRAM_LINK_SEND_BULK',
        module: 'TELEGRAM',
        description: `Bulk Telegram link: ${results.sent} emails sent, ${results.failed} failed, ${results.skipped} skipped. Links generated for ${results.links.length} SIMs.`,
        performedBy: user._id,
        role: user.role,
        companyId: user.companyId,
        metadata: {
          totalSims: simIds.length,
          emailsSent: results.sent,
          emailsFailed: results.failed,
          skipped: results.skipped,
          linksGenerated: results.links.length,
        },
        req,
      });

      logger.info(`[Telegram] Bulk link processed`, {
        sent: results.sent,
        failed: results.failed,
        skipped: results.skipped,
        linksGenerated: results.links.length,
      });

      res.status(200).json({
        success: true,
        message: results.failed > 0
          ? `Processed: ${results.sent} emails sent, ${results.failed} failed. Links available for manual sharing.`
          : `Emails sent: ${results.sent}, Skipped: ${results.skipped}`,
        data: results,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TelegramController();