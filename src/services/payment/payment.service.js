const Razorpay = require('razorpay');
const crypto = require('crypto');
const Payment = require('../../models/payment/payment.model');
const Company = require('../../models/company/company.model');
const User = require('../../models/auth/user.model');
const Subscription = require('../../models/subscription/subscription.model');
const SubscriptionHistory = require('../../models/subscription/subscriptionHistory.model');
const { AppError, NotFoundError, ConflictError } = require('../../utils/errors');
const config = require('../../config');
const jwt = require('jsonwebtoken');
const emailService = require('../../utils/emailService');
const notificationHelper = require('../../utils/notificationHelper');
const subscriptionService = require('../subscription/subscription.service');

// Initialize Razorpay
let razorpay = null;

const getRazorpayInstance = () => {
  if (!razorpay && config.razorpay?.keyId && config.razorpay?.keySecret) {
    razorpay = new Razorpay({
      key_id: config.razorpay.keyId,
      key_secret: config.razorpay.keySecret,
    });
  }
  return razorpay;
};

class PaymentService {
  /**
   * Create a Razorpay order for subscription purchase
   */
  async createOrder(companyId, userId, planId, billingCycle = 'monthly') {
    console.log('createOrder called with:', { companyId, userId, planId, billingCycle });

    // Get Razorpay instance
    const rzp = getRazorpayInstance();
    if (!rzp) {
      console.error('Razorpay instance is null. Config:', {
        hasKeyId: !!config.razorpay?.keyId,
        hasKeySecret: !!config.razorpay?.keySecret,
      });
      throw new AppError('Payment gateway not configured. Please contact support.', 500);
    }

    // Get plan details
    const plan = await Subscription.findById(planId);
    if (!plan) {
      console.error('Plan not found:', planId);
      throw new NotFoundError('Subscription plan');
    }
    console.log('Plan found:', plan.name, 'Price:', plan.price);

    // Get company details
    const company = await Company.findById(companyId);
    if (!company) {
      console.error('Company not found:', companyId);
      throw new NotFoundError('Company');
    }
    console.log('Company found:', company.name);

    // Calculate amount based on billing cycle
    const amount = billingCycle === 'yearly'
      ? plan.price.yearly * 100 // Convert to paise
      : plan.price.monthly * 100;

    const planDuration = billingCycle === 'yearly' ? 365 : 30;
    console.log('Creating order for amount:', amount, 'paise (', amount / 100, 'rupees)');

    // Create Razorpay order
    let order;
    try {
      // Receipt must be max 40 chars - use short format
      const shortCompanyId = companyId.toString().slice(-8);
      const timestamp = Date.now().toString().slice(-10);
      const receipt = `r_${shortCompanyId}_${timestamp}`; // ~25 chars

      const orderData = {
        amount,
        currency: 'INR',
        receipt,
        notes: {
          companyId: companyId.toString(),
          userId: userId.toString(),
          subscriptionId: planId.toString(),
          planName: plan.name,
          billingCycle,
        },
      };
      console.log('Calling Razorpay orders.create with:', orderData);

      order = await rzp.orders.create(orderData);
      console.log('Razorpay order created:', order);
    } catch (razorpayError) {
      console.error('Razorpay order creation failed:', JSON.stringify(razorpayError, null, 2));
      const errorMessage = razorpayError?.error?.description
        || razorpayError?.message
        || 'Failed to create payment order. Please try again.';
      throw new AppError(errorMessage, 500);
    }

    // Get user details for denormalization
    const payingUser = await User.findById(userId).select('name email');

    // Create payment record
    const payment = new Payment({
      companyId,
      userId,
      subscriptionId: planId,
      planName: plan.name,
      planDuration,
      amount: amount / 100, // Store in rupees
      currency: 'INR',
      billingCycle,
      razorpayOrderId: order.id,
      status: 'created',
      // Denormalized — preserves names even if company/user is deleted later
      companyName: company.name,
      companyEmail: company.email,
      userName: payingUser?.name || '',
      userEmail: payingUser?.email || '',
    });

    await payment.save();
    console.log('Payment record created:', payment._id);

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: config.razorpay?.keyId,
      companyName: company.name,
      planName: plan.name,
      planDuration,
      paymentId: payment._id,
    };
  }

  /**
   * Verify Razorpay payment and update subscription
   */
  async verifyPayment(paymentData) {
    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    } = paymentData;

    // Get Razorpay instance
    const rzp = getRazorpayInstance();
    if (!rzp) {
      throw new AppError('Payment gateway not configured', 500);
    }

    // Find payment record
    const payment = await Payment.findOne({ razorpayOrderId: orderId })
      .populate('companyId subscriptionId userId');

    if (!payment) {
      throw new NotFoundError('Payment record');
    }

    if (payment.status === 'completed') {
      throw new ConflictError('Payment already processed');
    }

    // Verify signature
    const crypto = require('crypto');
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', config.razorpay.keySecret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== signature) {
      await payment.markFailed('Invalid payment signature');
      throw new AppError('Invalid payment signature', 400);
    }

    // Fetch payment details from Razorpay
    let paymentDetails;
    try {
      paymentDetails = await rzp.payments.fetch(paymentId);
    } catch (error) {
      console.error('Error fetching payment details:', error);
      // Continue with basic payment data
    }

    // Update payment record
    payment.razorpayPaymentId = paymentId;
    payment.razorpaySignature = signature;
    payment.status = 'completed';
    payment.paidAt = new Date();

    if (paymentDetails) {
      payment.paymentMethod = paymentDetails.method;
      payment.bank = paymentDetails.bank;
      payment.wallet = paymentDetails.wallet;
      payment.vpa = paymentDetails.vpa;
      payment.cardId = paymentDetails.card_id;
      payment.cardLast4 = paymentDetails.card_last4;
      payment.cardNetwork = paymentDetails.card_network;
    }

    await payment.save();

    // Update company subscription
    const company = payment.companyId;
    const plan = payment.subscriptionId;
    const user = payment.userId;

    // Check for duplicate processing using payment ID
    const isAlreadyProcessed = await SubscriptionHistory.isPaymentProcessed(payment._id);
    if (isAlreadyProcessed) {
      throw new ConflictError('Payment already processed. Please refresh to see updated subscription.');
    }

    // Process subscription change using the new upgrade/renewal logic
    const result = await subscriptionService.processSubscriptionChange({
      company: company,
      newPlan: plan,
      billingCycle: payment.billingCycle,
      payment: payment,
      userId: user._id,
    });

    // Send notification to superadmins (non-blocking)
    if (user) {
      this.notifySuperadminsRenewal(company, user, payment, plan).catch(err => {
        console.error('Failed to send superadmin renewal notification:', err.message);
      });
    }

    // Send payment success notification to company admin (non-blocking)
    try {
      const companyAdmin = await User.findOne({ companyId: company._id, role: 'admin' });
      if (companyAdmin) {
        await notificationHelper.createWithNotification(
          {
            companyId: company._id,
            userId: companyAdmin._id,
            type: 'system',
            title: 'Payment Successful',
            message: `Your payment of ₹${payment.amount} for ${payment.planName} plan has been successfully processed. Subscription valid until ${new Date(company.subscriptionEndDate).toDateString()}.`,
            priority: 'medium',
            metadata: {
              companyName: company.name,
              amount: payment.amount,
              planName: payment.planName,
              expiryDate: company.subscriptionEndDate,
              bonusDays: result.bonusDays || 0,
            },
          },
          {
            to: companyAdmin.email,
            subject: `Payment Successful - ${payment.planName} Plan`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #16a34a, #15803d); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                  <h1 style="margin: 0;">Payment Successful!</h1>
                </div>
                <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                  <h2>Hello ${companyAdmin.name},</h2>
                  <p>Your payment has been successfully processed.</p>
                  <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; margin: 15px 0;">
                    <p style="margin: 0;"><strong>Plan:</strong> ${payment.planName}</p>
                    <p style="margin: 10px 0 0 0;"><strong>Amount:</strong> ₹${payment.amount}</p>
                    <p style="margin: 10px 0 0 0;"><strong>Billing Cycle:</strong> ${payment.billingCycle}</p>
                    <p style="margin: 10px 0 0 0;"><strong>Valid Until:</strong> ${new Date(company.subscriptionEndDate).toDateString()}</p>
                    ${result.bonusDays > 0 ? `<p style="margin: 10px 0 0 0;"><strong>Bonus Days:</strong> ${result.bonusDays} days added</p>` : ''}
                  </div>
                  <p style="color: #16a34a; font-weight: 500;">${result.message}</p>
                  <p>Thank you for your subscription!</p>
                  <p>Best regards,<br>SIM Management Team</p>
                </div>
              </div>
            `,
          }
        );
      }
    } catch (notificationError) {
      console.error('Failed to send payment success notification:', notificationError.message);
    }

    // Generate invoice number
    await payment.save(); // Trigger invoice number generation

    return {
      success: true,
      payment: {
        id: payment._id,
        invoiceNumber: payment.invoiceNumber,
        amount: payment.amount,
        status: payment.status,
        paidAt: payment.paidAt,
        planName: payment.planName,
        billingCycle: payment.billingCycle,
        planDuration: payment.planDuration,
      },
      company: {
        id: company._id,
        name: company.name,
        subscriptionEnds: company.subscriptionEndDate,
      },
      subscription: {
        type: result.type,
        message: result.message,
        bonusDays: result.bonusDays || 0,
        remainingDays: result.remainingDays || 0,
      },
    };
  }

  /**
   * Get payment history for a company
   */
  async getPaymentHistory(companyId, options = {}) {
    return Payment.findByCompany(companyId, options);
  }

  /**
   * Get a single payment by ID
   */
  async getPaymentById(paymentId, companyId) {
    const payment = await Payment.findOne({ _id: paymentId, companyId })
      .populate('subscriptionId', 'name description price')
      .populate('userId', 'name email');

    if (!payment) {
      throw new NotFoundError('Payment');
    }

    // Fallback for deleted user reference
    const p = payment.toObject ? payment.toObject() : payment;
    if (!p.userId) {
      p.userId = {
        _id: null,
        name: p.userName || 'Deleted User',
        email: p.userEmail || '',
      };
    }

    return p;
  }

  /**
   * Get revenue statistics (Super Admin only)
   */
  async getRevenueStats() {
    const totalRevenue = await Payment.getTotalRevenue();
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    const monthlyRevenue = await Payment.getMonthlyRevenue(currentYear, currentMonth);

    // Get last 6 months revenue
    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const month = date.getMonth() + 1;
      const year = date.getFullYear();
      const result = await Payment.getMonthlyRevenue(year, month);
      monthlyTrend.push({
        month: date.toLocaleString('default', { month: 'short' }),
        year,
        revenue: result.total,
        count: result.count,
      });
    }

    return {
      totalRevenue: totalRevenue.total,
      totalPayments: totalRevenue.count,
      currentMonthRevenue: monthlyRevenue.total,
      currentMonthPayments: monthlyRevenue.count,
      monthlyTrend,
    };
  }

  /**
   * Get all payment history (Super Admin only)
   */
  async getAllPaymentHistory(options = {}) {
    const { companyId, status, planId, startDate, endDate, search, page = 1, limit = 20 } = options;

    // Build filter
    const filter = {};
    if (companyId) {
      filter.companyId = companyId;
    }
    if (status) {
      filter.status = status;
    }
    if (planId) {
      filter.subscriptionId = planId;
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        filter.createdAt.$lte = new Date(endDate);
      }
    }
    // Search across company name, user name, plan name, and invoice number
    if (search && search.trim()) {
      const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Find matching company IDs
      const matchingCompanies = await Company.find({
        name: { $regex: escapedSearch, $options: 'i' }
      }).select('_id').lean();
      const companyIds = matchingCompanies.map(c => c._id);

      // Find matching user IDs
      const matchingUsers = await User.find({
        name: { $regex: escapedSearch, $options: 'i' }
      }).select('_id').lean();
      const userIds = matchingUsers.map(u => u._id);

      // Build $or conditions for direct Payment fields + matched IDs
      const orConditions = [
        { planName: { $regex: escapedSearch, $options: 'i' } },
        { invoiceNumber: { $regex: escapedSearch, $options: 'i' } },
        { companyName: { $regex: escapedSearch, $options: 'i' } },
        { userName: { $regex: escapedSearch, $options: 'i' } },
      ];
      if (companyIds.length > 0) {
        orConditions.push({ companyId: { $in: companyIds } });
      }
      if (userIds.length > 0) {
        orConditions.push({ userId: { $in: userIds } });
      }

      filter.$or = orConditions;
    }

    // Calculate skip
    const skip = (page - 1) * limit;

    // Get total count
    const total = await Payment.countDocuments(filter);

    // Get payments with pagination
    const payments = await Payment.find(filter)
      .populate('companyId', 'name email phone')
      .populate('userId', 'name email')
      .populate('subscriptionId', 'name price')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Build response with fallback for deleted company/user references
    const paymentsWithFallback = payments.map(payment => {
      const p = payment.toObject ? payment.toObject() : payment;
      return {
        ...p,
        // Use populated data if available, otherwise fall back to denormalized fields
        companyId: p.companyId || {
          _id: null,
          name: p.companyName || 'Deleted Company',
          email: p.companyEmail || '',
          phone: '',
        },
        userId: p.userId || {
          _id: null,
          name: p.userName || 'Deleted User',
          email: p.userEmail || '',
        },
      };
    });

    return {
      payments: paymentsWithFallback,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Handle webhook events from Razorpay
   */
  async handleWebhook(webhookBody, signature) {
    const crypto = require('crypto');

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', config.razorpay.webhookSecret)
      .update(JSON.stringify(webhookBody))
      .digest('hex');

    if (expectedSignature !== signature) {
      throw new AppError('Invalid webhook signature', 400);
    }

    const event = webhookBody.event;
    const payload = webhookBody.payload.payment?.entity;

    switch (event) {
      case 'payment.captured':
        await this.handlePaymentCaptured(payload);
        break;

      case 'payment.failed':
        await this.handlePaymentFailed(payload);
        break;

      case 'order.paid':
        // Order paid event - payment captured
        break;

      default:
        console.log(`Unhandled webhook event: ${event}`);
    }

    return { received: true };
  }

  async handlePaymentCaptured(paymentData) {
    // Find payment by order ID
    const payment = await Payment.findOne({
      razorpayOrderId: paymentData.order_id,
    }).populate('companyId subscriptionId userId');

    if (payment && payment.status !== 'completed') {
      // Check for duplicate processing
      const isAlreadyProcessed = await SubscriptionHistory.isPaymentProcessed(payment._id);
      if (isAlreadyProcessed) {
        console.log('Payment already processed via webhook:', payment._id);
        return;
      }

      // Update payment status
      payment.razorpayPaymentId = paymentData.id;
      payment.paymentMethod = paymentData.method;
      payment.bank = paymentData.bank;
      payment.wallet = paymentData.wallet;
      payment.vpa = paymentData.vpa;
      payment.status = 'completed';
      payment.paidAt = new Date();
      await payment.save();

      // Process subscription change using new logic
      if (payment.companyId) {
        const company = payment.companyId;
        const plan = payment.subscriptionId;
        const user = payment.userId;

        try {
          await subscriptionService.processSubscriptionChange({
            company: company,
            newPlan: plan,
            billingCycle: payment.billingCycle,
            payment: payment,
            userId: user?._id,
          });
        } catch (err) {
          console.error('Error processing subscription change:', err.message);
        }
      }
    }
  }

  async handlePaymentFailed(paymentData) {
    const payment = await Payment.findOne({
      razorpayOrderId: paymentData.order_id,
    });

    if (payment) {
      await payment.markFailed(paymentData.error_description || 'Payment failed');
    }
  }

  /**
   * Create order for new registration (no auth required)
   */
  async createOrderForRegistration(planId, billingCycle, userData) {
    const rzp = getRazorpayInstance();
    if (!rzp) {
      throw new AppError('Payment gateway not configured', 500);
    }

    // Get plan details
    const plan = await Subscription.findById(planId);
    if (!plan || !plan.isActive) {
      throw new NotFoundError('Subscription plan');
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: userData.email.toLowerCase() });
    if (existingUser) {
      throw new ConflictError('This email is already registered. Please login instead.');
    }

    // Check if company name already exists (case-insensitive, regex-safe)
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingCompany = await Company.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(userData.companyName.trim())}$`, 'i') }
    });
    if (existingCompany) {
      throw new ConflictError('A company with this name already exists. Please choose a different name.');
    }

    // Calculate amount
    const amount = billingCycle === 'yearly'
      ? plan.price.yearly * 100
      : plan.price.monthly * 100;

    const planDuration = billingCycle === 'yearly' ? 365 : 30;

    // Create Razorpay order
    const order = await rzp.orders.create({
      amount,
      currency: 'INR',
      receipt: `reg_${Date.now()}`,
      notes: {
        type: 'registration',
        email: userData.email,
        name: userData.name,
        companyName: userData.companyName,
        phone: userData.phone || '',
        subscriptionId: planId.toString(),
        planName: plan.name,
        billingCycle,
      },
    });

    // Create pending payment record (no company yet)
    const payment = new Payment({
      companyId: null, // Will be updated after registration
      userId: null,    // Will be updated after registration
      subscriptionId: planId,
      planName: plan.name,
      planDuration,
      amount: amount / 100,
      currency: 'INR',
      billingCycle,
      razorpayOrderId: order.id,
      status: 'created',
      // Denormalized — store intended company/user names from registration
      companyName: userData.companyName || '',
      companyEmail: userData.email || '',
      userName: userData.name || '',
      userEmail: userData.email || '',
      notes: JSON.stringify({
        type: 'registration',
        userData: {
          email: userData.email,
          name: userData.name,
          companyName: userData.companyName,
          phone: userData.phone,
          password: userData.password, // Will be used to create user
          address: userData.address || {},
        },
      }),
    });

    await payment.save();

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: config.razorpay?.keyId,
      planName: plan.name,
      planDuration,
      paymentId: payment._id,
    };
  }

  /**
   * Verify payment and complete registration
   */
  async verifyPaymentAndRegister(paymentData) {
    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    } = paymentData;

    const rzp = getRazorpayInstance();
    if (!rzp) {
      throw new AppError('Payment gateway not configured', 500);
    }

    // Find payment record
    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    if (!payment) {
      throw new NotFoundError('Payment record');
    }

    if (payment.status === 'completed') {
      throw new ConflictError('Payment already processed');
    }

    // Verify signature
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', config.razorpay.keySecret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== signature) {
      await payment.markFailed('Invalid payment signature');
      throw new AppError('Invalid payment signature', 400);
    }

    // Parse stored user data
    let notesData;
    try {
      notesData = JSON.parse(payment.notes);
    } catch (e) {
      throw new AppError('Invalid payment data', 500);
    }

    const { userData } = notesData;
    const plan = await Subscription.findById(payment.subscriptionId);

    // Check if company name already exists (case-insensitive)
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingNameCompany = await Company.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(userData.companyName.trim())}$`, 'i') }
    });
    if (existingNameCompany) {
      throw new ConflictError('A company with this name already exists. Please choose a different name.');
    }

    // Calculate subscription dates
    const subscriptionStartDate = new Date();
    const subscriptionEndDate = new Date();
    subscriptionEndDate.setDate(subscriptionEndDate.getDate() + payment.planDuration);

    // Create company
    const company = new Company({
      name: userData.companyName,
      email: userData.email.toLowerCase(),
      phone: userData.phone || null,
      address: userData.address || {},
      subscriptionId: plan._id,
      subscriptionStartDate,
      subscriptionEndDate,
      billingCycle: payment.billingCycle, // Store billing cycle
      isActive: true,
    });

    try {
      await company.save();
    } catch (saveError) {
      if (saveError.code === 11000) {
        throw new ConflictError('Company already exists');
      }
      throw saveError;
    }

    // Create admin user
    const user = new User({
      email: userData.email.toLowerCase(),
      password: userData.password,
      name: userData.name,
      phone: userData.phone,
      role: 'admin',
      companyId: company._id,
      emailVerified: true,
      isActive: true,
    });

    try {
      await user.save();
    } catch (saveError) {
      // Rollback company
      await Company.findByIdAndDelete(company._id);
      if (saveError.code === 11000) {
        throw new ConflictError('Email already registered');
      }
      throw saveError;
    }

    // Save company (createdBy remains null for self-registered companies)
    // This ensures the frontend shows "Self" type instead of "Admin"
    await company.save();

    // Update payment record
    payment.companyId = company._id;
    payment.userId = user._id;
    payment.razorpayPaymentId = paymentId;
    payment.razorpaySignature = signature;
    payment.status = 'completed';
    // Denormalized — preserves names even if company/user is deleted later
    payment.companyName = company.name;
    payment.companyEmail = company.email;
    payment.userName = user.name;
    payment.userEmail = user.email;
    payment.paidAt = new Date();
    payment.notes = 'Registration completed'; // Clear sensitive data
    await payment.save();

    // Create subscription history record for new registration
    await SubscriptionHistory.create({
      companyId: company._id,
      userId: user._id,
      oldPlanId: null,
      newPlanId: plan._id,
      oldPlanName: null,
      newPlanName: plan.name,
      startDate: subscriptionStartDate,
      endDate: subscriptionEndDate,
      bonusDays: 0,
      remainingDays: 0,
      paymentId: payment._id,
      type: 'new',
      billingCycle: payment.billingCycle,
      amount: payment.amount,
      notes: 'New subscription via paid registration',
    });

    // Generate tokens for auto-login
    const accessToken = jwt.sign(
      { id: user._id, role: user.role, companyId: user.companyId },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      config.jwt.secret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );

    // Save refresh token
    user.refreshToken = refreshToken;
    await user.save();

    // Send notification to superadmins (non-blocking)
    this.notifySuperadmins(company, user, payment, plan).catch(err => {
      console.error('Failed to send superadmin notification:', err.message);
    });

    // Send welcome notification to the new user (non-blocking)
    try {
      await notificationHelper.createWithNotification(
        {
          companyId: company._id,
          userId: user._id,
          type: 'system',
          title: 'Welcome to SIM Management!',
          message: `Your account has been created successfully. Your ${payment.planName} plan subscription is valid until ${new Date(company.subscriptionEndDate).toDateString()}.`,
          priority: 'medium',
          metadata: {
            companyName: company.name,
            planName: payment.planName,
            expiryDate: company.subscriptionEndDate,
          },
        },
        {
          to: user.email,
          subject: `Welcome to SIM Management - ${company.name}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0;">Welcome to SIM Management!</h1>
              </div>
              <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <h2>Hello ${user.name},</h2>
                <p>Your company <strong>${company.name}</strong> has been successfully registered!</p>
                <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; margin: 15px 0;">
                  <p style="margin: 0;"><strong>Plan:</strong> ${payment.planName}</p>
                  <p style="margin: 10px 0 0 0;"><strong>Amount:</strong> ₹${payment.amount}</p>
                  <p style="margin: 10px 0 0 0;"><strong>Subscription Valid Until:</strong> ${new Date(company.subscriptionEndDate).toDateString()}</p>
                </div>
                <p>You can now log in with your email: <strong>${user.email}</strong></p>
                <p>Best regards,<br>SIM Management Team</p>
              </div>
            </div>
          `,
        }
      );
    } catch (notificationError) {
      console.error('Failed to send welcome notification:', notificationError.message);
    }

    // Return user without sensitive data
    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;
    delete userObj.__v;

    return {
      success: true,
      user: userObj,
      accessToken,
      refreshToken,
      company: {
        id: company._id,
        name: company.name,
        subscriptionEnds: company.subscriptionEndDate,
      },
      payment: {
        id: payment._id,
        amount: payment.amount,
        planName: payment.planName,
        billingCycle: payment.billingCycle,
      },
    };
  }

  /**
   * Send notification to all superadmins about new registration
   */
  async notifySuperadmins(company, user, payment, plan) {
    try {
      // Get all active superadmins
      const superadmins = await User.find({
        role: 'super_admin',
        isActive: true,
      }).select('name email');

      if (!superadmins || superadmins.length === 0) {
        console.log('No active superadmins found to notify');
        return;
      }

      // Send email to each superadmin
      const emailPromises = superadmins.map(superadmin =>
        emailService.sendNewRegistrationEmail(superadmin, {
          company: {
            name: company.name,
            email: company.email,
            phone: company.phone,
            subscriptionEnds: company.subscriptionEndDate,
          },
          user: {
            name: user.name,
            email: user.email,
            phone: user.phone,
          },
          payment: {
            amount: payment.amount,
            billingCycle: payment.billingCycle,
            razorpayPaymentId: payment.razorpayPaymentId,
            id: payment._id,
          },
          plan: {
            name: plan.name,
          },
        })
      );

      await Promise.allSettled(emailPromises);
      console.log(`Registration notification sent to ${superadmins.length} superadmin(s)`);
    } catch (error) {
      console.error('Error sending superadmin notifications:', error.message);
    }
  }

  /**
   * Send notification to all superadmins about subscription renewal
   */
  async notifySuperadminsRenewal(company, user, payment, plan) {
    try {
      // Get all active superadmins
      const superadmins = await User.find({
        role: 'super_admin',
        isActive: true,
      }).select('name email');

      if (!superadmins || superadmins.length === 0) {
        console.log('No active superadmins found to notify about renewal');
        return;
      }

      // Send email to each superadmin
      const emailPromises = superadmins.map(superadmin =>
        emailService.sendRenewalNotificationEmail(superadmin, {
          company: {
            name: company.name,
            email: company.email,
            phone: company.phone,
            subscriptionEnds: company.subscriptionEndDate,
          },
          user: {
            name: user.name,
            email: user.email,
            phone: user.phone,
          },
          payment: {
            amount: payment.amount,
            billingCycle: payment.billingCycle,
            razorpayPaymentId: payment.razorpayPaymentId,
            id: payment._id,
          },
          plan: {
            name: plan.name,
          },
        })
      );

      await Promise.allSettled(emailPromises);
      console.log(`Renewal notification sent to ${superadmins.length} superadmin(s)`);
    } catch (error) {
      console.error('Error sending superadmin renewal notifications:', error.message);
    }
  }

  /**
   * Free trial registration (no payment required)
   * Creates company and admin user with free trial plan
   */
  async freeTrialRegister({ subscriptionId, name, email, password, companyName, phone, address }) {
    // Validate plan
    const plan = await Subscription.findById(subscriptionId);
    if (!plan) {
      throw new NotFoundError('Subscription plan');
    }

    // Verify it's a free trial plan
    if (plan.planType !== 'free_trial') {
      throw new AppError('This endpoint is only for free trial plans', 400);
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      throw new ConflictError('This email is already registered in the system.');
    }

    // Check if company with same name exists (case-insensitive, regex-safe)
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingCompany = await Company.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(companyName.trim())}$`, 'i') }
    });
    if (existingCompany) {
      throw new ConflictError('A company with this name already exists.');
    }

    // Check if company email exists
    const existingCompanyEmail = await Company.findOne({ email: email.toLowerCase() });
    if (existingCompanyEmail) {
      throw new ConflictError('This email is already used by another company.');
    }

    // Calculate subscription dates for 14-day trial
    const subscriptionStartDate = new Date();
    const subscriptionEndDate = new Date();
    subscriptionEndDate.setDate(subscriptionEndDate.getDate() + 14); // 14 days trial

    // Create company with trial
    const company = new Company({
      name: companyName,
      email: email.toLowerCase(),
      phone: phone || '',
      address: address || {},
      subscriptionId,
      subscriptionStartDate,
      subscriptionEndDate,
      billingCycle: 'monthly',
      isTrial: true,
      trialEndsAt: subscriptionEndDate,
      hasConverted: false,
      isActive: true,
    });

    await company.save();

    // Create admin user
    const user = new User({
      email: email.toLowerCase(),
      password,
      name,
      phone: phone || '',
      role: 'admin',
      companyId: company._id,
      isActive: true,
      emailVerified: true,
    });

    await user.save();

    // Generate tokens
    const accessToken = jwt.sign(
      { id: user._id, role: user.role, companyId: company._id },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      config.jwt.secret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );

    user.refreshToken = refreshToken;
    await user.save();

    // Create a payment record (for tracking, but with zero amount)
    const payment = new Payment({
      companyId: company._id,
      userId: user._id,
      subscriptionId,
      planName: plan.name,
      planDuration: 14,
      amount: 0,
      currency: 'INR',
      billingCycle: 'monthly',
      status: 'completed',
      paidAt: new Date(),
      razorpayOrderId: `free_trial_${Date.now()}`,
      razorpayPaymentId: `free_trial_${company._id}`,
    });

    await payment.save();

    // Create subscription history record for free trial
    await SubscriptionHistory.create({
      companyId: company._id,
      userId: user._id,
      oldPlanId: null,
      newPlanId: plan._id,
      oldPlanName: null,
      newPlanName: plan.name,
      startDate: subscriptionStartDate,
      endDate: subscriptionEndDate,
      bonusDays: 0,
      remainingDays: 0,
      paymentId: payment._id,
      type: 'new',
      billingCycle: 'monthly',
      amount: 0,
      notes: 'Free trial registration',
    });

    // Send welcome email
    try {
      await notificationHelper.createWithNotification(
        {
          companyId: company._id,
          userId: user._id,
          type: 'system',
          title: 'Welcome to SIM Management!',
          message: `Your 14-day free trial has started. Explore all features until ${subscriptionEndDate.toDateString()}.`,
          priority: 'medium',
          metadata: {
            companyName: company.name,
            planName: plan.name,
            expiryDate: subscriptionEndDate,
            isTrial: true,
          },
        },
        {
          to: user.email,
          subject: `Welcome to SIM Management - Your Free Trial Has Started`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #16a34a, #15803d); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0;">Welcome to SIM Management!</h1>
              </div>
              <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <h2>Hello ${user.name},</h2>
                <p>Your company <strong>${company.name}</strong> has been successfully registered!</p>
                <div style="background: #dcfce7; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #bbf7d0;">
                  <p style="margin: 0; color: #16a34a;"><strong>🎉 14-Day Free Trial Started!</strong></p>
                  <p style="margin: 10px 0 0 0;"><strong>Plan:</strong> ${plan.name}</p>
                  <p style="margin: 10px 0 0 0;"><strong>Trial Ends:</strong> ${subscriptionEndDate.toDateString()}</p>
                </div>
                <p>You can now log in with your email: <strong>${user.email}</strong></p>
                <p>Explore all features during your trial period. Upgrade anytime to continue using SIM Management.</p>
                <p>Best regards,<br>SIM Management Team</p>
              </div>
            </div>
          `,
        }
      );
    } catch (notificationError) {
      console.error('Failed to send welcome notification:', notificationError.message);
    }

    // Notify superadmins
    try {
      await this.notifySuperadminsFreeTrial(company, user, plan);
    } catch (error) {
      console.error('Error sending superadmin notifications:', error.message);
    }

    // Return user without sensitive data
    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;
    delete userObj.__v;

    return {
      success: true,
      user: userObj,
      accessToken,
      refreshToken,
      company: {
        id: company._id,
        name: company.name,
        subscriptionEnds: company.subscriptionEndDate,
        isTrial: true,
        trialEndsAt: company.trialEndsAt,
      },
      payment: {
        id: payment._id,
        amount: 0,
        planName: plan.name,
        billingCycle: 'monthly',
      },
    };
  }

  /**
   * Send notification to all superadmins about free trial registration
   */
  async notifySuperadminsFreeTrial(company, user, plan) {
    try {
      const superadmins = await User.find({
        role: 'super_admin',
        isActive: true,
      }).select('name email');

      if (!superadmins || superadmins.length === 0) {
        return;
      }

      const emailPromises = superadmins.map(superadmin =>
        emailService.sendEmail({
          to: superadmin.email,
          subject: `New Free Trial Registration - ${company.name}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #16a34a, #15803d); color: white; padding: 20px; border-radius: 10px 10px 0 0;">
                <h2 style="margin: 0;">New Free Trial Registration</h2>
              </div>
              <div style="background: #ffffff; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <p>A new company has registered for a free trial:</p>
                <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; margin: 15px 0;">
                  <p style="margin: 0;"><strong>Company:</strong> ${company.name}</p>
                  <p style="margin: 10px 0 0 0;"><strong>Email:</strong> ${company.email}</p>
                  <p style="margin: 10px 0 0 0;"><strong>Phone:</strong> ${company.phone || 'N/A'}</p>
                  <p style="margin: 10px 0 0 0;"><strong>Admin:</strong> ${user.name} (${user.email})</p>
                  <p style="margin: 10px 0 0 0;"><strong>Plan:</strong> ${plan.name} (Free Trial)</p>
                  <p style="margin: 10px 0 0 0;"><strong>Trial Ends:</strong> ${new Date(company.trialEndsAt).toDateString()}</p>
                </div>
              </div>
            </div>
          `,
        })
      );

      await Promise.allSettled(emailPromises);
      console.log(`Free trial registration notification sent to ${superadmins.length} superadmin(s)`);
    } catch (error) {
      console.error('Error sending superadmin notifications:', error.message);
    }
  }
}

module.exports = new PaymentService();