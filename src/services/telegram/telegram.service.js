const mongoose = require('mongoose');
const axios = require('axios');
const TelegramMessage = require('../../models/telegram/telegram.model');
const Sim = require('../../models/sim/sim.model');
const { AppError, NotFoundError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const auditLogService = require('../auditLog/auditLog.service');

// Telegram Bot Token from environment
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Debug: Log token status on service initialization
console.log('[Telegram Service] ========================================');
console.log('[Telegram Service] TELEGRAM_BOT_TOKEN status:', TELEGRAM_BOT_TOKEN ? 'SET (' + TELEGRAM_BOT_TOKEN.substring(0, 10) + '...)' : 'NOT SET or EMPTY');
console.log('[Telegram Service] TELEGRAM_BOT_TOKEN length:', TELEGRAM_BOT_TOKEN ? TELEGRAM_BOT_TOKEN.length : 0);
console.log('[Telegram Service] ========================================');

// Validate token and construct API base
const TELEGRAM_API_BASE = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : null;

console.log('[Telegram Service] TELEGRAM_API_BASE:', TELEGRAM_API_BASE ? 'SET (https://api.telegram.org/bot...)' : 'NOT SET');

class TelegramService {
  constructor() {
    // Check if bot token is configured
    this.isConfigured = !!TELEGRAM_BOT_TOKEN;

    console.log('[Telegram Service] ========================================');
    console.log('[Telegram Service] Service initialization...');
    console.log('[Telegram Service] TELEGRAM_BOT_TOKEN:', TELEGRAM_BOT_TOKEN ? 'SET (length: ' + TELEGRAM_BOT_TOKEN.length + ')' : 'NOT SET or EMPTY');
    console.log('[Telegram Service] this.isConfigured:', this.isConfigured);
    console.log('[Telegram Service] ========================================');

    if (this.isConfigured) {
      logger.info('[Telegram] Bot token configured, service ready');
    } else {
      logger.warn('[Telegram] Bot token not configured. Telegram features will be simulated.');
    }
  }

  /**
   * Send Telegram message to a single chat
   * @param {string} chatId - Telegram chat ID
   * @param {string} message - Message content
   * @returns {Object} - Result with success status and message ID
   */
  async sendTelegramMessage(chatId, message) {
    console.log('[Telegram] ========== SEND MESSAGE START ==========');

    // Check token status
    if (!TELEGRAM_BOT_TOKEN) {
      console.error('[Telegram] ERROR: TELEGRAM_BOT_TOKEN is NOT SET or EMPTY');
      console.error('[Telegram] Cannot send message - missing bot token');
      return {
        success: false,
        error: 'Telegram bot token not configured',
        errorCode: 'TOKEN_MISSING',
      };
    }

    // If not configured, simulate success (for development)
    if (!this.isConfigured) {
      console.warn('[Telegram] WARNING: Bot token not configured, simulating success');
      logger.info(`[Telegram SIMULATION] Would send to chat ${chatId}: ${message.substring(0, 50)}...`);
      return {
        success: true,
        messageId: Date.now(),
        simulated: true,
      };
    }

    console.log('[Telegram] Sending message to chatId:', chatId);
    console.log('[Telegram] Message length:', message.length);
    console.log('[Telegram] Bot token (first 10 chars):', TELEGRAM_BOT_TOKEN ? TELEGRAM_BOT_TOKEN.substring(0, 10) + '...' : 'NOT SET');

    try {
      const apiUrl = `${TELEGRAM_API_BASE}/sendMessage`;
      console.log('[Telegram] API URL:', apiUrl.replace(TELEGRAM_BOT_TOKEN, 'TOKEN_HIDDEN'));

      const requestBody = {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      };

      console.log('[Telegram] Request body:', JSON.stringify({ chat_id: chatId, text_length: message.length, parse_mode: 'HTML' }));

      const response = await axios.post(apiUrl, requestBody);

      console.log('[Telegram] API Response status:', response.status);
      console.log('[Telegram] API Response data:', JSON.stringify(response.data));
      console.log('[Telegram] SUCCESS: Message sent to chat', chatId, '- messageId:', response.data.result.message_id);

      logger.info(`[Telegram] Message sent to chat ${chatId}`, {
        messageId: response.data.result.message_id,
      });

      console.log('[Telegram] ========== SEND MESSAGE END (SUCCESS) ==========');

      return {
        success: true,
        messageId: response.data.result.message_id,
        status: 'sent',
      };
    } catch (error) {
      console.error('[Telegram] ========== SEND MESSAGE ERROR ==========');
      console.error('[Telegram] Error sending message to chat:', chatId);
      console.error('[Telegram] Error name:', error.name);
      console.error('[Telegram] Error message:', error.message);

      if (error.response) {
        console.error('[Telegram] Error response status:', error.response.status);
        console.error('[Telegram] Error response data:', JSON.stringify(error.response.data));
        console.error('[Telegram] Error description:', error.response.data?.description);
        console.error('[Telegram] Error code:', error.response.data?.error_code);
      } else if (error.request) {
        console.error('[Telegram] No response received - request made but no response');
        console.error('[Telegram] Request details:', error.config?.url);
      } else {
        console.error('[Telegram] Error setting up request:', error.message);
      }

      console.error('[Telegram] ========== SEND MESSAGE END (ERROR) ==========');

      logger.error(`[Telegram] Failed to send message to chat ${chatId}`, {
        error: error.response?.data || error.message,
      });

      return {
        success: false,
        error: error.response?.data?.description || error.message || 'Unknown Telegram API error',
        errorCode: error.response?.data?.error_code || 'UNKNOWN',
      };
    }
  }

  /**
   * Send Telegram message with keyboard (buttons)
   * @param {string} chatId - Telegram chat ID
   * @param {string} message - Message content
   * @param {Object} keyboard - Reply keyboard markup
   * @returns {Object} - Result with success status and message ID
   */
  async sendTelegramMessageWithKeyboard(chatId, message, keyboard) {
    // If not configured, simulate success (for development)
    if (!this.isConfigured) {
      logger.info(`[Telegram SIMULATION] Would send to chat ${chatId} with keyboard: ${message.substring(0, 50)}...`);
      return {
        success: true,
        messageId: Date.now(),
        simulated: true,
      };
    }

    try {
      const response = await axios.post(`${TELEGRAM_API_BASE}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      logger.info(`[Telegram] Message with keyboard sent to chat ${chatId}`, {
        messageId: response.data.result.message_id,
      });

      return {
        success: true,
        messageId: response.data.result.message_id,
        status: 'sent',
      };
    } catch (error) {
      logger.error(`[Telegram] Failed to send message with keyboard to chat ${chatId}`, {
        error: error.response?.data || error.message,
      });

      return {
        success: false,
        error: error.response?.data?.description || error.message,
        errorCode: error.response?.data?.error_code,
      };
    }
  }

  /**
   * Send Telegram messages to multiple SIMs
   * @param {Object} data - { simIds, message, updateSimStatus }
   * @param {Object} user - Current authenticated user
   * @returns {Object} - Results with sent/failed counts
   */
  async sendToSIMs(data, user) {
    console.log('[Telegram] ========== BULK SEND START ==========');

    const { simIds = [], message, updateSimStatus = false } = data;
    const companyId = user.companyId;

    console.log('[Telegram] Bulk send request received');
    console.log('[Telegram] - simIds count:', simIds.length);
    console.log('[Telegram] - message length:', message?.length || 0);
    console.log('[Telegram] - updateSimStatus:', updateSimStatus);
    console.log('[Telegram] - companyId:', companyId);
    console.log('[Telegram] - Bot token configured:', !!TELEGRAM_BOT_TOKEN);
    console.log('[Telegram] - Bot token length:', TELEGRAM_BOT_TOKEN ? TELEGRAM_BOT_TOKEN.length : 0);

    const results = {
      sent: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      messages: [],
      errors: [],
    };

    // Generate batch ID for this bulk send
    const batchId = `TG_BATCH_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    if (simIds.length === 0) {
      console.error('[Telegram] ERROR: No SIMs provided');
      throw new AppError('No SIMs provided', 400);
    }

    // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
    const sims = await Sim.find({
      _id: { $in: simIds },
      companyId,
    }).populate('assignedTo', 'name email');

    console.log('[Telegram] Found', sims.length, 'SIMs from database');

    results.total = sims.length;

    for (const sim of sims) {
      console.log('[Telegram] Processing SIM:', sim.mobileNumber, 'chatId:', sim.telegramChatId || 'NOT LINKED');

      try {
        // Skip if no telegramChatId linked
        if (!sim.telegramChatId) {
          console.warn('[Telegram] SKIPPING SIM', sim.mobileNumber, '- No telegramChatId linked');
          results.skipped++;
          results.messages.push({
            simId: sim._id,
            mobileNumber: sim.mobileNumber,
            status: 'skipped',
            reason: 'SIM not linked to Telegram',
          });
          continue;
        }

        // Send Telegram message
        console.log('[Telegram] Sending to SIM', sim.mobileNumber, '- chatId:', sim.telegramChatId);
        const sendResult = await this.sendTelegramMessage(sim.telegramChatId, message);
        console.log('[Telegram] Send result for', sim.mobileNumber, ':', JSON.stringify(sendResult));

        // Save message record
        const messageRecord = new TelegramMessage({
          companyId,
          simId: sim._id,
          chatId: sim.telegramChatId,
          message,
          status: sendResult.success ? 'sent' : 'failed',
          telegramMessageId: sendResult.messageId || null,
          sentAt: new Date(),
          batchId,
          createdBy: user._id,
          errorMessage: sendResult.error || null,
          updateSimStatus,
        });

        await messageRecord.save();
        console.log('[Telegram] Message record saved:', messageRecord._id);

        results.messages.push({
          simId: sim._id,
          mobileNumber: sim.mobileNumber,
          chatId: sim.telegramChatId,
          status: sendResult.success ? 'sent' : 'failed',
          messageId: messageRecord._id,
        });

        if (sendResult.success) {
          results.sent++;
          console.log('[Telegram] SUCCESS: Message sent to', sim.mobileNumber);
        } else {
          results.failed++;
          const errorMsg = sendResult.error || 'Unknown error';
          console.error('[Telegram] FAILED: Message to', sim.mobileNumber, '- Error:', errorMsg);
          results.errors.push({
            simId: sim._id,
            mobileNumber: sim.mobileNumber,
            error: errorMsg,
          });
        }
      } catch (error) {
        console.error('[Telegram] EXCEPTION processing SIM', sim.mobileNumber, ':', error.message);
        logger.error(`[Telegram] Error processing SIM ${sim.mobileNumber}`, {
          error: error.message,
        });
        results.failed++;
        results.errors.push({
          simId: sim._id,
          mobileNumber: sim.mobileNumber,
          error: error.message,
        });
      }
    }

    console.log('[Telegram] ========== BULK SEND SUMMARY ==========');
    console.log('[Telegram] Total:', results.total);
    console.log('[Telegram] Sent:', results.sent);
    console.log('[Telegram] Failed:', results.failed);
    console.log('[Telegram] Skipped:', results.skipped);
    console.log('[Telegram] Errors:', JSON.stringify(results.errors));
    console.log('[Telegram] ========== BULK SEND END ==========');

    return results;
  }

  /**
   * Send Telegram messages to multiple SIMs with audit logging
   * @param {Object} data - { simIds, message }
   * @param {Object} user - Current authenticated user
   * @param {Object} req - Express request object (for audit log)
   * @returns {Object} - Results with sent/failed counts
   */
  async sendToSIMsWithAudit(data, user, req) {
    const results = await this.sendToSIMs(data, user);

    // Create audit log
    await auditLogService.logAction({
      action: 'TELEGRAM_MESSAGE_SEND_BULK',
      module: 'TELEGRAM',
      description: `Sent bulk Telegram messages: ${results.sent} sent, ${results.failed} failed, ${results.skipped} skipped`,
      performedBy: user._id,
      role: user.role,
      companyId: user.companyId,
      metadata: {
        totalSims: results.total,
        sent: results.sent,
        failed: results.failed,
        skipped: results.skipped,
        messageLength: data.message?.length || 0,
      },
      req,
    });

    return results;
  }

  /**
   * Handle incoming Telegram webhook
   * @param {Object} update - Telegram update object
   * @returns {Object} - Processing result
   */
  async handleWebhook(update) {
    logger.info('[Telegram Webhook] Received update:', JSON.stringify(update));

    // Handle message updates
    if (update.message) {
      // Handle contact sharing (phone number)
      if (update.message.contact) {
        return this.handleContact(update.message);
      }
      return this.handleMessage(update.message);
    }

    // Handle callback queries (button clicks)
    if (update.callback_query) {
      return this.handleCallbackQuery(update.callback_query);
    }

    return { success: true, message: 'Update acknowledged' };
  }

  /**
   * Handle incoming message
   * @param {Object} message - Telegram message object
   */
  async handleMessage(message) {
    const chatId = message.chat.id;
    const text = message.text || '';
    const from = message.from;

    logger.info(`[Telegram] Message from chat ${chatId}:`, {
      text: text.substring(0, 100),
      from: from.username || from.first_name,
    });

    // Handle /start command with SIM linking
    if (text.startsWith('/start')) {
      return this.handleStartCommand(chatId, text, from);
    }

    // Handle regular message (potential reply)
    return this.handleReply(chatId, text);
  }

  /**
   * Handle /start command for SIM linking
   * @param {string} chatId - Telegram chat ID
   * @param {string} text - Command text
   * @param {Object} from - Sender info
   */
  async handleStartCommand(chatId, text, from) {
    // Extract SIM ID from deep link
    // Format: /start SIM_<SIM_ID>
    const parts = text.split(' ');

    if (parts.length < 2 || !parts[1].startsWith('SIM_')) {
      // No SIM ID provided, send welcome message
      await this.sendTelegramMessage(chatId,
        '👋 Welcome to <b>SimTrack Bot</b>!\n\n' +
        'This bot helps track your SIM activity.\n\n' +
        'To link your SIM, please use the link provided by your administrator.'
      );
      return { success: true, message: 'Welcome message sent' };
    }

    const simId = parts[1].replace('SIM_', '');
    const userName = from.username || `${from.first_name} ${from.last_name || ''}`.trim();

    // Validate SIM ID
    if (!mongoose.Types.ObjectId.isValid(simId)) {
      await this.sendTelegramMessage(chatId,
        '❌ Invalid SIM link. Please contact your administrator.'
      );
      return { success: false, message: 'Invalid SIM ID' };
    }

    // Find the SIM
    let sim = await Sim.findById(simId);

    if (!sim) {
      logger.warn('[Telegram] SIM not found by ID, checking for existing chatId link', {
        simId: simId,
        chatId: chatId,
        userName: userName,
      });

      // [FIX] Check if this chatId is already linked to another SIM
      // This handles the case where user clicks an old/expired link but has an existing SIM
      const existingSim = await Sim.findOne({
        telegramChatId: String(chatId),
      }).populate('companyId');

      if (existingSim) {
        logger.info('[Telegram] Found existing SIM linked to chatId', {
          chatId: String(chatId),
          existingSimId: existingSim._id,
          mobileNumber: existingSim.mobileNumber,
          telegramPhoneVerified: existingSim.telegramPhoneVerified,
        });

        // If already verified, confirm to user
        if (existingSim.telegramPhoneVerified) {
          await this.sendTelegramMessage(chatId,
            `✅ <b>Already Verified!</b>\n\n` +
            `📱 SIM: <b>${existingSim.mobileNumber}</b>\n` +
            `📱 Your Number: <b>${existingSim.telegramPhoneNumber || 'N/A'}</b>\n\n` +
            `This SIM is already linked and verified. You will continue to receive activity check messages.`
          );
          return { success: true, message: 'Already linked and verified', simId: existingSim._id };
        }

        // If pending verification, ask for phone number
        sim = existingSim;
      } else {
        // No SIM found by ID and no existing link - show error
        logger.error('[Telegram] SIM not found for linking', {
          simId: simId,
          chatId: chatId,
          userName: userName,
        });
        await this.sendTelegramMessage(chatId,
          '❌ SIM not found. Please contact your administrator.'
        );
        return { success: false, message: 'SIM not found' };
      }
    }

    logger.info('[Telegram] Found SIM for linking', {
      simId: sim._id,
      mobileNumber: sim.mobileNumber,
      existingTelegramChatId: sim.telegramChatId,
      existingTelegramPhoneVerified: sim.telegramPhoneVerified,
    });

    // Check if already linked and verified
    if (sim.telegramChatId && sim.telegramPhoneVerified) {
      // Already verified - just confirm
      await this.sendTelegramMessage(chatId,
        `✅ <b>Already Verified!</b>\n\n` +
        `📱 SIM: <b>${sim.mobileNumber}</b>\n` +
        `📱 Your Number: <b>${sim.telegramPhoneNumber || 'N/A'}</b>\n\n` +
        `This SIM is already linked and verified. You will continue to receive activity check messages.`
      );
      return { success: true, message: 'Already linked and verified', simId: sim._id };
    }

    // [FIX] Clear telegramChatId from any OTHER SIMs that have this chatId (unverified ones)
    // This prevents the issue where multiple SIMs have the same telegramChatId
    const clearResult = await Sim.updateMany(
      {
        telegramChatId: String(chatId),
        telegramPhoneVerified: { $ne: true }, // Only clear unverified ones
        _id: { $ne: sim._id } // Don't clear the current SIM
      },
      {
        $set: {
          telegramChatId: null,
          telegramEnabled: false,
          telegramPhoneVerified: false,
          telegramUsername: null,
          telegramUserId: null,
          telegramFirstName: null,
          telegramLastName: null,
          telegramPhoneNumber: null,
        }
      }
    );

    logger.info('[Telegram] Cleared telegramChatId from other SIMs', {
      chatId: String(chatId),
      currentSimId: sim._id,
      clearedCount: clearResult.modifiedCount,
    });

    // Store Telegram user info temporarily (pending phone verification)
    sim.telegramChatId = String(chatId);
    sim.telegramUsername = userName;
    sim.telegramUserId = from.id;
    sim.telegramFirstName = from.first_name;
    sim.telegramLastName = from.last_name || null;
    sim.telegramEnabled = false; // Will be enabled after phone verification
    sim.telegramPhoneVerified = false;
    sim.telegramLastActive = new Date();

    try {
      const savedSim = await sim.save();
      logger.info('[Telegram] SIM updated with telegramChatId (pending verification)', {
        simId: savedSim._id,
        mobileNumber: savedSim.mobileNumber,
        telegramChatId: savedSim.telegramChatId,
        telegramPhoneVerified: savedSim.telegramPhoneVerified,
        telegramEnabled: savedSim.telegramEnabled,
      });
    } catch (saveError) {
      logger.error('[Telegram] Failed to save SIM with telegramChatId', {
        error: saveError.message,
        simId: sim._id,
        mobileNumber: sim.mobileNumber,
      });
      await this.sendTelegramMessage(chatId,
        '❌ <b>Linking Error!</b>\n\n' +
        'There was a problem linking your SIM. Please contact your administrator.'
      );
      return { success: false, message: 'Failed to save SIM' };
    }

    logger.info(`[Telegram] SIM ${sim.mobileNumber} - pending phone verification`, {
      simId: sim._id,
      chatId: chatId,
      username: userName,
    });

    // Create audit log for initial link attempt
    await auditLogService.logAction({
      action: 'TELEGRAM_SIM_LINK_INITIATED',
      module: 'TELEGRAM',
      description: `SIM ${sim.mobileNumber} - Telegram link initiated by ${userName}, awaiting phone verification`,
      companyId: sim.companyId,
      entityId: sim._id,
      entityType: 'SIM',
      metadata: {
        simMobileNumber: sim.mobileNumber,
        chatId: String(chatId),
        telegramUsername: userName,
        telegramUserId: from.id,
        status: 'pending_verification',
      },
    });

    // Ask user to share phone number for verification
    await this.sendTelegramMessageWithKeyboard(chatId,
      `🔗 <b>Link Your SIM</b>\n\n` +
      `📱 SIM Number: <b>${sim.mobileNumber}</b>\n` +
      `📡 Operator: ${sim.operator}\n\n` +
      `⚠️ <b>Verification Required</b>\n\n` +
      `To complete the link, please share your phone number.\n\n` +
      `Your phone number must match the SIM number above.\n\n` +
      `Tap the button below to share your contact:`,
      {
        keyboard: [[{
          text: '📱 Share Phone Number',
          request_contact: true,
        }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      }
    );

    return {
      success: true,
      message: 'Waiting for phone verification',
      simId: sim._id,
      mobileNumber: sim.mobileNumber,
      status: 'pending_verification',
    };
  }

  /**
   * Handle contact shared by user (phone number)
   * @param {Object} message - Telegram message with contact
   */
  async handleContact(message) {
    const chatId = message.chat.id;
    const contact = message.contact;
    const from = message.from;

    logger.info('[Telegram] handleContact called', {
      chatId: chatId,
      fromId: from?.id,
      fromUsername: from?.username,
      hasContact: !!contact,
      hasPhoneNumber: !!contact?.phone_number,
    });

    if (!contact || !contact.phone_number) {
      await this.sendTelegramMessage(chatId,
        '❌ Could not receive your phone number. Please try again.'
      );
      return { success: false, message: 'No contact data received' };
    }

    // Get phone number and normalize it
    let phoneNumber = contact.phone_number;
    // Remove any non-digit characters except +
    phoneNumber = '+' + phoneNumber.replace(/\D/g, '');

    // [FIX] Find the SIM linked to this chat that is PENDING verification
    // Priority: Find unverified SIM first, fall back to any SIM with this chatId
    // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted

    // [FIX] Use $or to properly match false, null, or undefined telegramPhoneVerified
    let sim = await Sim.findOne({
      telegramChatId: String(chatId),
      $or: [
        { telegramPhoneVerified: false },
        { telegramPhoneVerified: null },
        { telegramPhoneVerified: { $exists: false } }
      ]
    }).populate('companyId');

    logger.info('[Telegram] SIM lookup result (pending verification)', {
      chatId: String(chatId),
      simFound: !!sim,
      simId: sim?._id,
      simMobileNumber: sim?.mobileNumber,
      simTelegramChatId: sim?.telegramChatId,
      simTelegramPhoneVerified: sim?.telegramPhoneVerified,
    });

    // If no pending SIM found, try to find any SIM with this chatId (even if already verified)
    if (!sim) {
      sim = await Sim.findOne({
        telegramChatId: String(chatId),
      }).populate('companyId');

      logger.info('[Telegram] SIM lookup result (fallback - any chatId)', {
        chatId: String(chatId),
        simFound: !!sim,
        simId: sim?._id,
        simMobileNumber: sim?.mobileNumber,
        simTelegramChatId: sim?.telegramChatId,
        simTelegramPhoneVerified: sim?.telegramPhoneVerified,
      });

      // [FIX] If SIM is already verified, inform the user
      if (sim && sim.telegramPhoneVerified) {
        logger.info('[Telegram] SIM already verified, sending confirmation', {
          simId: sim._id,
          mobileNumber: sim.mobileNumber,
          telegramPhoneVerified: sim.telegramPhoneVerified,
        });

        await this.sendTelegramMessage(chatId,
          `✅ <b>Already Verified!</b>\n\n` +
          `📱 SIM: <b>${sim.mobileNumber}</b>\n` +
          `📱 Your Number: <b>${sim.telegramPhoneNumber || 'N/A'}</b>\n\n` +
          `This SIM is already linked and verified. You will continue to receive activity check messages.`
        );

        return {
          success: true,
          message: 'SIM already verified',
          simId: sim._id,
          mobileNumber: sim.mobileNumber,
          alreadyVerified: true,
        };
      }
    }

    // [FIX] If still no SIM found, check if ANY SIM has this chatId (for debugging)
    if (!sim) {
      const anySimWithChatId = await Sim.findOne({ telegramChatId: String(chatId) });
      logger.warn('[Telegram] No SIM found for chatId', {
        chatId: String(chatId),
        anySimWithChatIdExists: !!anySimWithChatId,
        anySimDetails: anySimWithChatId ? {
          id: anySimWithChatId._id,
          mobileNumber: anySimWithChatId.mobileNumber,
          telegramPhoneVerified: anySimWithChatId.telegramPhoneVerified,
          telegramChatId: anySimWithChatId.telegramChatId,
        } : null,
      });
    }

    const userName = from.username || `${from.first_name} ${from.last_name || ''}`.trim();

    logger.info(`[Telegram] Contact received from chat ${chatId}`, {
      phoneNumber,
      telegramUsername: userName,
      simMobileNumber: sim?.mobileNumber,
    });

    if (!sim) {
      await this.sendTelegramMessage(chatId,
        '❌ No SIM linked to this chat. Please use the link provided by your administrator.'
      );
      return { success: false, message: 'No SIM linked to this chat' };
    }

    // ============================================
    // VERIFY PHONE NUMBER MATCHES SIM
    // ============================================

    // Normalize both numbers for comparison
    const normalizedTelegramPhone = phoneNumber.replace(/\D/g, ''); // Remove all non-digits
    const normalizedSimPhone = sim.mobileNumber.replace(/\D/g, ''); // Remove all non-digits

    // Also try with country code variations
    // e.g., if SIM is "9876543210" and Telegram sends "+919876543210"
    // We need to handle both 10-digit and with country code formats

    const phonesMatch = this.comparePhoneNumbers(normalizedTelegramPhone, normalizedSimPhone);

    logger.info(`[Telegram] Phone verification for SIM ${sim.mobileNumber}`, {
      telegramPhone: phoneNumber,
      simPhone: sim.mobileNumber,
      normalizedTelegram: normalizedTelegramPhone,
      normalizedSim: normalizedSimPhone,
      phonesMatch: phonesMatch,
    });

    if (!phonesMatch) {
      // Phone numbers don't match - show error
      await this.sendTelegramMessage(chatId,
        `❌ <b>Phone Number Mismatch!</b>\n\n` +
        `The phone number you shared (<b>${phoneNumber}</b>) does not match the SIM number (<b>${sim.mobileNumber}</b>).\n\n` +
        `This Telegram account is not authorized to manage this SIM.\n\n` +
        `If you believe this is an error, please contact your administrator.`
      );

      // Create audit log for failed verification
      await auditLogService.logAction({
        action: 'TELEGRAM_PHONE_VERIFICATION_FAILED',
        module: 'TELEGRAM',
        description: `Phone verification failed for SIM ${sim.mobileNumber}. Shared: ${phoneNumber}, Expected: ${sim.mobileNumber}`,
        companyId: sim.companyId,
        entityId: sim._id,
        entityType: 'SIM',
        metadata: {
          simMobileNumber: sim.mobileNumber,
          sharedPhoneNumber: phoneNumber,
          chatId: String(chatId),
          telegramUsername: userName,
          telegramUserId: from.id,
        },
      });

      return {
        success: false,
        message: 'Phone number mismatch',
        simId: sim._id,
        mobileNumber: sim.mobileNumber,
        sharedPhoneNumber: phoneNumber,
      };
    }

    // ============================================
    // PHONE VERIFIED - COMPLETE LINKING
    // ============================================

    // Store the verified phone number and Telegram user info
    sim.telegramPhoneNumber = phoneNumber;
    sim.telegramPhoneVerified = true;
    sim.telegramEnabled = true; // Enable after successful verification
    sim.telegramLastActive = new Date();
    sim.telegramUsername = userName;
    sim.telegramUserId = from.id;
    sim.telegramFirstName = from.first_name;
    sim.telegramLastName = from.last_name || null;

    // Save with error handling
    try {
      const savedSim = await sim.save();
      if (!savedSim || !savedSim.telegramPhoneVerified) {
        logger.error('[Telegram] SIM save failed - telegramPhoneVerified not persisted', {
          simId: sim._id,
          mobileNumber: sim.mobileNumber,
          savedSim: savedSim ? 'exists' : 'null',
          telegramPhoneVerified: savedSim?.telegramPhoneVerified,
        });
        await this.sendTelegramMessage(chatId,
          '❌ <b>Verification Error!</b>\n\n' +
          'There was a problem saving your verification. Please contact your administrator.'
        );
        return { success: false, message: 'Failed to save verification status' };
      }
      logger.info('[Telegram] SIM saved successfully', {
        simId: savedSim._id,
        mobileNumber: savedSim.mobileNumber,
        telegramPhoneVerified: savedSim.telegramPhoneVerified,
        telegramEnabled: savedSim.telegramEnabled,
        telegramChatId: savedSim.telegramChatId,
      });
    } catch (saveError) {
      logger.error('[Telegram] SIM save error', {
        error: saveError.message,
        simId: sim._id,
        mobileNumber: sim.mobileNumber,
      });
      await this.sendTelegramMessage(chatId,
        '❌ <b>Verification Error!</b>\n\n' +
        'There was a problem saving your verification. Please contact your administrator.'
      );
      return { success: false, message: 'Failed to save verification status' };
    }

    // Create audit log for successful phone verification
    await auditLogService.logAction({
      action: 'TELEGRAM_PHONE_VERIFIED',
      module: 'TELEGRAM',
      description: `Phone number ${phoneNumber} verified and linked for SIM ${sim.mobileNumber} by ${userName}`,
      companyId: sim.companyId,
      entityId: sim._id,
      entityType: 'SIM',
      metadata: {
        simMobileNumber: sim.mobileNumber,
        verifiedPhoneNumber: phoneNumber,
        chatId: String(chatId),
        telegramUsername: userName,
        telegramUserId: from.id,
      },
    });

    // Send confirmation
    await this.sendTelegramMessage(chatId,
      `✅ <b>Verification Successful!</b>\n\n` +
      `📱 Your Number: <b>${phoneNumber}</b>\n` +
      `📋 Linked SIM: <b>${sim.mobileNumber}</b>\n` +
      `📡 Operator: ${sim.operator}\n\n` +
      `✨ Your Telegram is now linked to this SIM.\n\n` +
      `You will receive activity check messages for this SIM.\n` +
      `Reply to any message within 1 hour to mark the SIM as active.`
    );

    logger.info(`[Telegram] Phone verified and SIM linked`, {
      simId: sim._id,
      mobileNumber: sim.mobileNumber,
      phoneNumber: phoneNumber,
      chatId: chatId,
    });

    return {
      success: true,
      message: 'Phone number verified successfully',
      simId: sim._id,
      mobileNumber: sim.mobileNumber,
      verifiedPhoneNumber: phoneNumber,
    };
  }

  /**
   * Compare two phone numbers for equality
   * Handles various formats and country codes
   * @param {string} phone1 - First phone number (digits only)
   * @param {string} phone2 - Second phone number (digits only)
   * @returns {boolean} - True if numbers match
   */
  comparePhoneNumbers(phone1, phone2) {
    // Remove all non-digits
    let p1 = phone1.replace(/\D/g, '');
    let p2 = phone2.replace(/\D/g, '');

    // If both are empty, they don't match
    if (!p1 || !p2) return false;

    // Direct match
    if (p1 === p2) return true;

    // Handle country code: if one has country code and other doesn't
    // Common Indian format: +91XXXXXXXXXX (12 digits with country code)
    // or just XXXXXXXXXX (10 digits)

    // Remove leading 91 if both are Indian numbers
    if (p1.startsWith('91') && p1.length === 12) {
      p1 = p1.substring(2);
    }
    if (p2.startsWith('91') && p2.length === 12) {
      p2 = p2.substring(2);
    }

    // Try match again after removing country code
    if (p1 === p2) return true;

    // Last 10 digits match (most reliable for Indian numbers)
    if (p1.length >= 10 && p2.length >= 10) {
      const last10_1 = p1.slice(-10);
      const last10_2 = p2.slice(-10);
      if (last10_1 === last10_2) return true;
    }

    return false;
  }

  /**
   * Handle reply to previously sent message
   * @param {string} chatId - Telegram chat ID
   * @param {string} text - Reply text
   */
  async handleReply(chatId, text) {
    logger.info(`[Telegram handleReply] Processing reply from chat ${chatId}`);

    // Find the SIM linked to this chat
    // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
    const sim = await Sim.findOne({
      telegramChatId: String(chatId),
    });

    if (!sim) {
      logger.warn(`[Telegram handleReply] No SIM found for chat ${chatId}`);
      return { success: false, message: 'No SIM linked to this chat' };
    }

    logger.info(`[Telegram handleReply] Found SIM: ${sim.mobileNumber} (ID: ${sim._id})`);

    // Find the latest pending message for this SIM
    const latestMessage = await TelegramMessage.findOne({
      simId: sim._id,
      status: { $in: ['sent', 'delivered'] },
      isActive: null,
    }).sort({ sentAt: -1 });

    if (!latestMessage) {
      logger.warn(`[Telegram handleReply] No pending message found for SIM ${sim.mobileNumber}`, {
        simId: sim._id,
        chatId: chatId,
      });

      // Check if there are ANY messages for this SIM
      const anyMessage = await TelegramMessage.findOne({ simId: sim._id }).sort({ sentAt: -1 });
      if (anyMessage) {
        logger.info(`[Telegram handleReply] Latest message for SIM ${sim.mobileNumber}:`, {
          messageId: anyMessage._id,
          status: anyMessage.status,
          isActive: anyMessage.isActive,
          sentAt: anyMessage.sentAt,
        });
      } else {
        logger.warn(`[Telegram handleReply] No messages at all for SIM ${sim.mobileNumber}`);
      }

      return { success: false, message: 'No pending message found' };
    }

    // Calculate time since message was sent
    const timeSinceSent = Date.now() - new Date(latestMessage.sentAt).getTime();
    const oneHour = 60 * 60 * 1000;
    const isWithinOneHour = timeSinceSent <= oneHour;

    logger.info(`[Telegram handleReply] Found pending message for SIM ${sim.mobileNumber}`, {
      messageId: latestMessage._id,
      timeSinceSent: Math.round(timeSinceSent / 1000 / 60) + ' minutes',
      isWithinOneHour,
      updateSimStatus: latestMessage.updateSimStatus,
      currentIsActive: latestMessage.isActive,
      currentStatus: latestMessage.status,
    });

    // Update message record
    latestMessage.status = 'replied';
    latestMessage.repliedAt = new Date();
    latestMessage.replyMessage = text;
    latestMessage.isActive = isWithinOneHour;

    // Save and verify
    await latestMessage.save();

    logger.info(`[Telegram handleReply] Message updated successfully`, {
      messageId: latestMessage._id,
      newStatus: latestMessage.status,
      newIsActive: latestMessage.isActive,
      repliedAt: latestMessage.repliedAt,
    });

    // Update SIM's Telegram last active timestamp
    sim.telegramLastActive = new Date();

    // Update SIM status only if updateSimStatus flag is enabled
    if (latestMessage.updateSimStatus && isWithinOneHour && sim.status !== 'active') {
      const previousStatus = sim.status;
      sim.status = 'active';
      sim.lastActiveDate = new Date();

      await sim.save();

      // Create audit log for SIM activation
      // [AUDIT LOG FIX] - Added role: 'system' and performedBy: null for automated webhook events
      await auditLogService.logAction({
        action: 'TELEGRAM_SIM_ACTIVE',
        module: 'TELEGRAM',
        description: `SIM ${sim.mobileNumber} marked ACTIVE via Telegram reply (within 1 hour)`,
        performedBy: null,
        role: 'system',
        companyId: sim.companyId,
        entityId: sim._id,
        entityType: 'SIM',
        metadata: {
          simMobileNumber: sim.mobileNumber,
          chatId: String(chatId),
          replyMessage: text.substring(0, 200),
          previousStatus,
          messageId: latestMessage._id,
          responseTime: Math.round(timeSinceSent / 1000 / 60) + ' minutes',
        },
      });

      logger.info(`[Telegram handleReply] SIM ${sim.mobileNumber} marked ACTIVE (updateSimStatus enabled)`);
    } else {
      await sim.save();
    }

    if (isWithinOneHour) {
      // Send confirmation to user
      await this.sendTelegramMessage(chatId,
        `✅ <b>Thank you for your response!</b>\n\n` +
        `Your reply for SIM <b>${sim.mobileNumber}</b> has been recorded.`
      );

      logger.info(`[Telegram handleReply] Reply received for SIM ${sim.mobileNumber}`, {
        simId: sim._id,
        responseTime: Math.round(timeSinceSent / 1000 / 60) + ' minutes',
      });
    } else {
      // Reply too late
      await this.sendTelegramMessage(chatId,
        `⚠️ <b>Response Too Late</b>\n\n` +
        `Your reply was received more than 1 hour after the check message.\n` +
        `Your reply for SIM <b>${sim.mobileNumber}</b> has been recorded.\n\n` +
        `Please contact your administrator if you need assistance.`
      );

      logger.info(`[Telegram handleReply] Reply too late for SIM ${sim.mobileNumber}`, {
        timeSinceSent: Math.round(timeSinceSent / 1000 / 60) + ' minutes',
      });
    }

    return {
      success: true,
      message: 'Reply processed',
      isActive: isWithinOneHour,
      simId: sim._id,
    };
  }

  /**
   * Handle callback query (button clicks)
   * @param {Object} callbackQuery - Telegram callback query
   */
  async handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    logger.info(`[Telegram] Callback from chat ${chatId}:`, { data });

    // Handle button callbacks if needed
    // For now, just acknowledge
    return { success: true, message: 'Callback acknowledged' };
  }

  /**
   * Process messages that have not received reply within 1 hour
   * Called by cron job
   * Updates message status and SIM status if updateSimStatus flag is enabled
   */
  async processInactiveMessages() {
    logger.info('[Telegram Cron] Processing inactive messages...');

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Find messages that are sent/delivered but not replied within 1 hour
    const messagesToUpdate = await TelegramMessage.find({
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

      logger.info(`[Telegram Cron] Message ${message._id} marked inactive (no reply within 1 hour)`);

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
              action: 'TELEGRAM_SIM_INACTIVE',
              module: 'TELEGRAM',
              description: `SIM ${sim.mobileNumber} marked INACTIVE (no reply within 1 hour)`,
              performedBy: null,
              role: 'system',
              companyId: sim.companyId,
              entityId: sim._id,
              entityType: 'SIM',
              metadata: {
                simMobileNumber: sim.mobileNumber,
                messageId: message._id,
                messageSentAt: message.sentAt,
                chatId: message.chatId,
              },
            });

            logger.info(`[Telegram Cron] SIM ${sim.mobileNumber} marked INACTIVE (updateSimStatus enabled)`);
          }
        } catch (error) {
          logger.error(`[Telegram Cron] Error updating SIM ${message.simId}`, {
            error: error.message,
          });
        }
      }
    }

    logger.info(`[Telegram Cron] Processed ${updatedCount} messages, updated ${simUpdatedCount} SIMs`);

    return {
      processed: updatedCount,
      simsUpdated: simUpdatedCount,
    };
  }

  /**
   * Get messages for a company
   */
  async getMessages(query, user) {
    const { page = 1, limit = 20, status, simId, chatId, batchId, startDate, endDate } = query;
    const filter = { companyId: user.companyId };

    if (status) filter.status = status;
    if (simId) filter.simId = simId;
    if (chatId) filter.chatId = chatId;
    if (batchId) filter.batchId = batchId;

    if (startDate || endDate) {
      filter.sentAt = {};
      if (startDate) filter.sentAt.$gte = new Date(startDate);
      if (endDate) filter.sentAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const data = await TelegramMessage.find(filter)
      .populate('simId', 'mobileNumber operator status')
      .populate('createdBy', 'name email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ sentAt: -1 });

    const total = await TelegramMessage.countDocuments(filter);

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
    return await TelegramMessage.getStatsByCompany(user.companyId, startDate, endDate);
  }

  /**
   * Get SIMs eligible for Telegram messaging
   * Returns SIMs with telegramChatId linked AND phone verified
   */
  async getEligibleSIMs(user) {
    // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
    const filter = {
      companyId: user.companyId,
      telegramChatId: { $ne: null },
      telegramPhoneVerified: true, // Only return verified SIMs
    };

    const sims = await Sim.find(filter)
      .select('mobileNumber operator status telegramChatId telegramEnabled telegramPhoneVerified telegramLastActive assignedTo')
      .populate('assignedTo', 'name email')
      .sort({ mobileNumber: 1 });

    return sims;
  }

  /**
   * Generate deep link for SIM
   * @param {string} simId - SIM ID
   * @returns {string} - Deep link URL
   */
  generateDeepLink(simId) {
    const botUsername =  'SimTrack1bot';
    return `https://t.me/${botUsername}?start=SIM_${simId}`;
  }

  /**
   * Set webhook URL for the bot
   * @param {string} webhookUrl - Webhook URL
   */
  async setWebhook(webhookUrl) {
    if (!this.isConfigured) {
      throw new AppError('Telegram bot token not configured', 400);
    }

    try {
      const response = await axios.post(`${TELEGRAM_API_BASE}/setWebhook`, {
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
      });

      logger.info('[Telegram] Webhook set successfully', {
        url: webhookUrl,
        result: response.data,
      });

      return response.data;
    } catch (error) {
      logger.error('[Telegram] Failed to set webhook', {
        error: error.response?.data || error.message,
      });
      throw new AppError('Failed to set Telegram webhook', 500);
    }
  }

  /**
   * Get webhook info
   */
  async getWebhookInfo() {
    if (!this.isConfigured) {
      throw new AppError('Telegram bot token not configured', 400);
    }

    try {
      const response = await axios.get(`${TELEGRAM_API_BASE}/getWebhookInfo`);
      return response.data.result;
    } catch (error) {
      logger.error('[Telegram] Failed to get webhook info', {
        error: error.response?.data || error.message,
      });
      throw new AppError('Failed to get webhook info', 500);
    }
  }
}

module.exports = new TelegramService();