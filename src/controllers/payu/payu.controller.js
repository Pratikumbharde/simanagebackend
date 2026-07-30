/**
 * PayU Payment Controller
 *
 * HTTP handlers for PayU payment gateway integration:
 * - initiatePayment: Create pending recharge + return PayU form data
 * - successCallback: Handle PayU success redirect
 * - failureCallback: Handle PayU failure redirect
 * - cancelCallback: Handle PayU cancel redirect (user closed checkout)
 * - webhook: Handle PayU server-to-server notification
 * - getPaymentStatus: Check payment status by transaction ID
 * - getPaymentStatusByRecharge: Check payment status by recharge ID
 * - cleanupStale: Manual trigger for stale payment cleanup (admin)
 */

const payuService = require('../../services/payu/payu.service');
const { BadRequestError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const config = require('../../config');

class PayUController {
  /**
   * POST /api/payu/initiate-payment
   * Authenticated endpoint — creates pending recharge + payment, returns PayU form data.
   */
  async initiatePayment(req, res, next) {
    try {
      const { simId, amount, validity, plan, notes, planId } = req.body;
      const user = req.user;

      // Validate required fields
      if (!simId) {
        return res.status(400).json({ success: false, message: 'SIM ID is required' });
      }
      if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Valid amount is required (minimum ₹1)' });
      }

      // Check PayU credentials are configured
      if (!config.payu.key || config.payu.key === 'your_payu_merchant_key' || !config.payu.salt || config.payu.salt === 'your_payu_merchant_salt') {
        return res.status(503).json({
          success: false,
          message: 'PayU payment gateway is not configured. Please set PAYU_MERCHANT_KEY and PAYU_MERCHANT_SALT in server environment.',
        });
      }

      const paymentData = await payuService.createRechargePayment(user, {
        simId,
        amount: parseFloat(amount),
        validity: validity ? parseInt(validity) : undefined,
        plan,
        planId,
        notes,
      });

      return res.json({
        success: true,
        message: 'Payment initiated successfully',
        data: paymentData,
      });
    } catch (error) {
      logger.error('[PayU Controller] initiatePayment error:', error);
      next(error);
    }
  }

  /**
   * POST /api/payu/success
   * Public endpoint — PayU redirects here on successful payment.
   * Verifies hash, processes payment, then redirects user to frontend success page.
   */
  async successCallback(req, res, next) {
    try {
      const params = req.body;
      logger.info('[PayU Controller] Success callback received', { txnid: params.txnid });

      const result = await payuService.handleSuccessCallback(params);

      // Redirect to frontend success page with transaction details
      const redirectUrl = `${config.payu.frontendSuccessUrl}?txnid=${params.txnid}&status=success&rechargeId=${result.rechargeId || ''}`;

      // If this is an API call (JSON), return JSON; otherwise redirect
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.json({
          success: true,
          message: 'Payment completed successfully',
          data: result,
        });
      }

      // Browser redirect from PayU — send HTML with meta-refresh
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="refresh" content="0;url=${redirectUrl}">
        </head>
        <body>
          <p>Payment successful! Redirecting...</p>
          <p>If you are not redirected automatically, <a href="${redirectUrl}">click here</a>.</p>
        </body>
        </html>
      `);
    } catch (error) {
      logger.error('[PayU Controller] successCallback error:', error);

      const redirectUrl = `${config.payu.frontendFailureUrl}?txnid=${req.body?.txnid || ''}&status=error&error=${encodeURIComponent(error.message || 'Payment verification failed')}`;

      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          success: false,
          message: error.message || 'Payment verification failed',
        });
      }

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="refresh" content="0;url=${redirectUrl}">
        </head>
        <body>
          <p>Payment verification failed. Redirecting...</p>
          <p>If you are not redirected automatically, <a href="${redirectUrl}">click here</a>.</p>
        </body>
        </html>
      `);
    }
  }

  /**
   * POST /api/payu/failure
   * Public endpoint — PayU redirects here on failed payment.
   */
  async failureCallback(req, res, next) {
    try {
      const params = req.body;
      logger.info('[PayU Controller] Failure callback received', { txnid: params.txnid });

      const result = await payuService.handleFailureCallback(params);

      const redirectUrl = `${config.payu.frontendFailureUrl}?txnid=${params.txnid}&status=failure&error=${encodeURIComponent(params.error_Message || params.error || 'Payment failed')}`;

      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.json({
          success: false,
          message: 'Payment failed',
          data: result,
        });
      }

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="refresh" content="0;url=${redirectUrl}">
        </head>
        <body>
          <p>Payment failed. Redirecting...</p>
          <p>If you are not redirected automatically, <a href="${redirectUrl}">click here</a>.</p>
        </body>
        </html>
      `);
    } catch (error) {
      logger.error('[PayU Controller] failureCallback error:', error);

      const redirectUrl = `${config.payu.frontendFailureUrl}?txnid=${req.body?.txnid || ''}&status=error&error=${encodeURIComponent(error.message || 'Payment processing failed')}`;

      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          success: false,
          message: error.message || 'Payment processing failed',
        });
      }

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="refresh" content="0;url=${redirectUrl}">
        </head>
        <body>
          <p>Payment processing failed. Redirecting...</p>
          <p>If you are not redirected automatically, <a href="${redirectUrl}">click here</a>.</p>
        </body>
        </html>
      `);
    }
  }

  /**
   * POST /api/payu/cancel
   * Public endpoint — PayU redirects here when user cancels/closes the checkout.
   * Marks the payment as cancelled and the recharge as failed.
   */
  async cancelCallback(req, res, next) {
    try {
      const params = req.body;
      logger.info('[PayU Controller] Cancel callback received', { txnid: params.txnid });

      const result = await payuService.handleCancelCallback(params);

      const redirectUrl = `${config.payu.frontendFailureUrl}?txnid=${params.txnid || ''}&status=cancelled&error=${encodeURIComponent('Payment was cancelled')}`;

      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.json({
          success: false,
          message: 'Payment was cancelled',
          data: result,
        });
      }

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="refresh" content="0;url=${redirectUrl}">
        </head>
        <body>
          <p>Payment was cancelled. Redirecting...</p>
          <p>If you are not redirected automatically, <a href="${redirectUrl}">click here</a>.</p>
        </body>
        </html>
      `);
    } catch (error) {
      logger.error('[PayU Controller] cancelCallback error:', error);

      const redirectUrl = `${config.payu.frontendFailureUrl}?txnid=${req.body?.txnid || ''}&status=error&error=${encodeURIComponent(error.message || 'Payment was cancelled')}`;

      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          success: false,
          message: error.message || 'Payment cancellation processing failed',
        });
      }

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="refresh" content="0;url=${redirectUrl}">
        </head>
        <body>
          <p>Payment cancellation processing failed. Redirecting...</p>
          <p>If you are not redirected automatically, <a href="${redirectUrl}">click here</a>.</p>
        </body>
        </html>
      `);
    }
  }

  /**
   * POST /api/payu/webhook
   * Public endpoint — PayU server-to-server notification.
   * Must return 200 quickly to avoid PayU retries.
   */
  async webhook(req, res, next) {
    try {
      const webhookData = req.body;
      logger.info('[PayU Controller] Webhook received', {
        txnid: webhookData.txnid,
        status: webhookData.status,
        mihpayid: webhookData.mihpayid,
      });

      // Always return 200 immediately to prevent PayU retries
      res.status(200).json({ status: 'ok' });

      // Process asynchronously
      payuService.handleWebhook(webhookData).catch(error => {
        logger.error('[PayU Controller] Webhook processing error:', error);
      });
    } catch (error) {
      logger.error('[PayU Controller] Webhook error:', error);
      res.status(200).json({ status: 'ok' }); // Always return 200 for webhooks
    }
  }

  /**
   * GET /api/payu/status/:txnid
   * Authenticated endpoint — check payment status by transaction ID.
   */
  async getPaymentStatus(req, res, next) {
    try {
      const { txnid } = req.params;
      const result = await payuService.getPaymentStatus(txnid);

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('[PayU Controller] getPaymentStatus error:', error);
      next(error);
    }
  }

  /**
   * GET /api/payu/status/by-recharge/:rechargeId
   * Authenticated endpoint — check payment status by recharge ID.
   */
  async getPaymentStatusByRecharge(req, res, next) {
    try {
      const { rechargeId } = req.params;
      const result = await payuService.getPaymentStatusByRechargeId(rechargeId);

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('[PayU Controller] getPaymentStatusByRecharge error:', error);
      next(error);
    }
  }

  /**
   * POST /api/payu/cleanup-stale
   * Admin endpoint — manually trigger cleanup of stale pending payments.
   */
  async cleanupStale(req, res, next) {
    try {
      const { olderThanMinutes } = req.body;
      const result = await payuService.cleanupStalePayments(olderThanMinutes);

      return res.json({
        success: true,
        message: `Cleaned up ${result.cleaned} stale payments`,
        data: result,
      });
    } catch (error) {
      logger.error('[PayU Controller] cleanupStale error:', error);
      next(error);
    }
  }
}

module.exports = new PayUController();