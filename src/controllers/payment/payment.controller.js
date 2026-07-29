const paymentService = require('../../services/payment/payment.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

class PaymentController {
  /**
   * Create a Razorpay order
   * POST /api/payments/create-order
   */
  async createOrder(req, res, next) {
    try {
      const { subscriptionId, billingCycle } = req.body;
      const companyId = req.user.companyId;
      const userId = req.user._id || req.user.id;

      console.log('createOrder controller - User:', req.user);
      console.log('createOrder controller - companyId:', companyId, 'userId:', userId);

      const result = await paymentService.createOrder(
        companyId,
        userId,
        subscriptionId,
        billingCycle
      );

      // Audit log: PAYMENT_INITIATE
      try {
        await auditLogService.logAction({
          action: 'PAYMENT_INITIATE',
          module: 'PAYMENT',
          description: `Payment order created for subscription ${subscriptionId}`,
          performedBy: userId,
          role: req.user.role,
          companyId: companyId,
          metadata: {
            orderId: result.order?.id || result.orderId,
            subscriptionId,
            billingCycle,
            amount: result.order?.amount || result.amount,
          },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log PAYMENT_INITIATE', { error: auditError.message });
      }

      return successResponse(res, result, 'Order created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create order for new registration (public, no auth)
   * POST /api/payments/public/create-order
   */
  async createOrderForRegistration(req, res, next) {
    try {
      const { subscriptionId, billingCycle, name, email, password, companyName, phone, address } = req.body;

      const result = await paymentService.createOrderForRegistration(
        subscriptionId,
        billingCycle,
        { name, email, password, companyName, phone, address }
      );

      // Audit log: PAYMENT_INITIATE (registration)
      try {
        await auditLogService.logAction({
          action: 'PAYMENT_INITIATE',
          module: 'PAYMENT',
          description: `Payment order created for new registration: ${companyName}`,
          role: 'anonymous',
          metadata: {
            orderId: result.order?.id || result.orderId,
            subscriptionId,
            billingCycle,
            email,
            companyName,
            amount: result.order?.amount || result.amount,
          },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log PAYMENT_INITIATE', { error: auditError.message });
      }

      return successResponse(res, result, 'Order created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Free trial registration (public, no auth, no payment)
   * POST /api/payments/public/free-trial-register
   */
  async freeTrialRegister(req, res, next) {
    try {
      const { subscriptionId, name, email, password, companyName, phone, address } = req.body;

      const result = await paymentService.freeTrialRegister({
        subscriptionId,
        name,
        email,
        password,
        companyName,
        phone,
        address,
      });

      // Audit log: REGISTRATION (free trial)
      try {
        await auditLogService.logAction({
          action: 'REGISTRATION',
          module: 'AUTH',
          description: `Free trial registration completed for ${companyName}`,
          role: 'anonymous',
          companyId: result.company?._id,
          metadata: {
            email,
            companyName,
            subscriptionId,
            planType: 'free_trial',
          },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log REGISTRATION', { error: auditError.message });
      }

      // Audit log: USER_REGISTER (free trial)
      try {
        await auditLogService.logAction({
          action: 'USER_REGISTER',
          module: 'AUTH',
          description: `User registered via free trial: ${email}`,
          performedBy: result.user?._id || null,
          role: result.user?.role || 'admin',
          companyId: result.company?._id,
          metadata: {
            email,
            companyName,
            planType: 'free_trial',
          },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log USER_REGISTER', { error: auditError.message });
      }

      return successResponse(res, result, 'Registration successful! Your 14-day free trial has started.', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify payment and complete registration (public, no auth)
   * POST /api/payments/public/verify-and-register
   */
  async verifyPaymentAndRegister(req, res, next) {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      } = req.body;

      const result = await paymentService.verifyPaymentAndRegister({
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      });

      // Audit log: PAYMENT_SUCCESS
      try {
        await auditLogService.logAction({
          action: 'PAYMENT_SUCCESS',
          module: 'PAYMENT',
          description: `Payment verified and registration completed for ${result.company?.name || 'new company'}`,
          role: 'anonymous',
          companyId: result.company?._id,
          metadata: {
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            amount: result.payment?.amount || result.subscription?.price,
          },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log PAYMENT_SUCCESS', { error: auditError.message });
      }

      // Audit log: USER_REGISTER (paid registration)
      try {
        await auditLogService.logAction({
          action: 'USER_REGISTER',
          module: 'AUTH',
          description: `Paid registration completed for ${result.company?.name || 'new company'}`,
          performedBy: result.user?._id || null,
          role: result.user?.role || 'admin',
          companyId: result.company?._id,
          metadata: {
            email: result.user?.email,
            companyName: result.company?.name,
            paymentMethod: 'razorpay',
          },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log USER_REGISTER', { error: auditError.message });
      }

      return successResponse(res, result, 'Registration completed successfully', 201);
    } catch (error) {
      // Audit log: PAYMENT_FAILED
      try {
        await auditLogService.logAction({
          action: 'PAYMENT_FAILED',
          module: 'PAYMENT',
          description: `Payment verification failed: ${error.message}`,
          role: 'anonymous',
          metadata: {
            orderId: req.body.razorpay_order_id,
            error: error.message,
          },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log PAYMENT_FAILED', { error: auditError.message });
      }

      next(error);
    }
  }

  /**
   * Verify payment and activate subscription
   * POST /api/payments/verify
   */
  async verifyPayment(req, res, next) {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      } = req.body;

      const result = await paymentService.verifyPayment({
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      });

      // Audit log: PAYMENT_SUCCESS
      try {
        await auditLogService.logAction({
          action: 'PAYMENT_SUCCESS',
          module: 'PAYMENT',
          description: `Payment verified for company subscription`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          metadata: {
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            amount: result.payment?.amount || result.subscription?.price,
          },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log PAYMENT_SUCCESS', { error: auditError.message });
      }

      // Audit log: COMPANY_SUBSCRIPTION_RENEW
      // [AUDIT LOG FIX] - Create subscription renewal log when admin renews via payment page
      try {
        const subscriptionType = result.subscription?.type || 'renewal';
        const descriptionMap = {
          renewal: `Subscription renewed for ${result.company?.name || 'company'} (${result.payment?.planName || 'unknown'} plan)`,
          upgrade: `Subscription upgraded for ${result.company?.name || 'company'} to ${result.payment?.planName || 'unknown'} plan`,
          downgrade: `Subscription downgraded for ${result.company?.name || 'company'} to ${result.payment?.planName || 'unknown'} plan`,
          trial_convert: `Trial converted to paid plan for ${result.company?.name || 'company'}`,
          new: `New subscription activated for ${result.company?.name || 'company'} (${result.payment?.planName || 'unknown'} plan)`,
        };
        await auditLogService.logAction({
          action: 'COMPANY_SUBSCRIPTION_RENEW',
          module: 'COMPANY',
          description: descriptionMap[subscriptionType] || `Subscription updated for ${result.company?.name || 'company'}`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: req.user.companyId,
          entityType: 'COMPANY',
          metadata: {
            subscriptionType,
            planName: result.payment?.planName,
            billingCycle: result.payment?.billingCycle,
            amount: result.payment?.amount,
            bonusDays: result.subscription?.bonusDays,
            remainingDays: result.subscription?.remainingDays,
          },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log COMPANY_SUBSCRIPTION_RENEW', { error: auditError.message });
      }

      return successResponse(res, result, 'Payment verified successfully');
    } catch (error) {
      // Audit log: PAYMENT_FAILED
      try {
        await auditLogService.logAction({
          action: 'PAYMENT_FAILED',
          module: 'PAYMENT',
          description: `Payment verification failed: ${error.message}`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          metadata: {
            orderId: req.body.razorpay_order_id,
            error: error.message,
          },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log PAYMENT_FAILED', { error: auditError.message });
      }

      next(error);
    }
  }

  /**
   * Get payment history for company
   * GET /api/payments/history
   */
  async getHistory(req, res, next) {
    try {
      const companyId = req.user.companyId;
      const { status, limit } = req.query;

      const payments = await paymentService.getPaymentHistory(companyId, {
        status,
        limit: limit ? parseInt(limit) : 50,
      });

      return successResponse(res, payments);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single payment details
   * GET /api/payments/:id
   */
  async getPayment(req, res, next) {
    try {
      const { id } = req.params;
      const companyId = req.user.companyId;

      const payment = await paymentService.getPaymentById(id, companyId);

      return successResponse(res, payment);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get revenue statistics (Super Admin)
   * GET /api/payments/stats
   */
  async getStats(req, res, next) {
    try {
      const stats = await paymentService.getRevenueStats();
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all payment history (Super Admin)
   * GET /api/payments/history/all
   */
  async getAllHistory(req, res, next) {
    try {
      const { companyId, status, planId, startDate, endDate, search, page = 1, limit = 20 } = req.query;

      const result = await paymentService.getAllPaymentHistory({
        companyId,
        status,
        planId,
        startDate,
        endDate,
        search,
        page: parseInt(page),
        limit: parseInt(limit),
      });

      return successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle Razorpay webhook
   * POST /api/payments/webhook
   */
  async handleWebhook(req, res, next) {
    try {
      const signature = req.headers['x-razorpay-signature'];
      const result = await paymentService.handleWebhook(req.body, signature);

      // Audit log: PAYMENT_SUCCESS or PAYMENT_FAILED (webhook)
      try {
        const webhookEvent = req.body.event || 'unknown';
        const isSuccess = webhookEvent.includes('captured') || webhookEvent.includes('paid');
        await auditLogService.logAction({
          action: isSuccess ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED',
          module: 'PAYMENT',
          description: `Webhook received: ${webhookEvent}`,
          role: 'system',
          companyId: result?.companyId,
          metadata: {
            event: webhookEvent,
            paymentId: req.body.payload?.payment?.entity?.id,
            orderId: req.body.payload?.order?.entity?.id,
          },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log PAYMENT webhook', { error: auditError.message });
      }

      return successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new PaymentController();