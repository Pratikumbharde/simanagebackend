const mongoose = require('mongoose');
const Company = require('../../models/company/company.model');
const User = require('../../models/auth/user.model');
const Subscription = require('../../models/subscription/subscription.model');
const SubscriptionHistory = require('../../models/subscription/subscriptionHistory.model');
const Sim = require('../../models/sim/sim.model');
const Recharge = require('../../models/recharge/recharge.model');
const CallLog = require('../../models/callLog/callLog.model');
const Notification = require('../../models/notification/notification.model');
const WhatsAppMessage = require('../../models/whatsapp/whatsapp.model');
const TelegramMessage = require('../../models/telegram/telegram.model');
const Sms = require('../../models/sms/sms.model');
const WifiNetwork = require('../../models/wifi/wifiNetwork.model');
const WifiDevice = require('../../models/wifi/wifiDevice.model');
const WifiMetric = require('../../models/wifi/wifiMetric.model');
const WifiAlert = require('../../models/wifi/wifiAlert.model');
const CallAutomationConfig = require('../../models/callAutomation/callAutomation.model');
const { AppError, NotFoundError, UnauthorizedError, ConflictError } = require('../../utils/errors');
const emailService = require('../../utils/emailService');
const notificationHelper = require('../../utils/notificationHelper');
const config = require('../../config');

class CompanyService {
  /**
   * Normalize phone number to international format for mobileNumber field.
   * - Strips spaces and dashes
   * - 10 digits → +91 prefix (Indian number)
   * - 12 digits starting with 91 → + prefix
   * - Already has + prefix → keep as-is
   * Returns null if phone is empty/falsy.
   */
  _normalizePhone(phone) {
    if (!phone) return null;
    let normalizedPhone = phone.replace(/[\s-]/g, '');
    if (/^\d{10}$/.test(normalizedPhone)) {
      normalizedPhone = '+91' + normalizedPhone;
    }
    if (/^91\d{10}$/.test(normalizedPhone)) {
      normalizedPhone = '+' + normalizedPhone;
    }
    return normalizedPhone;
  }

  /**
   * Create a new company with subscription
   * Handles both free trial and paid plans
   * @param {Object} data - Company data
   * @param {String} createdBy - User ID who created the company
   * @param {String} billingCycle - 'monthly' or 'yearly' (default: 'monthly')
   */
  async createCompany(data, createdBy, billingCycle = 'monthly') {
    const { name, email, phone, address, subscriptionId } = data;

    // Check if company with same name already exists (case-insensitive)
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingNameCompany = await Company.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(name.trim())}$`, 'i') }
    });
    if (existingNameCompany) {
      throw new ConflictError('A company with this name already exists. Please choose a different name.');
    }

    // [GLOBAL UNIQUE EMAIL] Check if company email exists in companies
    const existingCompany = await Company.findOne({ email: email.toLowerCase() });
    if (existingCompany) {
      throw new ConflictError('Company with this email id already exists');
    }

    // [GLOBAL UNIQUE EMAIL] Check if email exists in users table
    // Company email should not be used by any user in the system
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      throw new ConflictError('This Email ID is already registered as a user in the system. Each email can only be used once.');
    }

    // Validate subscription
    const subscription = await Subscription.findById(subscriptionId);
    if (!subscription) {
      throw new NotFoundError('Subscription');
    }

    // Calculate subscription dates based on plan type
    const subscriptionStartDate = new Date();
    let subscriptionEndDate = new Date();
    let trialEndsAt = null;
    let isTrial = false;

    if (subscription.planType === 'free_trial') {
      // Free trial plan - use duration from subscription plan (default 14 days)
      isTrial = true;
      const trialDuration = subscription.durationDays?.monthly || 14;
      trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + trialDuration);
      subscriptionEndDate = new Date(trialEndsAt); // End date same as trial end
    } else {
      // Paid plan - calculate duration based on billing cycle
      const durationDays = billingCycle === 'yearly'
        ? (subscription.durationDays?.yearly || 336)
        : (subscription.durationDays?.monthly || 28);

      isTrial = false;
      subscriptionEndDate.setDate(subscriptionEndDate.getDate() + durationDays);
      trialEndsAt = null; // No trial for paid plans
    }

    // Create company
    const company = new Company({
      name,
      email: email.toLowerCase(),
      phone,
      address,
      subscriptionId,
      subscriptionStartDate,
      subscriptionEndDate,
      billingCycle: billingCycle,
      isTrial,
      trialEndsAt,
      hasConverted: false,
      trialConvertedAt: null,
      createdBy,
    });

    try {
      await company.save();
    } catch (saveError) {
      // [GLOBAL UNIQUE EMAIL] Handle MongoDB duplicate key error
      if (saveError.code === 11000) {
        const field = Object.keys(saveError.keyValue)[0];
        if (field === 'email') {
          throw new ConflictError('This Email ID is already registered in the system. Each email can only be used once.');
        } else {
          throw new ConflictError(`${field} is already in use.`);
        }
      }
      throw saveError;
    }

    // Send notification for company creation
    try {
      await notificationHelper.notifyCompanyCreated(company, null);
    } catch (notificationError) {
      // Don't fail company creation if notification fails
      console.error('Failed to send company creation notification:', notificationError.message);
    }

    return company;
  }

  async getAllCompanies(query = {}) {
    const { page = 1, limit = 10, search, status, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;
    if (status === 'expired') filter.subscriptionEndDate = { $lt: new Date() };

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const companies = await Company.find(filter)
      .populate('subscriptionId', 'name price')
      .populate('createdBy', 'name email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await Company.countDocuments(filter);

    // Attach admin count to each company
    const companyIds = companies.map(c => c._id);
    const adminCounts = await User.aggregate([
      { $match: { companyId: { $in: companyIds }, role: 'admin' } },
      { $group: { _id: '$companyId', count: { $sum: 1 } } }
    ]);
    const adminCountMap = {};
    adminCounts.forEach(item => { adminCountMap[item._id.toString()] = item.count; });

    const companiesWithCount = companies.map(company => {
      const obj = company.toObject ? company.toObject() : company;
      obj.adminCount = adminCountMap[company._id.toString()] || 0;
      return obj;
    });

    return { data: companiesWithCount, total, page: parseInt(page), limit: parseInt(limit) };
  }

  // Get simple list of companies for dropdowns
  async getCompanyList() {
    const companies = await Company.find({})
      .select('name email')
      .sort({ name: 1 });
    return companies;
  }

  async getCompanyById(companyId) {
    const company = await Company.findById(companyId)
      .populate('subscriptionId')
      .populate('createdBy', 'name email');

    if (!company) {
      throw new NotFoundError('Company');
    }

    return company;
  }

  async updateCompany(companyId, updateData) {
    const allowedUpdates = ['name', 'email', 'phone', 'address', 'logo', 'settings', 'isActive'];
    const updates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    // Check if name is being updated and if it's already used by another company
    if (updates.name) {
      const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existingNameCompany = await Company.findOne({
        name: { $regex: new RegExp(`^${escapeRegex(updates.name.trim())}$`, 'i') },
        _id: { $ne: companyId }
      });
      if (existingNameCompany) {
        throw new ConflictError('A company with this name already exists. Please choose a different name.');
      }
    }

    // Check if email is being updated and if it's already used by another company
    if (updates.email) {
      updates.email = updates.email.toLowerCase();
      const existingCompany = await Company.findOne({
        email: updates.email,
        _id: { $ne: companyId }
      });
      if (existingCompany) {
        throw new ConflictError('This email is already used by another company');
      }

      // Also check if email exists in users table
      const existingUser = await User.findOne({
        email: updates.email,
        companyId: { $ne: companyId }
      });
      if (existingUser) {
        throw new ConflictError('This email is already registered as a user in the system');
      }
    }

    const company = await Company.findByIdAndUpdate(companyId, updates, {
      new: true,
      runValidators: true,
    }).populate('subscriptionId');

    if (!company) {
      throw new NotFoundError('Company');
    }

    return company;
  }

  async deleteCompany(companyId) {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company');
    }

    // Start a session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // ========================================
      // CASCADE DELETE - Company Data
      // ========================================
      // NOTE: We do NOT delete Payment data (financial records)
      // NOTE: We do NOT delete AuditLog data (compliance records)

      // 1. Delete CallAutomationConfig
      await CallAutomationConfig.deleteMany({ companyId }).session(session);

      // 2. Delete WiFi related data
      await WifiAlert.deleteMany({ companyId }).session(session);
      await WifiMetric.deleteMany({ companyId }).session(session);
      await WifiDevice.deleteMany({ companyId }).session(session);
      await WifiNetwork.deleteMany({ companyId }).session(session);

      // 3. Delete messaging logs
      await TelegramMessage.deleteMany({ companyId }).session(session);
      await WhatsAppMessage.deleteMany({ companyId }).session(session);
      await Sms.deleteMany({ companyId }).session(session);

      // 4. Delete notifications
      await Notification.deleteMany({ companyId }).session(session);

      // 5. Delete call logs
      await CallLog.deleteMany({ companyId }).session(session);

      // 6. Delete recharges
      await Recharge.deleteMany({ companyId }).session(session);

      // 7. Delete SIMs
      await Sim.deleteMany({ companyId }).session(session);

      // 8. Delete Users (except super_admin - shouldn't have companyId anyway)
      await User.deleteMany({ companyId }).session(session);

      // 9. Finally delete the company
      await Company.findByIdAndDelete(companyId).session(session);

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      console.log(`[DELETE] Company ${company.name} (${companyId}) deleted with all related data`);

      return true;
    } catch (error) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();
      console.error('[DELETE] Transaction aborted:', error.message);
      throw new AppError(`Failed to delete company: ${error.message}`, 500);
    }
  }

  /**
   * Renew or upgrade subscription
   * Handles: trial to paid, plan changes, billing cycle changes, same plan renewal
   * @param {String} companyId - Company ID
   * @param {String} subscriptionId - New subscription plan ID
   * @param {String} billingCycle - 'monthly' or 'yearly' (default: 'monthly')
   * @param {String} adminId - Admin user ID who initiated the renewal (optional)
   * @returns {Object} Result with company, message, and details
   */
  async renewSubscription(companyId, subscriptionId, billingCycle = 'monthly', adminId = null) {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company');
    }

    const newPlan = await Subscription.findById(subscriptionId);
    if (!newPlan) {
      throw new NotFoundError('Subscription');
    }

    // Get current plan if exists
    const currentPlanId = company.subscriptionId;
    let currentPlan = null;
    if (currentPlanId) {
      currentPlan = await Subscription.findById(currentPlanId);
    }

    // Constants
    const MAX_BONUS_DAYS = 7;

    // Helper to calculate remaining days
    const calculateRemainingDays = (endDate) => {
      if (!endDate) return 0;
      const now = new Date();
      const end = new Date(endDate);
      const diffMs = end - now;
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return Math.max(0, diffDays);
    };

    // Helper to calculate plan duration
    const getPlanDuration = (plan, cycle) => {
      if (plan.planType === 'free_trial') return plan.durationDays?.monthly || 14;
      return cycle === 'yearly'
        ? (plan.durationDays?.yearly || 336)
        : (plan.durationDays?.monthly || 28);
    };

    // Determine change type and calculate dates
    let changeType;
    let startDate;
    let endDate;
    let bonusDays = 0;
    let remainingDays = 0;
    let message;

    const durationDays = getPlanDuration(newPlan, billingCycle);

    // Case 1: New subscription or trial conversion
    if (!currentPlan || company.isTrial) {
      changeType = company.isTrial ? 'trial_convert' : 'new';
      startDate = new Date();
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + durationDays);
      message = company.isTrial
        ? 'Your trial has been converted to a paid plan successfully.'
        : 'Your subscription has been activated successfully.';

      // Clear trial fields
      if (company.isTrial) {
        company.isTrial = false;
        company.hasConverted = true;
        company.trialConvertedAt = new Date();
        company.trialEndsAt = null;
      }
    }
    // Case 2: Same plan renewal
    else if (currentPlanId.toString() === subscriptionId.toString()) {
      changeType = 'renewal';
      remainingDays = calculateRemainingDays(company.subscriptionEndDate);
      const currentEndDate = company.subscriptionEndDate ? new Date(company.subscriptionEndDate) : new Date();
      const now = new Date();

      // Start from current end date (no loss of remaining days)
      startDate = currentEndDate > now ? currentEndDate : now;
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + durationDays);

      message = 'Your plan has been renewed successfully. Your remaining days have been extended without any loss.';
    }
    // Case 3: Plan upgrade (higher price)
    else {
      const currentPrice = company.billingCycle === 'yearly'
        ? currentPlan.price.yearly
        : currentPlan.price.monthly;
      const newPrice = billingCycle === 'yearly'
        ? newPlan.price.yearly
        : newPlan.price.monthly;

      if (newPrice > currentPrice) {
        // Upgrade - apply bonus days logic
        changeType = 'upgrade';
        remainingDays = calculateRemainingDays(company.subscriptionEndDate);
        bonusDays = Math.min(remainingDays, MAX_BONUS_DAYS);

        startDate = new Date();
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + durationDays + bonusDays);

        if (remainingDays > 0) {
          message = `You have upgraded your plan successfully. Your new plan is activated immediately. Your remaining ${remainingDays} days from the previous plan have been converted into ${bonusDays} bonus days and added to your new plan.`;
        } else {
          message = 'Your new plan is activated successfully.';
        }
      } else {
        // Downgrade - no bonus days
        changeType = 'downgrade';
        remainingDays = calculateRemainingDays(company.subscriptionEndDate);

        startDate = new Date();
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + durationDays);

        message = 'Your plan has been downgraded. Note: Your previous subscription benefits will end immediately and your new plan is now active.';
      }
    }

    // Update company subscription
    company.subscriptionId = subscriptionId;
    company.billingCycle = billingCycle;
    company.subscriptionStartDate = startDate;
    company.subscriptionEndDate = endDate;
    company.isActive = true;

    // If switching to free trial (edge case)
    if (newPlan.planType === 'free_trial') {
      company.isTrial = true;
      company.trialEndsAt = endDate;
      company.hasConverted = false;
      company.trialConvertedAt = null;
    }

    await company.save();

    // Create subscription history
    await SubscriptionHistory.create({
      companyId: company._id,
      userId: adminId, // May be null for self-service renewals
      oldPlanId: currentPlanId || null,
      newPlanId: newPlan._id,
      oldPlanName: currentPlan?.name || null,
      newPlanName: newPlan.name,
      startDate: startDate,
      endDate: endDate,
      bonusDays: bonusDays,
      remainingDays: remainingDays,
      paymentId: null, // No payment for manual admin renewal
      type: changeType,
      billingCycle: billingCycle,
      amount: 0, // Manual renewal, no direct payment
      notes: changeType === 'renewal'
        ? 'Same plan renewal - remaining days preserved'
        : changeType === 'upgrade'
          ? bonusDays > 0
            ? `Plan upgrade. ${remainingDays} remaining days converted to ${bonusDays} bonus days.`
            : 'Plan upgrade with no remaining days.'
          : changeType === 'downgrade'
            ? 'Plan downgrade. Remaining days not carried over.'
            : changeType === 'trial_convert'
              ? 'Trial converted to paid plan'
              : 'New subscription',
    });

    // Send notification for subscription renewal/upgrade
    try {
      if (changeType === 'trial_convert') {
        await notificationHelper.notifyTrialConverted(
          company,
          company.subscriptionEndDate,
          newPlan.name
        );
      } else {
        await notificationHelper.notifySubscriptionRenewed(
          company,
          company.subscriptionEndDate,
          newPlan.name
        );
      }
    } catch (notificationError) {
      console.error('Failed to send subscription renewal notification:', notificationError.message);
    }

    return {
      company,
      message,
      type: changeType,
      bonusDays,
      remainingDays,
      startDate,
      endDate,
    };
  }

  /**
   * Extend trial period (for free trial companies only)
   * @param {String} companyId - Company ID
   * @param {Number} days - Number of days to extend
   */
  async extendTrial(companyId, days = 7) {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company');
    }

    // Can only extend trial if company is still on trial
    if (!company.isTrial) {
      throw new AppError('Can only extend trial for companies on free trial', 400);
    }

    // Extend subscription end date
    company.subscriptionEndDate = new Date(company.subscriptionEndDate);
    company.subscriptionEndDate.setDate(company.subscriptionEndDate.getDate() + days);

    // Also extend trial end date if set
    if (company.trialEndsAt) {
      company.trialEndsAt = new Date(company.trialEndsAt);
      company.trialEndsAt.setDate(company.trialEndsAt.getDate() + days);
    }

    await company.save();

    // Send notification for trial extension
    try {
      await notificationHelper.notifyTrialExtended(
        company,
        company.subscriptionEndDate,
        days
      );
    } catch (notificationError) {
      console.error('Failed to send trial extension notification:', notificationError.message);
    }

    return company;
  }

  async getCompanyStats(companyId) {
    // [HARD DELETE] Removed isActive: true filter - records are now hard deleted
    const totalSims = await Sim.countDocuments({ companyId });
    const activeSims = await Sim.countDocuments({ companyId, status: 'active' });
    const inactiveSims = await Sim.countDocuments({ companyId, status: 'inactive' });

    const totalRecharges = await Recharge.countDocuments({ companyId, status: 'completed' });
    const rechargeStats = await Recharge.getTotalSpent(companyId);

    const company = await Company.findById(companyId);

    return {
      totalSims,
      activeSims,
      inactiveSims,
      totalRecharges,
      totalSpent: rechargeStats.total,
      subscriptionStatus: company.subscriptionStatus,
      subscriptionEndDate: company.subscriptionEndDate,
    };
  }

  async getExpiringSubscriptions(days = 7) {
    return Company.find({
      isActive: true,
      subscriptionEndDate: {
        $lte: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        $gt: new Date(),
      },
    }).populate('subscriptionId');
  }

  async getDashboardOverview() {
    // [HARD DELETE] Count all companies since soft delete is removed
    const totalCompanies = await Company.countDocuments();
    // Keep subscription-based status filtering (isActive = subscription active)
    const activeCompanies = await Company.countDocuments({ isActive: true });
    const expiredCompanies = await Company.countDocuments({
      isActive: true,
      subscriptionEndDate: { $lt: new Date() },
    });

    return {
      totalCompanies,
      activeCompanies,
      expiredCompanies,
    };
  }

  // Admin Management
  async createAdmin(companyId, adminData, createdBy) {
    // Verify company exists
    const company = await Company.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company');
    }

    // [GLOBAL UNIQUE EMAIL] Check if email exists anywhere in the system
    // One email can only belong to one user across all companies
    const existingUser = await User.findOne({ email: adminData.email.toLowerCase() });
    if (existingUser) {
      throw new ConflictError(`Email ${adminData.email} is already registered in the system. Each email can only be used once across all companies.`);
    }

    // [ADMIN EMAIL FIX] Capture plain-text password BEFORE hashing
    // The password will be hashed during admin.save() by User model pre-save hook
    const plainTextPassword = adminData.password;

    // Create admin user
    const admin = new User({
      email: adminData.email.toLowerCase(),
      password: adminData.password,
      name: adminData.name,
      phone: adminData.phone,
      mobileNumber: adminData.phone ? this._normalizePhone(adminData.phone) : undefined,
      role: 'admin',
      companyId: companyId,
      isActive: true,
      emailVerified: true,
    });

    try {
      await admin.save();
    } catch (saveError) {
      // [GLOBAL UNIQUE EMAIL] Handle MongoDB duplicate key error
      if (saveError.code === 11000) {
        const field = Object.keys(saveError.keyValue)[0];
        if (field === 'email') {
          throw new ConflictError('This Email ID is already registered in the system. Each email can only be used once.');
        } else if (field === 'mobileNumber') {
          throw new ConflictError('This phone number is already registered in the system. Please use a different phone number.');
        } else {
          throw new ConflictError(`${field} is already in use.`);
        }
      }
      // Re-throw other errors
      throw saveError;
    }

    // Generate tokens for the admin
    const { accessToken, refreshToken } = this.generateTokens(admin);
    admin.refreshToken = refreshToken;
    await admin.save();

    // [ADMIN EMAIL FIX] Send welcome email after successful DB save
    let emailSent = false;
    try {
      await notificationHelper.notifyUserCreated(admin, company, plainTextPassword);
      emailSent = true;
    } catch (error) {
      // Don't fail admin creation if email fails
      console.error('Failed to send admin welcome email:', error.message);
    }

    return {
      user: this.sanitizeUser(admin),
      accessToken,
      emailSent, // [ADMIN EMAIL FIX] Return email status to controller
    };
  }

  async getCompanyAdmins(companyId) {
    // Verify company exists
    const company = await Company.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company');
    }

    const admins = await User.find({ companyId, role: 'admin' })
      .select('-password -refreshToken -resetPasswordToken')
      .sort({ createdAt: -1 });

    return admins;
  }

  async getAdminById(adminId) {
    const admin = await User.findOne({ _id: adminId, role: 'admin' })
      .select('-password -refreshToken -resetPasswordToken')
      .populate('companyId', 'name email');

    if (!admin) {
      throw new NotFoundError('Admin');
    }

    return admin;
  }

  async updateAdmin(adminId, updateData) {
    const allowedUpdates = ['name', 'phone', 'isActive'];
    const updates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    // [PHONE SYNC FIX] - When phone is updated, sync mobileNumber for OTP login and uniqueness
    if ('phone' in updateData) {
      if (updates.phone) {
        const normalizedPhone = this._normalizePhone(updates.phone);

        // Pre-check uniqueness before the MongoDB unique index error
        const existingUser = await User.findOne({
          mobileNumber: normalizedPhone,
          _id: { $ne: adminId },
        });
        if (existingUser) {
          throw new ConflictError('This phone number is already registered in the system. Please use a different phone number.');
        }

        updates.mobileNumber = normalizedPhone;
      } else {
        // Phone cleared — free the old mobileNumber so it can be reused
        updates.mobileNumber = null;
      }
    }

    const admin = await User.findOneAndUpdate(
      { _id: adminId, role: 'admin' },
      updates,
      { new: true, runValidators: true }
    ).select('-password -refreshToken -resetPasswordToken');

    if (!admin) {
      throw new NotFoundError('Admin');
    }

    return admin;
  }

  async deleteAdmin(adminId) {
    const admin = await User.findOne({ _id: adminId, role: 'admin' });
    if (!admin) {
      throw new NotFoundError('Admin');
    }

    const companyId = admin.companyId;

    // Start a session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Unassign SIMs from this admin (if any)
      await Sim.updateMany(
        { assignedTo: adminId },
        { assignedTo: null },
        { session }
      );

      // Delete notifications for this user
      await Notification.deleteMany({ userId: adminId }).session(session);

      // Hard delete the admin user
      await User.findByIdAndDelete(adminId).session(session);

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      console.log(`[DELETE] Admin ${admin.email} (${adminId}) deleted`);

      return admin;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('[DELETE] Admin delete transaction aborted:', error.message);
      throw new AppError(`Failed to delete admin: ${error.message}`, 500);
    }
  }

  async resetAdminPassword(adminId, newPassword, resetBy = null) {
    const admin = await User.findOne({ _id: adminId, role: 'admin' }).select('+password');
    if (!admin) {
      throw new NotFoundError('Admin');
    }

    admin.password = newPassword;
    admin.passwordChangedAt = Date.now();
    admin.refreshToken = null;
    await admin.save();

    // Send password reset notification
    if (resetBy) {
      try {
        const company = await Company.findById(admin.companyId);
        await notificationHelper.notifyPasswordResetByAdmin(admin, newPassword, resetBy, company);
      } catch (notificationError) {
        console.error('Failed to send admin password reset notification:', notificationError.message);
      }
    }

    return { message: 'Password reset successfully' };
  }

  generateTokens(user) {
    const jwt = require('jsonwebtoken');
    const config = require('../../config');

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

    return { accessToken, refreshToken };
  }

  sanitizeUser(user) {
    const userObj = user.toObject ? user.toObject() : user;
    delete userObj.password;
    delete userObj.refreshToken;
    delete userObj.resetPasswordToken;
    delete userObj.resetPasswordExpires;
    delete userObj.__v;
    return userObj;
  }

  // Get company's subscription for admin dashboard
  async getMySubscription(companyId) {
    const company = await Company.findById(companyId)
      .populate('subscriptionId');

    if (!company) {
      throw new NotFoundError('Company');
    }

    // [HARD DELETE] Removed isActive: true filter - records are now hard deleted
    // Get current SIM and User counts (exclude admin from user count)
    const currentSims = await Sim.countDocuments({ companyId });
    const currentUsers = await User.countDocuments({ companyId, role: { $ne: 'admin' } });

    // Determine subscription status
    const now = new Date();
    let status = 'active';
    if (!company.subscriptionEndDate || new Date(company.subscriptionEndDate) < now) {
      status = 'expired';
    } else if (!company.isActive) {
      status = 'inactive';
    }

    // Calculate days until expiry
    const daysUntilExpiry = company.subscriptionEndDate
      ? Math.ceil((new Date(company.subscriptionEndDate) - now) / (1000 * 60 * 60 * 24))
      : null;

    return {
      company: {
        name: company.name,
        email: company.email,
      },
      plan: company.subscriptionId ? {
        _id: company.subscriptionId._id,
        name: company.subscriptionId.name,
        description: company.subscriptionId.description,
        price: company.subscriptionId.price,
        features: company.subscriptionId.features,
        limits: company.subscriptionId.limits,
        isPopular: company.subscriptionId.isPopular,
      } : null,
      billingCycle: company.billingCycle || 'monthly',
      status,
      subscriptionStartDate: company.subscriptionStartDate,
      subscriptionEndDate: company.subscriptionEndDate,
      daysUntilExpiry,
      isActive: company.isActive,
      usage: {
        currentSims,
        currentUsers,
        maxSims: company.subscriptionId?.limits?.maxSims ?? 0,
        maxUsers: company.subscriptionId?.limits?.maxUsers ?? 0,
      },
    };
  }

  /**
   * Get company details for logged-in user
   * @param {string} companyId - Company ID from JWT token
   * @returns {Object} Mapped company response
   */
  async getMyCompany(companyId) {
    const company = await Company.findById(companyId)
      .populate('subscriptionId', 'name price limits')
      .select('_id name logo address phone email website subscriptionId subscriptionStartDate subscriptionEndDate status isActive createdAt settings');

    if (!company) {
      throw new NotFoundError('Company');
    }

    return this.mapCompanyResponse(company);
  }

  /**
   * Get company details by ID (Admin use)
   * @param {string} companyId - Company ID
   * @param {string} requesterCompanyId - Requester's company ID for validation
   * @param {string} requesterRole - Requester's role
   * @returns {Object} Mapped company response
   */
  async getCompanyDetailsById(companyId, requesterCompanyId, requesterRole) {
    // Security: Only super_admin can access any company, others only their own
    if (requesterRole !== 'super_admin' && companyId !== requesterCompanyId) {
      throw new NotFoundError('Company');
    }

    const company = await Company.findById(companyId)
      .populate('subscriptionId', 'name price limits')
      .select('_id name logo address phone email website subscriptionId subscriptionStartDate subscriptionEndDate status isActive createdAt settings');

    if (!company) {
      throw new NotFoundError('Company');
    }

    return this.mapCompanyResponse(company);
  }

  /**
   * Update own company profile (for company admins)
   * Admins can only update: name, phone, website, address
   * Email changes require separate verification process
   * @param {string} companyId - Company ID
   * @param {Object} updateData - Data to update
   * @param {Object} user - Requesting user
   * @returns {Object} Updated company
   */
  async updateMyCompany(companyId, updateData, user) {
    // Only allow specific fields to be updated (email removed - requires verification)
    const allowedUpdates = ['name', 'phone', 'website', 'address'];
    const updates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    // Check if name is being updated and if it's already used by another company
    if (updates.name) {
      const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existingNameCompany = await Company.findOne({
        name: { $regex: new RegExp(`^${escapeRegex(updates.name.trim())}$`, 'i') },
        _id: { $ne: companyId }
      });
      if (existingNameCompany) {
        throw new ConflictError('A company with this name already exists. Please choose a different name.');
      }
    }

    // If phone is being updated, normalize it
    if (updates.phone) {
      updates.phone = updates.phone.trim();
    }

    const company = await Company.findByIdAndUpdate(
      companyId,
      updates,
      { new: true, runValidators: true }
    ).populate('subscriptionId', 'name price limits');

    if (!company) {
      throw new NotFoundError('Company');
    }

    return this.mapCompanyResponse(company);
  }

  /**
   * Map company document to safe response object
   * @param {Object} company - Company document
   * @returns {Object} Mapped response
   */
  mapCompanyResponse(company) {
    return {
      _id: company._id,
      name: company.name,
      logo: company.logo || null,
      address: company.address || '',
      phone: company.phone || '',
      email: company.email || '',
      website: company.website || '',
      plan: company.subscriptionId?.name || 'basic',
      planDetails: company.subscriptionId ? {
        _id: company.subscriptionId._id,
        name: company.subscriptionId.name,
        price: company.subscriptionId.price,
        limits: company.subscriptionId.limits,
      } : null,
      maxSIMs: company.subscriptionId?.limits?.maxSims || 0,
      maxUsers: company.subscriptionId?.limits?.maxUsers || 0,
      subscriptionStartDate: company.subscriptionStartDate,
      subscriptionEndDate: company.subscriptionEndDate,
      status: company.isActive ? 'active' : 'inactive',
      subscriptionStatus: company.subscriptionEndDate && new Date(company.subscriptionEndDate) < new Date() ? 'expired' : 'active',
      createdAt: company.createdAt,
      settings: company.settings || {},
    };
  }

  /**
   * Request company email change - Step 1
   * Verifies admin password and sends OTP to current company email
   */
  async requestCompanyEmailChange(companyId, newEmail, password, user) {
    const crypto = require('crypto');
    const User = require('../../models/auth/user.model');
    const emailService = require('../../utils/emailService');

    // Get company
    const company = await Company.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company');
    }

    // Verify user's password (the admin making the request)
    const adminUser = await User.findById(user._id).select('+password');
    if (!adminUser) {
      throw new NotFoundError('User');
    }

    const isPasswordValid = await adminUser.comparePassword(password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Incorrect password');
    }

    // Check if new email is same as current
    if (newEmail.toLowerCase() === company.email.toLowerCase()) {
      throw new AppError('New email cannot be the same as the current company email', 400);
    }

    // Check if new email is already used by another company
    const existingCompany = await Company.findOne({ email: newEmail.toLowerCase() });
    if (existingCompany) {
      throw new ConflictError('This email is already used by another company');
    }

    // Check if new email is already used by a user
    const existingUser = await User.findOne({ email: newEmail.toLowerCase() });
    if (existingUser) {
      throw new ConflictError('This email is already registered as a user in the system');
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store OTP and pending new email
    company.emailChangeOTP = crypto.createHash('sha256').update(otp).digest('hex');
    company.emailChangeOTPExpires = otpExpires;
    company.emailChangeOTPVerified = false;
    company.pendingNewEmail = newEmail.toLowerCase();
    await company.save();

    // Send OTP to current company email
    try {
      await emailService.sendEmailChangeOTPOld(company.email, otp, company.name, newEmail);
    } catch (error) {
      // Clear the OTP if email fails
      company.emailChangeOTP = undefined;
      company.emailChangeOTPExpires = undefined;
      company.pendingNewEmail = undefined;
      await company.save();
      throw new AppError('Failed to send verification email. Please try again.', 500);
    }

    return {
      success: true,
      message: 'Verification code sent to current company email',
      oldEmail: company.email,
      newEmail: newEmail,
    };
  }

  /**
   * Verify old email OTP - Step 2
   * Validates OTP and sends new OTP to the new email
   */
  async verifyCompanyEmailOld(companyId, otp) {
    const crypto = require('crypto');
    const emailService = require('../../utils/emailService');

    const company = await Company.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company');
    }

    // Check if email change was initiated
    if (!company.emailChangeOTP || !company.emailChangeOTPExpires || !company.pendingNewEmail) {
      throw new AppError('No pending email change request. Please start over.', 400);
    }

    // Check if OTP expired
    if (company.emailChangeOTPExpires < Date.now()) {
      company.emailChangeOTP = undefined;
      company.emailChangeOTPExpires = undefined;
      company.pendingNewEmail = undefined;
      await company.save();
      throw new AppError('Verification code has expired. Please start over.', 400);
    }

    // Verify OTP
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
    if (company.emailChangeOTP !== hashedOTP) {
      throw new AppError('Invalid verification code', 400);
    }

    // Mark old email as verified
    company.emailChangeOTPVerified = true;
    await company.save();

    // Generate new OTP for NEW email verification
    const newOTP = crypto.randomInt(100000, 999999).toString();
    const newOTPExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Update OTP for new email verification
    company.emailChangeOTP = crypto.createHash('sha256').update(newOTP).digest('hex');
    company.emailChangeOTPExpires = newOTPExpires;
    await company.save();

    // Send OTP to NEW email
    try {
      await emailService.sendEmailChangeOTPNew(company.pendingNewEmail, newOTP, company.name, company.email);
    } catch (error) {
      throw new AppError('Failed to send verification email to new address. Please try again.', 500);
    }

    return {
      success: true,
      message: 'Verification code sent to the new email',
    };
  }

  /**
   * Verify new email OTP and complete email change - Step 3
   */
  async verifyCompanyEmailNew(companyId, otp, user) {
    const crypto = require('crypto');
    const User = require('../../models/auth/user.model');
    const emailService = require('../../utils/emailService');

    const company = await Company.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company');
    }

    // Check if email change was initiated and old email was verified
    if (!company.emailChangeOTP || !company.emailChangeOTPExpires || !company.pendingNewEmail || !company.emailChangeOTPVerified) {
      throw new AppError('No pending email change request. Please start over.', 400);
    }

    // Check if OTP expired
    if (company.emailChangeOTPExpires < Date.now()) {
      company.emailChangeOTP = undefined;
      company.emailChangeOTPExpires = undefined;
      company.emailChangeOTPVerified = undefined;
      company.pendingNewEmail = undefined;
      await company.save();
      throw new AppError('Verification code has expired. Please start over.', 400);
    }

    // Verify OTP
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
    if (company.emailChangeOTP !== hashedOTP) {
      throw new AppError('Invalid verification code', 400);
    }

    // Double-check new email is still available
    const existingCompany = await Company.findOne({ email: company.pendingNewEmail });
    if (existingCompany) {
      throw new ConflictError('This email is now used by another company. Please try a different email.');
    }

    const existingUser = await User.findOne({ email: company.pendingNewEmail });
    if (existingUser) {
      throw new ConflictError('This email is now registered as a user. Please try a different email.');
    }

    // Store old email for confirmation
    const oldEmail = company.email;

    // Update company email
    company.email = company.pendingNewEmail;

    // Clear email change fields
    company.emailChangeOTP = undefined;
    company.emailChangeOTPExpires = undefined;
    company.emailChangeOTPVerified = undefined;
    company.pendingNewEmail = undefined;

    await company.save();

    // Send confirmation emails
    try {
      await emailService.sendEmailChangeConfirmationOld(oldEmail, company.name, company.email);
      await emailService.sendEmailChangeConfirmationNew(company.email, company.name, oldEmail);
    } catch (error) {
      // Email failed but email change is complete, just log the error
      console.error('Failed to send confirmation emails:', error);
    }

    return this.mapCompanyResponse(company);
  }

  /**
   * Cancel company email change
   */
  async cancelCompanyEmailChange(companyId) {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company');
    }

    // Clear email change fields
    company.emailChangeOTP = undefined;
    company.emailChangeOTPExpires = undefined;
    company.emailChangeOTPVerified = undefined;
    company.pendingNewEmail = undefined;

    await company.save();

    return { success: true };
  }

  async resendCompanyEmailChangeOTP(companyId) {
    const crypto = require('crypto');
    const emailService = require('../../utils/emailService');

    const company = await Company.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company');
    }

    if (!company.emailChangeOTP || !company.emailChangeOTPExpires || !company.pendingNewEmail) {
      throw new AppError('No pending email change request. Please start over.', 400);
    }

    // Generate new OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    company.emailChangeOTP = crypto.createHash('sha256').update(otp).digest('hex');
    company.emailChangeOTPExpires = otpExpires;
    await company.save();

    // Resend to appropriate email based on verification status
    try {
      if (!company.emailChangeOTPVerified) {
        await emailService.sendEmailChangeOTPOld(company.email, otp, company.name, company.pendingNewEmail);
      } else {
        await emailService.sendEmailChangeOTPNew(company.pendingNewEmail, otp, company.name, company.email);
      }
    } catch (error) {
      throw new AppError('Failed to send verification email. Please try again.', 500);
    }

    return { success: true, message: 'Verification code resent successfully' };
  }

  /**
   * Get subscription history for a company
   * @param {String} companyId - Company ID
   * @param {Object} options - Pagination options
   * @returns {Object} Subscription history with pagination
   */
  async getSubscriptionHistory(companyId, options = {}) {
    // Verify company exists
    const company = await Company.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company');
    }

    const { page = 1, limit = 20 } = options;
    const history = await SubscriptionHistory.getCompanyHistory(companyId, { page, limit });
    const total = await SubscriptionHistory.countDocuments({ companyId });

    return {
      data: history,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

module.exports = new CompanyService();