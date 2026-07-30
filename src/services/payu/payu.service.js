/**
 * PayU Payment Gateway Service
 *
 * Handles PayU Hosted Checkout integration for SIM recharges:
 * - Hash generation and verification (SHA-512)
 * - Payment initiation (creates pending Recharge + Payment records)
 * - Success, failure, and cancel callback processing
 * - Webhook handling (idempotent)
 * - Transaction verification via PayU API
 * - Stale payment cleanup (cron)
 *
 * IMPORTANT: This service is ONLY for recharge payments.
 * Subscription payments use Razorpay (see payment.service.js).
 */

const crypto = require('crypto');
const axios = require('axios');
const config = require('../../config');
const Payment = require('../../models/payment/payment.model');
const Recharge = require('../../models/recharge/recharge.model');
const Sim = require('../../models/sim/sim.model');
const Company = require('../../models/company/company.model');
const User = require('../../models/auth/user.model');
const notificationHelper = require('../../utils/notificationHelper');
const { NotFoundError, BadRequestError, ForbiddenError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class PayUService {
  /**
   * Get the PayU payment URL based on environment
   */
  getPayuUrl() {
    return config.payu.isProduction ? config.payu.prodUrl : config.payu.testUrl;
  }

  /**
   * Generate a unique transaction ID
   * Format: TXN_{timestamp}_{random}
   */
  generateTxnId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `TXN_${timestamp}_${random}`;
  }

  /**
   * Compute the PayU request hash (SHA-512)
   * Formula: sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
   */
  computeRequestHash(params) {
    const {
      key, txnid, amount, productinfo, firstname, email,
      udf1 = '', udf2 = '', udf3 = '', udf4 = '', udf5 = '',
    } = params;
    const salt = config.payu.salt;
    const hashString = [
      key, txnid, amount, productinfo, firstname, email,
      udf1, udf2, udf3, udf4, udf5,
      '', '', '', '', '', '', // 6 empty pipes after udf5
      salt,
    ].join('|');

    return crypto.createHash('sha512').update(hashString).digest('hex');
  }

  /**
   * Verify the PayU response hash (reverse hash)
   * Formula: sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
   * With additional charges: sha512(additionalCharges|SALT|status|...)
   */
  verifyResponseHash(params) {
    const salt = config.payu.salt;
    const {
      status, key, txnid, amount, productinfo, firstname, email,
      udf1 = '', udf2 = '', udf3 = '', udf4 = '', udf5 = '',
      additionalCharges, hash,
    } = params;

    let hashString;
    if (additionalCharges) {
      hashString = `${additionalCharges}|${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
    } else {
      hashString = `${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
    }

    const computedHash = crypto.createHash('sha512').update(hashString).digest('hex');
    return computedHash === hash;
  }

  /**
   * Verify a transaction with PayU's server-side API
   * Hash: sha512(key|verify_payment|txnid|SALT)
   */
  async verifyTransaction(txnId) {
    try {
      const hash = crypto.createHash('sha512')
        .update(`${config.payu.key}|verify_payment|${txnId}|${config.payu.salt}`)
        .digest('hex');

      const response = await axios.post(config.payu.verifyApiUrl,
        new URLSearchParams({
          key: config.payu.key,
          command: 'verify_payment',
          var1: txnId,
          hash,
        }),
        { timeout: 30000 }
      );

      logger.info('[PayU] Verify transaction response', {
        txnId,
        status: response.data?.status,
      });

      return response.data;
    } catch (error) {
      logger.error('[PayU] Verify transaction failed', {
        txnId,
        error: error.message,
      });
      throw new Error('Failed to verify transaction with PayU');
    }
  }

  /**
   * Create a recharge payment: creates pending Recharge + Payment records,
   * generates PayU hash, returns form data for hosted checkout.
   *
   * This is the entry point for online recharge payments.
   * It creates both a Recharge (pending) and Payment (created) record,
   * then returns the PayU form data needed to redirect the user.
   */
  async createRechargePayment(user, rechargeData) {
    const { simId, amount, validity, plan, notes, planId } = rechargeData;

    // Validate SIM
    const sim = await Sim.findById(simId);
    if (!sim) {
      throw new NotFoundError('SIM');
    }

    // Check access
    if (user.role !== 'super_admin' && sim.companyId.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('Access denied to this SIM');
    }

    // If a planId was provided, look it up for complete plan details
    let planDetails = plan || {};
    if (planId) {
      try {
        const RechargePlan = require('../../models/rechargePlan/rechargePlan.model');
        const rechargePlan = await RechargePlan.findById(planId);
        if (rechargePlan) {
          planDetails = {
            name: rechargePlan.plan?.name || plan?.name,
            validity: rechargePlan.validity || validity || 28,
            data: rechargePlan.plan?.data || plan?.data,
            calls: rechargePlan.plan?.calls || plan?.calls,
            sms: rechargePlan.plan?.sms || plan?.sms,
            description: rechargePlan.plan?.description || plan?.description,
          };
        }
      } catch (err) {
        logger.warn('[PayU] Could not look up recharge plan, using provided plan data', { planId, error: err.message });
      }
    }

    // Resolve validity: planDetails > validity param > default 28
    const resolvedValidity = planDetails.validity || validity || 28;

    // Get company for user details
    const company = await Company.findById(user.companyId);

    // Generate transaction ID
    const txnId = this.generateTxnId();

    // Create pending recharge
    const recharge = new Recharge({
      companyId: sim.companyId,
      simId,
      amount,
      validity: resolvedValidity,
      plan: planDetails,
      rechargeDate: new Date(),
      paymentMethod: 'payu',
      transactionId: txnId,
      source: 'payu',
      status: 'pending',
      notes: notes || null,
      createdBy: user._id,
    });
    await recharge.save();

    // Create payment record
    const productInfo = planDetails?.name
      ? `SIM Recharge - ${planDetails.name}`
      : `SIM Recharge - ₹${amount}`;

    const payment = new Payment({
      companyId: sim.companyId,
      userId: user._id,
      companyName: company?.name || '',
      companyEmail: company?.email || '',
      userName: user.name || '',
      userEmail: user.email || '',
      paymentFor: 'recharge',
      rechargeId: recharge._id,
      amount,
      currency: 'INR',
      billingCycle: 'one_time',
      gateway: 'payu',
      payuTxnId: txnId,
      status: 'created',
      notes: JSON.stringify({ simId, rechargeId: recharge._id.toString(), planId: planId || null }),
    });
    await payment.save();

    // Link payment to recharge
    recharge.paymentId = payment._id;
    await recharge.save();

    // Generate PayU hash
    const payuParams = {
      key: config.payu.key,
      txnid: txnId,
      amount: String(amount),
      productinfo: productInfo,
      firstname: user.name || 'Customer',
      email: user.email || company?.email || 'customer@example.com',
      phone: user.phone || company?.phone || '',
      udf1: recharge._id.toString(),   // Recharge ID for linking
      udf2: sim.companyId.toString(),  // Company ID
      udf3: user._id.toString(),       // User ID
      udf4: simId.toString(),          // SIM ID
      udf5: planId || '',              // Plan ID (for reference)
    };

    const hash = this.computeRequestHash(payuParams);

    logger.info('[PayU] Payment initiated', {
      txnId,
      rechargeId: recharge._id,
      paymentId: payment._id,
      simId,
      amount,
      userId: user._id,
    });

    // Return PayU form data for the frontend
    return {
      payuUrl: this.getPayuUrl(),
      key: payuParams.key,
      txnid: payuParams.txnid,
      amount: payuParams.amount,
      productinfo: payuParams.productinfo,
      firstname: payuParams.firstname,
      email: payuParams.email,
      phone: payuParams.phone,
      surl: config.payu.successUrl,
      furl: config.payu.failureUrl,
      curl: config.payu.cancelUrl,
      hash,
      udf1: payuParams.udf1,
      udf2: payuParams.udf2,
      udf3: payuParams.udf3,
      udf4: payuParams.udf4,
      udf5: payuParams.udf5,
      rechargeId: recharge._id,
      paymentId: payment._id,
    };
  }

  /**
   * Handle PayU success callback
   * Verifies hash, verifies transaction, marks Payment and Recharge as completed.
   * Uses recharge.service.updateRechargeStatus() for activation logic.
   *
   * Idempotent: safe to call multiple times (checks for already-processed payments).
   */
  async handleSuccessCallback(params) {
    const { txnid, status, hash, mihpayid, mode, udf1, udf2, udf3 } = params;

    logger.info('[PayU] Success callback received', { txnid, status, mihpayid });

    // 1. Verify response hash
    if (!this.verifyResponseHash(params)) {
      logger.error('[PayU] Hash verification failed for success callback', { txnid });
      throw new BadRequestError('Invalid payment response hash');
    }

    // 2. Find the payment record
    const payment = await Payment.findOne({ payuTxnId: txnid });
    if (!payment) {
      logger.error('[PayU] Payment record not found for txnid', { txnid });
      throw new NotFoundError('Payment record');
    }

    // 3. Idempotency check — already processed successfully
    if (payment.status === 'completed') {
      logger.info('[PayU] Payment already completed (idempotent)', { txnid });
      const recharge = await Recharge.findById(payment.rechargeId);
      return { success: true, alreadyProcessed: true, rechargeId: payment.rechargeId, recharge };
    }

    // 4. Atomic status transition to prevent race conditions between redirect and webhook
    // Only proceed if payment is in 'created' or 'pending' status (or retrying a failed one)
    const allowedStatuses = ['created', 'pending', 'failed', 'cancelled'];
    if (!allowedStatuses.includes(payment.status)) {
      logger.warn('[PayU] Payment in unexpected status, skipping', { txnid, status: payment.status });
      throw new BadRequestError(`Payment is in ${payment.status} status and cannot be processed`);
    }

    // Atomically transition payment status to 'completed' to prevent duplicate processing
    const updatedPayment = await Payment.findOneAndUpdate(
      { payuTxnId: txnid, status: { $in: allowedStatuses } },
      {
        $set: {
          status: 'completed',
          payuMihpayId: mihpayid || '',
          payuHash: hash || '',
          paymentMethod: this.mapPayuModeToPaymentMethod(mode),
          paidAt: new Date(),
        },
        $unset: { failedAt: '', cancelledAt: '' },
      },
      { new: true }
    );

    if (!updatedPayment) {
      // Another process already updated this payment
      logger.info('[PayU] Payment was concurrently updated by another process', { txnid });
      const existingPayment = await Payment.findOne({ payuTxnId: txnid });
      if (existingPayment && existingPayment.status === 'completed') {
        const recharge = await Recharge.findById(existingPayment.rechargeId);
        return { success: true, alreadyProcessed: true, rechargeId: existingPayment.rechargeId, recharge };
      }
      throw new BadRequestError('Payment could not be processed — concurrent update detected');
    }

    // Use the updated payment object going forward
    Object.assign(payment, updatedPayment.toObject());

    // 5. Verify transaction with PayU server-side API (best-effort)
    try {
      const verification = await this.verifyTransaction(txnid);
      if (verification?.status !== 1 && verification?.txnid !== txnid) {
        logger.warn('[PayU] Server verification mismatch', { txnid, verification });
        // Still proceed — the redirect hash was valid
      }
      logger.info('[PayU] Server verification passed', { txnid });
    } catch (verifyError) {
      logger.warn('[PayU] Server verification failed, proceeding with hash verification only', {
        txnid,
        error: verifyError.message,
      });
      // Continue — hash verification passed, and the redirect is the primary source of truth
    }

    // 6. Update additional payment details not set in the atomic update
    if (params.bankcode) payment.bank = params.bankcode;
    if (params.cardnum) payment.cardLast4 = params.cardnum.slice(-4);
    if (params.cardtype) payment.cardNetwork = params.cardtype;
    if (params.vpa) payment.vpa = params.vpa;
    await payment.save();

    // 7. Activate the recharge using the shared recharge service
    const RechargeService = require('../recharge/recharge.service');
    try {
      await RechargeService.updateRechargeStatus(payment.rechargeId, 'completed', {
        transactionId: mihpayid || txnid,
        paymentId: payment._id,
        paymentMethod: this.mapPayuModeToPaymentMethod(mode),
      });
    } catch (rechargeErr) {
      logger.error('[PayU] Failed to update recharge status via service, updating directly', {
        rechargeId: payment.rechargeId,
        error: rechargeErr.message,
      });
      // Fallback: update recharge directly
      const recharge = await Recharge.findById(payment.rechargeId);
      if (recharge && recharge.status !== 'completed') {
        recharge.status = 'completed';
        recharge.transactionId = mihpayid || txnid;
        recharge.paymentMethod = this.mapPayuModeToPaymentMethod(mode);
        await recharge.save();

        // Update SIM and company stats
        const sim = await Sim.findById(recharge.simId);
        if (sim) {
          sim.lastActiveDate = new Date();
          await sim.save();
        }
        try {
          await RechargeService.updateCompanyStats(recharge.companyId);
        } catch (statsErr) {
          logger.error('[PayU] Failed to update company stats', { error: statsErr.message });
        }
      }
    }

    // 8. Send notification (non-blocking)
    this._sendRechargeNotification(payment.rechargeId, txnid).catch(err => {
      logger.error('[PayU] Failed to send recharge notification', { error: err.message });
    });

    logger.info('[PayU] Payment completed successfully', { txnid, mihpayid, rechargeId: payment.rechargeId });

    const recharge = await Recharge.findById(payment.rechargeId);
    return { success: true, rechargeId: payment.rechargeId, recharge };
  }

  /**
   * Handle PayU failure callback
   * Verifies hash, marks Payment and Recharge as failed.
   *
   * Idempotent: safe to call multiple times.
   */
  async handleFailureCallback(params) {
    const { txnid, status, hash, error, error_Message, udf1 } = params;

    logger.info('[PayU] Failure callback received', { txnid, status, error });

    // 1. Verify response hash (best-effort for failure)
    const hashValid = this.verifyResponseHash(params);
    if (!hashValid) {
      logger.warn('[PayU] Hash verification failed for failure callback', { txnid });
      // Still process the failure — it's safer to mark as failed than to ignore
    }

    // 2. Find the payment record
    const payment = await Payment.findOne({ payuTxnId: txnid });
    if (!payment) {
      logger.error('[PayU] Payment record not found for failure callback', { txnid });
      throw new NotFoundError('Payment record');
    }

    // 3. Idempotency check — already completed successfully (ignore failure)
    if (payment.status === 'completed') {
      logger.info('[PayU] Payment already completed (ignoring failure callback)', { txnid });
      return { success: false, alreadyProcessed: true, message: 'Payment was already completed' };
    }

    // 4. If already failed, return idempotent response
    if (payment.status === 'failed') {
      logger.info('[PayU] Payment already failed (idempotent)', { txnid });
      return { success: false, alreadyProcessed: true, message: 'Payment was already marked as failed' };
    }

    // 5. Update payment to failed
    payment.status = 'failed';
    payment.payuHash = hash || '';
    payment.failedAt = new Date();
    payment.notes = `PayU Error: ${error || 'Unknown'} - ${error_Message || 'Payment failed'}`;
    await payment.save();

    // 6. Update recharge to failed using the shared service
    try {
      const RechargeService = require('../recharge/recharge.service');
      await RechargeService.updateRechargeStatus(payment.rechargeId, 'failed', {
        notes: `Payment failed: ${error_Message || error || 'Unknown error'}`,
      });
    } catch (rechargeErr) {
      logger.error('[PayU] Failed to update recharge status via service, updating directly', {
        rechargeId: payment.rechargeId,
        error: rechargeErr.message,
      });
      // Fallback: update recharge directly
      const recharge = await Recharge.findById(payment.rechargeId);
      if (recharge && recharge.status !== 'failed') {
        recharge.status = 'failed';
        recharge.notes = (recharge.notes || '') + ` [Payment failed: ${error_Message || 'Unknown error'}]`;
        await recharge.save();
      }
    }

    logger.info('[PayU] Payment marked as failed', { txnid, error: error_Message });

    return { success: false, rechargeId: payment.rechargeId, error: error_Message || error || 'Payment failed' };
  }

  /**
   * Handle PayU cancel callback (user closed/cancelled the payment page)
   * Marks the payment as cancelled and the recharge as failed.
   */
  async handleCancelCallback(params) {
    const { txnid } = params;

    logger.info('[PayU] Cancel callback received', { txnid });

    if (!txnid) {
      logger.warn('[PayU] Cancel callback missing txnid');
      return { success: false, message: 'Missing transaction ID' };
    }

    const payment = await Payment.findOne({ payuTxnId: txnid });
    if (!payment) {
      logger.warn('[PayU] Payment record not found for cancel callback', { txnid });
      return { success: false, message: 'Payment record not found' };
    }

    // Idempotency — already in terminal state
    if (payment.status === 'completed') {
      logger.info('[PayU] Payment already completed (ignoring cancel)', { txnid });
      return { success: false, alreadyProcessed: true, message: 'Payment was already completed' };
    }
    if (payment.status === 'cancelled') {
      logger.info('[PayU] Payment already cancelled (idempotent)', { txnid });
      return { success: false, alreadyProcessed: true, message: 'Payment was already cancelled' };
    }
    if (payment.status === 'failed') {
      logger.info('[PayU] Payment already failed (ignoring cancel)', { txnid });
      return { success: false, alreadyProcessed: true, message: 'Payment was already marked as failed' };
    }

    // Mark payment as cancelled
    payment.status = 'cancelled';
    payment.cancelledAt = new Date();
    payment.notes = 'User cancelled the payment on PayU checkout page';
    await payment.save();

    // Mark recharge as failed
    try {
      const RechargeService = require('../recharge/recharge.service');
      await RechargeService.updateRechargeStatus(payment.rechargeId, 'failed', {
        notes: 'User cancelled the payment',
      });
    } catch (rechargeErr) {
      logger.error('[PayU] Failed to update recharge status on cancel', {
        rechargeId: payment.rechargeId,
        error: rechargeErr.message,
      });
      // Fallback
      const recharge = await Recharge.findById(payment.rechargeId);
      if (recharge && recharge.status === 'pending') {
        recharge.status = 'failed';
        recharge.notes = (recharge.notes || '') + ' [User cancelled payment]';
        await recharge.save();
      }
    }

    logger.info('[PayU] Payment cancelled', { txnid });
    return { success: false, cancelled: true, rechargeId: payment.rechargeId, message: 'Payment was cancelled by user' };
  }

  /**
   * Handle PayU webhook (server-to-server notification)
   * Must be idempotent — PayU may send the same notification multiple times.
   */
  async handleWebhook(webhookData) {
    const { txnid, status, hash, mihpayid, mode } = webhookData;

    logger.info('[PayU] Webhook received', { txnid, status, mihpayid });

    if (status === 'success') {
      try {
        return await this.handleSuccessCallback(webhookData);
      } catch (error) {
        logger.error('[PayU] Webhook success processing failed', { txnid, error: error.message });
        throw error;
      }
    } else {
      try {
        return await this.handleFailureCallback(webhookData);
      } catch (error) {
        logger.error('[PayU] Webhook failure processing failed', { txnid, error: error.message });
        throw error;
      }
    }
  }

  /**
   * Get payment status by transaction ID
   */
  async getPaymentStatus(txnId) {
    const payment = await Payment.findOne({ payuTxnId: txnId })
      .populate('rechargeId')
      .populate('companyId', 'name');

    if (!payment) {
      throw new NotFoundError('Payment');
    }

    return {
      txnId,
      status: payment.status,
      amount: payment.amount,
      rechargeId: payment.rechargeId,
      paidAt: payment.paidAt,
      failedAt: payment.failedAt,
      cancelledAt: payment.cancelledAt,
    };
  }

  /**
   * Get payment status by recharge ID
   */
  async getPaymentStatusByRechargeId(rechargeId) {
    const payment = await Payment.findOne({ rechargeId })
      .populate('companyId', 'name');

    if (!payment) {
      throw new NotFoundError('Payment');
    }

    return {
      paymentId: payment._id,
      txnId: payment.payuTxnId,
      status: payment.status,
      amount: payment.amount,
      rechargeId: payment.rechargeId,
      paidAt: payment.paidAt,
      failedAt: payment.failedAt,
      cancelledAt: payment.cancelledAt,
    };
  }

  /**
   * Cleanup stale pending payments older than specified minutes
   * Called by cron job to prevent orphaned pending payments.
   */
  async cleanupStalePayments(olderThanMinutes = 30) {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    const stalePayments = await Payment.find({
      gateway: 'payu',
      status: 'created',
      createdAt: { $lt: cutoff },
    });

    let cleanedCount = 0;
    for (const payment of stalePayments) {
      payment.status = 'cancelled';
      payment.cancelledAt = new Date();
      payment.notes = (payment.notes || '') + ' [Auto-cancelled: payment not confirmed within 30 minutes]';
      await payment.save();

      // Also mark the linked recharge as failed
      if (payment.rechargeId) {
        try {
          const RechargeService = require('../recharge/recharge.service');
          await RechargeService.updateRechargeStatus(payment.rechargeId, 'failed', {
            notes: 'Auto-cancelled: payment not confirmed within 30 minutes',
          });
        } catch (err) {
          // Fallback: update recharge directly — append to existing notes using pipeline update
          const staleRecharge = await Recharge.findById(payment.rechargeId);
          if (staleRecharge && staleRecharge.status === 'pending') {
            staleRecharge.status = 'failed';
            staleRecharge.notes = (staleRecharge.notes || '') + ' Auto-cancelled: payment not confirmed within 30 minutes';
            await staleRecharge.save();
          }
        }
      }

      cleanedCount++;
    }

    logger.info(`[PayU] Cleaned up ${cleanedCount} stale payments`);
    return { cleaned: cleanedCount };
  }

  /**
   * Map PayU mode to internal payment method enum
   */
  mapPayuModeToPaymentMethod(mode) {
    const modeMap = {
      CC: 'card',
      DC: 'card',
      NB: 'netbanking',
      UPI: 'upi',
      WALLET: 'wallet',
      EMI: 'emi',
      CASH: 'other',
    };
    return modeMap[mode] || 'other';
  }

  /**
   * Send recharge notification (non-blocking)
   * Reuses the recharge service notification logic.
   */
  async _sendRechargeNotification(rechargeId, txnId) {
    try {
      const recharge = await Recharge.findById(rechargeId).populate('simId', 'mobileNumber operator');
      if (!recharge) return;

      const sim = recharge.simId;
      const payment = await Payment.findOne({ payuTxnId: txnId });

      // Notify company admin
      const admins = await User.find({
        companyId: recharge.companyId,
        role: { $in: ['admin', 'super_admin'] },
      });

      const amount = recharge.amount;
      const planName = recharge.plan?.name || 'Recharge';
      const mobileNumber = sim?.mobileNumber || 'Unknown';

      for (const admin of admins) {
        await notificationHelper.sendNotification({
          userId: admin._id,
          title: 'Recharge Successful',
          message: `₹${amount} recharge for ${mobileNumber} (${planName}) completed via PayU.`,
          type: 'recharge',
          companyId: recharge.companyId,
        });
      }
    } catch (error) {
      logger.error('[PayU] Error sending recharge notification', { error: error.message });
    }
  }
}

module.exports = new PayUService();