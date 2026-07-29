const mongoose = require('mongoose');
let twilio = null;

// Try to load Twilio, but don't crash if it's not available
try {
  twilio = require('twilio');
} catch (error) {
  console.warn('[WhatsApp] Twilio package not installed. WhatsApp features will be simulated.');
}

const WhatsAppMessage = require('../../models/whatsapp/whatsapp.model');
const Sim = require('../../models/sim/sim.model');
const User = require('../../models/auth/user.model');
const { AppError, NotFoundError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const crypto = require('crypto');
const auditLogService = require('../auditLog/auditLog.service');

class WhatsAppService {
  constructor() {
    // Twilio credentials from environment
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.phoneNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
    // Status callback URL (optional - for delivery status updates)
    this.statusCallback = process.env.TWILIO_STATUS_CALLBACK || '';

    // Initialize Twilio client if credentials are available
    if (this.accountSid && this.authToken && twilio) {
      try {
        this.client = twilio(this.accountSid, this.authToken);
        logger.info('[WhatsApp] Twilio client initialized successfully');
      } catch (error) {
        logger.error('[WhatsApp] Failed to initialize Twilio client', { error: error.message });
        this.client = null;
      }
    } else {
      logger.warn('[WhatsApp] Twilio credentials not configured. Messages will be logged only.');
      this.client = null;
    }
  }

  /**
   * Send WhatsApp message to a single number
   * @param {string} to - Phone number (with country code)
   * @param {string} message - Message content
   * @returns {Object} - Result with success status and twilio SID
   */
  async sendWhatsAppMessage(to, message) {
    // Format phone number for WhatsApp
    let formattedNumber = to;
    if (!to.startsWith('whatsapp:')) {
      formattedNumber = `whatsapp:${to.startsWith('+') ? to : '+' + to}`;
    }

    // If Twilio is not configured, simulate success (for development)
    if (!this.client) {
      logger.info(`[WhatsApp SIMULATION] Would send to ${formattedNumber}: ${message}`);
      return {
        success: true,
        sid: `SIM_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        simulated: true,
      };
    }

    try {
      // Build message payload
      const messagePayload = {
        from: this.phoneNumber,
        to: formattedNumber,
        body: message,
      };

      // Only add statusCallback if it's a valid URL
      if (this.statusCallback && this.statusCallback.startsWith('http')) {
        messagePayload.statusCallback = this.statusCallback;
      }

      const result = await this.client.messages.create(messagePayload);

      logger.info(`[WhatsApp] Message sent to ${formattedNumber}`, {
        sid: result.sid,
        status: result.status,
      });

      return {
        success: true,
        sid: result.sid,
        status: result.status,
      };
    } catch (error) {
      logger.error(`[WhatsApp] Failed to send message to ${formattedNumber}`, {
        error: error.message,
        code: error.code,
      });

      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
  }

  /**
   * Send bulk WhatsApp messages
   * @param {Object} data - { simIds, userIds, message, updateSimStatus }
   * @param {Object} user - Current authenticated user
   * @returns {Object} - Results with sent/failed counts
   */
  async sendBulkMessages(data, user) {
    const { simIds = [], userIds = [], message, updateSimStatus = false } = data;
    const companyId = user.companyId;
    const results = {
      sent: 0,
      failed: 0,
      total: 0,
      messages: [],
      errors: [],
    };

    // Generate batch ID for this bulk send
    const batchId = `BATCH_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Collect all phone numbers with their references
    const recipients = [];

    // Fetch SIMs and extract phone numbers
    if (simIds.length > 0) {
      // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
      const sims = await Sim.find({
        _id: { $in: simIds },
        companyId,
      }).populate('assignedTo', 'name email');

      sims.forEach((sim) => {
        recipients.push({
          phoneNumber: sim.mobileNumber,
          simId: sim._id,
          userId: sim.assignedTo?._id || null,
          name: sim.assignedTo?.name || 'Unassigned',
        });
      });
    }

    // Fetch Users and extract phone numbers
    if (userIds.length > 0) {
      // [HARD DELETE] Removed isActive: true filter - users are now hard deleted
      const users = await User.find({
        _id: { $in: userIds },
        companyId,
      });

      users.forEach((u) => {
        // Use phone field for users
        if (u.phone) {
          recipients.push({
            phoneNumber: u.phone,
            simId: null,
            userId: u._id,
            name: u.name,
          });
        }
      });
    }

    // Remove duplicates based on phone number
    const uniqueRecipients = [];
    const seenNumbers = new Set();

    recipients.forEach((recipient) => {
      const normalizedNumber = recipient.phoneNumber.replace(/[\s\-\(\)]/g, '');
      if (!seenNumbers.has(normalizedNumber)) {
        seenNumbers.add(normalizedNumber);
        uniqueRecipients.push({
          ...recipient,
          phoneNumber: normalizedNumber,
        });
      }
    });

    results.total = uniqueRecipients.length;

    if (uniqueRecipients.length === 0) {
      throw new AppError('No valid recipients found', 400);
    }

    // Send messages
    for (const recipient of uniqueRecipients) {
      try {
        // Send via Twilio
        const sendResult = await this.sendWhatsAppMessage(recipient.phoneNumber, message);

        // Save message record
        const messageRecord = new WhatsAppMessage({
          companyId,
          simId: recipient.simId,
          userId: recipient.userId,
          phoneNumber: recipient.phoneNumber,
          message,
          status: sendResult.success ? 'sent' : 'failed',
          twilioMessageSid: sendResult.sid || null,
          sentAt: new Date(),
          batchId,
          createdBy: user._id,
          errorMessage: sendResult.error || null,
          updateSimStatus,
        });

        await messageRecord.save();

        results.messages.push({
          phoneNumber: recipient.phoneNumber,
          name: recipient.name,
          status: sendResult.success ? 'sent' : 'failed',
          messageId: messageRecord._id,
        });

        if (sendResult.success) {
          results.sent++;
        } else {
          results.failed++;
          results.errors.push({
            phoneNumber: recipient.phoneNumber,
            error: sendResult.error,
          });
        }
      } catch (error) {
        logger.error(`[WhatsApp] Error processing recipient ${recipient.phoneNumber}`, {
          error: error.message,
        });
        results.failed++;
        results.errors.push({
          phoneNumber: recipient.phoneNumber,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Handle incoming webhook from Twilio
   * @param {Object} webhookData - Data from Twilio webhook
   * @returns {Object} - Processing result
   */
  async handleWebhook(webhookData) {
    console.log("Whatsapp Wehook call :", webhookData)
    const { From, To, Body, MessageSid, MessageType, SmsStatus, MessageStatus } = webhookData;
    console.log("Webhook data : ", webhookData)

    // Log everything for debugging
    logger.info('[WhatsApp Webhook] ===== FULL WEBHOOK DATA =====');
    logger.info('[WhatsApp Webhook] Full data:', JSON.stringify(webhookData, null, 2));

    // Determine if this is an incoming message (reply) or status callback
    const isIncomingMessage = Body && From && From !== this.phoneNumber;

    // If it's a status callback (no body, or from our own number), ignore it
    if (!Body || From === this.phoneNumber || From === 'whatsapp:+14155238886') {
      logger.info('[WhatsApp Webhook] Ignoring status callback or non-reply message');
      return {
        success: true,
        message: 'Status callback ignored',
      };
    }

    // Extract phone number from the sender (From field)
    let rawPhone = From.replace('whatsapp:', '').replace('whatsapp:', '');
    const normalizedPhone = rawPhone.replace(/[^\d+]/g, '');
    const phoneWithoutPlus = normalizedPhone.replace('+', '');
    const phoneWithPlus = normalizedPhone.startsWith('+') ? normalizedPhone : '+' + normalizedPhone;

    logger.info(`[WhatsApp Webhook] Processing reply from ${normalizedPhone}`, {
      messageSid: MessageSid,
      body: Body,
      rawFrom: From,
      searchPatterns: { phoneWithPlus, phoneWithoutPlus },
    });

    // Find the latest message sent TO this phone number
    const latestMessage = await WhatsAppMessage.findOne({
      $or: [
        { phoneNumber: phoneWithPlus },
        { phoneNumber: phoneWithoutPlus },
        { phoneNumber: { $regex: phoneWithoutPlus, $options: 'i' } },
        { phoneNumber: { $regex: phoneWithoutPlus.slice(-10), $options: 'i' } }, // Last 10 digits
      ],
      status: { $in: ['sent', 'delivered'] },
      isActive: null,
    }).sort({ sentAt: -1 });

    if (!latestMessage) {
      logger.warn(`[WhatsApp Webhook] No pending message found for ${normalizedPhone}`, {
        searchPatterns: { phoneWithPlus, phoneWithoutPlus },
        dbQuery: {
          $or: [
            { phoneNumber: phoneWithPlus },
            { phoneNumber: phoneWithoutPlus },
          ],
          status: { $in: ['sent', 'delivered'] },
          isActive: null,
        },
      });
      return {
        success: false,
        message: 'No pending message found for this phone number',
        phoneNumber: normalizedPhone,
      };
    }

    // Calculate time since message was sent
    const timeSinceSent = Date.now() - new Date(latestMessage.sentAt).getTime();
    const oneHour = 60 * 60 * 1000;
    const isWithinOneHour = timeSinceSent <= oneHour;

    logger.info(`[WhatsApp Webhook] Found message ${latestMessage._id}`, {
      timeSinceSent: Math.round(timeSinceSent / 1000 / 60) + ' minutes',
      isWithinOneHour,
      updateSimStatus: latestMessage.updateSimStatus,
    });

    // Update message record
    latestMessage.status = 'replied';
    latestMessage.repliedAt = new Date();
    latestMessage.replyMessage = Body;
    latestMessage.isActive = isWithinOneHour;

    await latestMessage.save();

    logger.info(`[WhatsApp Webhook] Message updated successfully`, {
      messageId: latestMessage._id,
      status: 'replied',
      isActive: isWithinOneHour,
    });

    // Update SIM status only if updateSimStatus flag is enabled
    if (latestMessage.simId && latestMessage.updateSimStatus) {
      try {
        const sim = await Sim.findById(latestMessage.simId);
        if (sim) {
          // Always update last active timestamp
          sim.whatsappLastActive = new Date();

          // If replied within 1 hour, mark SIM as active
          if (isWithinOneHour && sim.status !== 'active') {
            const previousStatus = sim.status;
            sim.status = 'active';
            sim.lastActiveDate = new Date();

            await sim.save();

            logger.info(`[WhatsApp Webhook] SIM ${sim.mobileNumber} marked ACTIVE (updateSimStatus enabled)`);

            // Create audit log
            // [AUDIT LOG FIX] - Added role: 'system' and performedBy: null for automated webhook events
            await auditLogService.logAction({
              action: 'WHATSAPP_SIM_ACTIVE',
              module: 'WHATSAPP',
              description: `SIM ${sim.mobileNumber} marked ACTIVE via WhatsApp reply (within 1 hour)`,
              performedBy: null,
              role: 'system',
              companyId: sim.companyId,
              entityId: sim._id,
              entityType: 'SIM',
              metadata: {
                simMobileNumber: sim.mobileNumber,
                previousStatus,
                messageId: latestMessage._id,
                responseTime: Math.round(timeSinceSent / 1000 / 60) + ' minutes',
              },
            });
          } else {
            await sim.save();
            logger.info(`[WhatsApp Webhook] Updated SIM ${sim.mobileNumber} last active timestamp`);
          }
        }
      } catch (error) {
        logger.error('[WhatsApp Webhook] Error updating SIM', {
          error: error.message,
        });
      }
    } else if (latestMessage.simId) {
      // Just update last active timestamp
      try {
        const sim = await Sim.findById(latestMessage.simId);
        if (sim) {
          sim.whatsappLastActive = new Date();
          await sim.save();
          logger.info(`[WhatsApp Webhook] Updated SIM ${sim.mobileNumber} last active timestamp`);
        }
      } catch (error) {
        logger.error('[WhatsApp Webhook] Error updating SIM last active', {
          error: error.message,
        });
      }
    }

    return {
      success: true,
      message: 'Reply processed successfully',
      isActive: isWithinOneHour,
      messageId: latestMessage._id,
      companyId: latestMessage.companyId,
      simId: latestMessage.simId,
    };
  }

  /**
   * Process messages that have not received reply within 1 hour
   * Called by cron job
   * Updates message status and SIM status if updateSimStatus flag is enabled
   */
  async processInactiveMessages() {
    logger.info('[WhatsApp Cron] Processing inactive messages...');

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Find messages that are sent/delivered but not replied within 1 hour
    const messagesToUpdate = await WhatsAppMessage.find({
      status: { $in: ['sent', 'delivered'] },
      isActive: null,
      sentAt: { $lte: oneHourAgo },
    });

    let updatedCount = 0;
    let simUpdatedCount = 0;

    for (const message of messagesToUpdate) {
      // Update message status
      message.status = 'inactive';
      message.isActive = false;
      await message.save();
      updatedCount++;

      logger.info(`[WhatsApp Cron] Message ${message._id} marked inactive (no reply within 1 hour)`);

      // Update SIM status only if updateSimStatus flag is enabled
      if (message.simId && message.updateSimStatus) {
        try {
          const sim = await Sim.findById(message.simId);
          if (sim && sim.status === 'active') {
            sim.status = 'inactive';
            await sim.save();
            simUpdatedCount++;

            // Create audit log for SIM inactivation
            // [AUDIT LOG FIX] - Added role: 'system' and performedBy: null for automated cron events
            await auditLogService.logAction({
              action: 'WHATSAPP_SIM_INACTIVE',
              module: 'WHATSAPP',
              description: `SIM ${sim.mobileNumber} marked INACTIVE via WhatsApp (no reply within 1 hour)`,
              performedBy: null,
              role: 'system',
              companyId: sim.companyId,
              entityId: sim._id,
              entityType: 'SIM',
              metadata: {
                simMobileNumber: sim.mobileNumber,
                messageId: message._id,
                messageSentAt: message.sentAt,
              },
            });

            logger.info(`[WhatsApp Cron] SIM ${sim.mobileNumber} marked INACTIVE (updateSimStatus enabled)`);
          }
        } catch (error) {
          logger.error(`[WhatsApp Cron] Error updating SIM ${message.simId}`, {
            error: error.message,
          });
        }
      }
    }

    logger.info(`[WhatsApp Cron] Processed ${updatedCount} messages, updated ${simUpdatedCount} SIMs`);

    return {
      processed: updatedCount,
      simsUpdated: simUpdatedCount,
    };
  }

  /**
   * Get messages for a company
   */
  async getMessages(query, user) {
    const { page = 1, limit = 20, status, phoneNumber, batchId, startDate, endDate } = query;
    const filter = { companyId: user.companyId };

    if (status) filter.status = status;
    if (phoneNumber) filter.phoneNumber = { $regex: phoneNumber, $options: 'i' };
    if (batchId) filter.batchId = batchId;

    if (startDate || endDate) {
      filter.sentAt = {};
      if (startDate) filter.sentAt.$gte = new Date(startDate);
      if (endDate) filter.sentAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const data = await WhatsAppMessage.find(filter)
      .populate('simId', 'mobileNumber operator status')
      .populate('userId', 'name email')
      .populate('createdBy', 'name email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ sentAt: -1 });

    const total = await WhatsAppMessage.countDocuments(filter);

    return {
      data,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    };
  }

  /**
   * Get message stats for a company
   */
  async getStats(user, startDate, endDate) {
    return await WhatsAppMessage.getStatsByCompany(user.companyId, startDate, endDate);
  }

  /**
   * Validate Twilio webhook signature
   * @param {string} url - Webhook URL
   * @param {Object} params - Request parameters
   * @param {string} signature - X-Twilio-Signature header
   * @returns {boolean} - Whether signature is valid
   */
  validateWebhookSignature(url, params, signature) {
    if (!this.authToken) {
      logger.warn('[WhatsApp] Cannot validate webhook - no auth token');
      return true; // Allow in development
    }

    // Create the signature string
    const signatureString = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], url);

    // Calculate expected signature
    const expectedSignature = crypto
      .createHmac('sha1', this.authToken)
      .update(signatureString)
      .digest('Base64');

    return signature === expectedSignature;
  }
}

module.exports = new WhatsAppService();