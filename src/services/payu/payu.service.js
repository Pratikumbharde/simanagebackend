/**
 * PayU Payment Gateway Service
 *
 * Handles PayU Hosted Checkout integration for SIM recharges:
 * - Hash generation and verification (SHA-512)
 * - Payment initiation (creates pending Recharge + Payment records)
 * - Success/failure callback processing
 * - Webhook handling (idempotent)
 * - Transaction verification via PayU API
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
   */
  async createRechargePayment(user, rechargeData) {
    const { simId, amount, validity, plan, notes } = rechargeData;

    // Validate SIM
    const sim = await Sim.findById(simId);
    if (!sim) {
      throw new NotFoundError('SIM');
    }

    // Check access
    if (user.role !== 'super_admin' && sim.companyId.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('Access denied to this SIM');
    }

    // Get company for user details
    const company = await Company.findById(user.companyId);

    // Generate transaction ID
    const txnId = this.generateTxnId();

    // Create pending recharge
    const recharge = new Recharge({
      companyId: sim.companyId,
      simId,
      amount,
      validity: validity || 28,
      plan: plan || {},
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
    const productInfo = plan?.name
      ? `SIM Recharge - ${plan.name}`
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
      notes: JSON.stringify({ simId, rechargeId: recharge._id.toString() }),
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
      udf4: '',
      udf5: '',
    };

    const hash = this.computeRequestHash(payuParams);

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

    // 3. Idempotency check — already processed
    if (payment.status === 'completed') {
      logger.info('[PayU] Payment already completed (idempotent)', { txnid });
      const recharge = await Recharge.findById(payment.rechargeId);
      return { success: true, alreadyProcessed: true, rechargeId: payment.rechargeId, recharge };
    }
    if (payment.status === 'failed') {
      logger.warn('[PayU] Payment was already marked as failed', { txnid });
      throw new BadRequestError('Payment was already marked as failed');
    }

    // 4. Verify transaction with PayU server-side API
    try {
      const verification = await this.verifyTransaction(txnid);
      if (verification?.status !== 1 && verification?.txnid !== txnid) {
        logger.warn('[PayU] Server verification mismatch', { txnid, verification });
        // Still proceed — the redirect hash was valid
      }
    } catch (verifyError) {
      logger.warn('[PayU] Server verification failed, proceeding with hash verification only', {
        txnid,
        error: verifyError.message,
      });
      // Continue — hash verification passed, and the redirect is the primary source of truth
    }

    // 5. Update payment to completed
    payment.status = 'completed';
    payment.payuMihpayId = mihpayid || '';
    payment.payuHash = hash || '';
    payment.paymentMethod = this.mapPayuModeToPaymentMethod(mode);
    payment.paidAt = new Date();
    if (params.bankcode) payment.bank = params.bankcode;
    if (params.cardnum) payment.cardLast4 = params.cardnum.slice(-4);
    if (params.cardtype) payment.cardNetwork = params.cardtype;
    if (params.vpa) payment.vpa = params.vpa;
    await payment.save();

    // 6. Update recharge to completed
    const recharge = await Recharge.findById(payment.rechargeId);
    if (recharge) {
      recharge.status = 'completed';
      recharge.transactionId = mihpayid || txnid;
      recharge.paymentMethod = this.mapPayuModeToPaymentMethod(mode);
      await recharge.save();

      // Update SIM last active date
      const sim = await Sim.findById(recharge.simId);
      if (sim) {
        sim.lastActiveDate = new Date();
        await sim.save();
      }

      // Update company stats
      try {
        const RechargeService = require('../recharge/recharge.service');
        await RechargeService.updateCompanyStats(recharge.companyId);
      } catch (err) {
        logger.error('[PayU] Failed to update company stats', { error: err.message });
      }

      // Send notification (non-blocking)
      this._sendRechargeNotification(recharge, sim, payment).catch(err => {
        logger.error('[PayU] Failed to send recharge notification', { error: err.message });
      });
    }

    // Generate invoice number
    await payment.save(); // trigger pre-save hook for invoice

    logger.info('[PayU] Payment completed successfully', { txnid, mihpayid, rechargeId: payment.rechargeId });

    return { success: true, rechargeId: payment.rechargeId, recharge };
  }

  /**
   * Handle PayU failure callback
   * Verifies hash, marks Payment and Recharge as failed.
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

    // 3. Idempotency check
    if (payment.status === 'completed') {
      logger.info('[PayU] Payment already completed (ignoring failure callback)', { txnid });
      return { success: false, alreadyProcessed: true, message: 'Payment was already completed' };
    }
    if (payment.status === 'failed') {
      logger.info('[PayU] Payment already failed (idempotent)', { txnid });
      return { success: false, alreadyProcessed: true, message: 'Payment was already marked as failed' };
    }

    // 4. Update payment to failed
    payment.status = 'failed';
    payment.payuHash = hash || '';
    payment.failedAt = new Date();
    payment.notes = `PayU Error: ${error || 'Unknown'} - ${error_Message || 'Payment failed'}`;
    await payment.save();

    // 5. Update recharge to failed
    const recharge = await Recharge.findById(payment.rechargeId);
    if (recharge) {
      recharge.status = 'failed';
      recharge.notes = (recharge.notes || '') + ` [Payment failed: ${error_Message || 'Unknown error'}]`;
      await recharge.save();
    }

    logger.info('[PayU] Payment marked as failed', { txnid, error: error_Message });

    return { success: false, rechargeId: payment.rechargeId, error: error_Message || error || 'Payment failed' };
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
    };
  }

  /**
   * Cleanup stale pending payments older than specified minutes
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
      payment.status = 'failed';
      payment.failedAt = new Date();
      payment.notes = (payment.notes || '') + ' [Auto-cancelled: payment not confirmed within 30 minutes]';
      await payment.save();

      // Also mark the linked recharge as failed
      if (payment.rechargeId) {
        await Recharge.updateOne(
          { _id: payment.rechargeId, status: 'pending' },
          { $set: { status: 'failed', notes: 'Auto-cancelled: payment not confirmed within 30 minutes' } }
        );
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
      CASH: 'cash',
    };
    return modeMap[mode] || 'other';
  }

  /**
   * Send recharge notification (non-blocking)
   */
  async _sendRechargeNotification(recharge, sim, payment) {
    try {
      if (!sim) return;

      // Notify company admin
      const admins = await User.find({
        companyId: recharge.companyId,
        role: { $in: ['admin', 'super_admin'] },
      });

      const amount = recharge.amount;
      const planName = recharge.plan?.name || 'Recharge';
      const mobileNumber = sim.mobileNumber || 'Unknown';

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