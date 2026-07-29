const Subscription = require('../../models/subscription/subscription.model');
const Company = require('../../models/company/company.model');
const SubscriptionHistory = require('../../models/subscription/subscriptionHistory.model');
const { NotFoundError, ConflictError, BadRequestError } = require('../../utils/errors');

// Constants for upgrade logic
const MAX_BONUS_DAYS = 7;

class SubscriptionService {

  // ============================================
  // HELPER FUNCTIONS FOR UPGRADE/RENEWAL LOGIC
  // ============================================

  /**
   * Calculate remaining days from current subscription end date
   * @param {Date} endDate - Current subscription end date
   * @returns {Number} Remaining days (0 if expired or no end date)
   */
  calculateRemainingDays(endDate) {
    if (!endDate) return 0;
    const now = new Date();
    const end = new Date(endDate);
    const diffMs = end - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays); // Return 0 if negative
  }

  /**
   * Calculate bonus days for plan upgrade
   * @param {Number} remainingDays - Remaining days from current plan
   * @returns {Number} Bonus days (capped at MAX_BONUS_DAYS)
   */
  applyBonusDays(remainingDays) {
    return Math.min(remainingDays, MAX_BONUS_DAYS);
  }

  /**
   * Check if this is a same-plan renewal
   * @param {String} currentPlanId - Current plan ID
   * @param {String} newPlanId - New plan ID
   * @returns {Boolean} True if same plan
   */
  isSamePlanRenewal(currentPlanId, newPlanId) {
    if (!currentPlanId) return false;
    return currentPlanId.toString() === newPlanId.toString();
  }

  /**
   * Check if this is a plan upgrade (higher price)
   * @param {Object} currentPlan - Current plan document
   * @param {Object} newPlan - New plan document
   * @param {String} billingCycle - 'monthly' or 'yearly'
   * @returns {Boolean} True if upgrade
   */
  isPlanUpgrade(currentPlan, newPlan, billingCycle) {
    if (!currentPlan || !newPlan) return false;

    // Get prices based on billing cycle
    const currentPrice = billingCycle === 'yearly'
      ? currentPlan.price.yearly
      : currentPlan.price.monthly;
    const newPrice = billingCycle === 'yearly'
      ? newPlan.price.yearly
      : newPlan.price.monthly;

    return newPrice > currentPrice;
  }

  /**
   * Handle same-plan renewal (extend end date)
   * @param {Object} company - Company document
   * @param {Object} plan - Plan document
   * @param {String} billingCycle - 'monthly' or 'yearly'
   * @param {Object} payment - Payment document
   * @param {ObjectId} userId - User ID who initiated the renewal
   * @returns {Object} Result with company and message
   */
  async handleRenewal(company, plan, billingCycle, payment, userId) {
    const durationDays = billingCycle === 'yearly'
      ? (plan.durationDays?.yearly || 365)
      : (plan.durationDays?.monthly || 30);

    // For same-plan renewal, extend from current end date (no loss of remaining days)
    const currentEndDate = company.subscriptionEndDate ? new Date(company.subscriptionEndDate) : new Date();
    const now = new Date();

    // If subscription is expired, start from now
    const startDate = currentEndDate > now ? currentEndDate : now;
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays);

    // Update company subscription
    company.subscriptionId = plan._id;
    company.billingCycle = billingCycle;
    company.subscriptionStartDate = startDate;
    company.subscriptionEndDate = endDate;
    company.isActive = true;

    // Clear trial fields if converting from trial
    if (company.isTrial) {
      company.isTrial = false;
      company.hasConverted = true;
      company.trialConvertedAt = new Date();
      company.trialEndsAt = null;
    }

    await company.save();

    // Create subscription history
    await SubscriptionHistory.create({
      companyId: company._id,
      userId: userId,
      oldPlanId: plan._id, // Same plan
      newPlanId: plan._id,
      oldPlanName: plan.name,
      newPlanName: plan.name,
      startDate: startDate,
      endDate: endDate,
      bonusDays: 0,
      remainingDays: 0,
      paymentId: payment._id,
      type: 'renewal',
      billingCycle: billingCycle,
      amount: payment.amount,
      notes: 'Same plan renewal - remaining days preserved',
    });

    return {
      company,
      message: 'Your plan has been renewed successfully. Your remaining days have been extended without any loss.',
      type: 'renewal',
    };
  }

  /**
   * Handle plan upgrade with hybrid bonus days logic
   * @param {Object} company - Company document
   * @param {Object} currentPlan - Current plan document
   * @param {Object} newPlan - New plan document
   * @param {String} billingCycle - 'monthly' or 'yearly'
   * @param {Object} payment - Payment document
   * @param {ObjectId} userId - User ID who initiated the upgrade
   * @returns {Object} Result with company, message, and bonus days info
   */
  async handleUpgrade(company, currentPlan, newPlan, billingCycle, payment, userId) {
    const durationDays = billingCycle === 'yearly'
      ? (newPlan.durationDays?.yearly || 365)
      : (newPlan.durationDays?.monthly || 30);

    // Calculate remaining days from current subscription
    const remainingDays = this.calculateRemainingDays(company.subscriptionEndDate);

    // Apply bonus days (cap at MAX_BONUS_DAYS)
    const bonusDays = this.applyBonusDays(remainingDays);

    // New plan starts immediately
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays + bonusDays);

    // Update company subscription
    company.subscriptionId = newPlan._id;
    company.billingCycle = billingCycle;
    company.subscriptionStartDate = startDate;
    company.subscriptionEndDate = endDate;
    company.isActive = true;

    // Clear trial fields if converting from trial
    if (company.isTrial) {
      company.isTrial = false;
      company.hasConverted = true;
      company.trialConvertedAt = new Date();
      company.trialEndsAt = null;
    }

    await company.save();

    // Determine upgrade type for history
    let historyType = 'upgrade';
    if (company.isTrial || (currentPlan && currentPlan.planType === 'free_trial')) {
      historyType = 'trial_convert';
    }

    // Create subscription history
    await SubscriptionHistory.create({
      companyId: company._id,
      userId: userId,
      oldPlanId: currentPlan?._id || null,
      newPlanId: newPlan._id,
      oldPlanName: currentPlan?.name || 'Free Trial',
      newPlanName: newPlan.name,
      startDate: startDate,
      endDate: endDate,
      bonusDays: bonusDays,
      remainingDays: remainingDays,
      paymentId: payment._id,
      type: historyType,
      billingCycle: billingCycle,
      amount: payment.amount,
      notes: bonusDays > 0
        ? `Plan upgrade. ${remainingDays} remaining days converted to ${bonusDays} bonus days.`
        : 'Plan upgrade with no remaining days.',
    });

    // Generate appropriate message
    let message;
    if (remainingDays > 0) {
      message = `You have upgraded your plan successfully. Your new plan is activated immediately. Your remaining ${remainingDays} days from the previous plan have been converted into ${bonusDays} bonus days and added to your new plan.`;
    } else {
      message = 'Your new plan is activated successfully.';
    }

    return {
      company,
      message,
      type: 'upgrade',
      bonusDays,
      remainingDays,
    };
  }

  /**
   * Handle downgrade (no bonus days, but plan change)
   * @param {Object} company - Company document
   * @param {Object} currentPlan - Current plan document
   * @param {Object} newPlan - New plan document
   * @param {String} billingCycle - 'monthly' or 'yearly'
   * @param {Object} payment - Payment document
   * @param {ObjectId} userId - User ID who initiated the downgrade
   * @returns {Object} Result with company and message
   */
  async handleDowngrade(company, currentPlan, newPlan, billingCycle, payment, userId) {
    const durationDays = billingCycle === 'yearly'
      ? (newPlan.durationDays?.yearly || 365)
      : (newPlan.durationDays?.monthly || 30);

    // Calculate remaining days
    const remainingDays = this.calculateRemainingDays(company.subscriptionEndDate);

    // For downgrade, remaining days are lost (no bonus)
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays);

    // Update company subscription
    company.subscriptionId = newPlan._id;
    company.billingCycle = billingCycle;
    company.subscriptionStartDate = startDate;
    company.subscriptionEndDate = endDate;
    company.isActive = true;

    // Clear trial fields if converting from trial
    if (company.isTrial) {
      company.isTrial = false;
      company.hasConverted = true;
      company.trialConvertedAt = new Date();
      company.trialEndsAt = null;
    }

    await company.save();

    // Create subscription history
    await SubscriptionHistory.create({
      companyId: company._id,
      userId: userId,
      oldPlanId: currentPlan._id,
      newPlanId: newPlan._id,
      oldPlanName: currentPlan.name,
      newPlanName: newPlan.name,
      startDate: startDate,
      endDate: endDate,
      bonusDays: 0,
      remainingDays: remainingDays,
      paymentId: payment._id,
      type: 'downgrade',
      billingCycle: billingCycle,
      amount: payment.amount,
      notes: 'Plan downgrade. Remaining days from previous plan are not carried over.',
    });

    return {
      company,
      message: 'Your plan has been downgraded. Note: Your previous subscription benefits will end immediately and your new plan is now active.',
      type: 'downgrade',
    };
  }

  /**
   * Handle new subscription (first-time subscription or trial to paid)
   * @param {Object} company - Company document
   * @param {Object} plan - Plan document
   * @param {String} billingCycle - 'monthly' or 'yearly'
   * @param {Object} payment - Payment document
   * @param {ObjectId} userId - User ID
   * @returns {Object} Result with company and message
   */
  async handleNewSubscription(company, plan, billingCycle, payment, userId) {
    const durationDays = billingCycle === 'yearly'
      ? (plan.durationDays?.yearly || 365)
      : (plan.durationDays?.monthly || 30);

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays);

    // Update company subscription
    company.subscriptionId = plan._id;
    company.billingCycle = billingCycle;
    company.subscriptionStartDate = startDate;
    company.subscriptionEndDate = endDate;
    company.isActive = true;

    // Clear trial fields if converting from trial
    if (company.isTrial) {
      company.isTrial = false;
      company.hasConverted = true;
      company.trialConvertedAt = new Date();
      company.trialEndsAt = null;
    }

    await company.save();

    // Determine type
    const historyType = company.hasConverted ? 'trial_convert' : 'new';

    // Create subscription history
    await SubscriptionHistory.create({
      companyId: company._id,
      userId: userId,
      oldPlanId: null,
      newPlanId: plan._id,
      oldPlanName: null,
      newPlanName: plan.name,
      startDate: startDate,
      endDate: endDate,
      bonusDays: 0,
      remainingDays: 0,
      paymentId: payment._id,
      type: historyType,
      billingCycle: billingCycle,
      amount: payment.amount,
      notes: historyType === 'trial_convert' ? 'Trial converted to paid plan' : 'New subscription',
    });

    return {
      company,
      message: 'Your subscription has been activated successfully.',
      type: historyType,
    };
  }

  /**
   * Process subscription payment and handle upgrade/renewal logic
   * This is the main entry point for handling subscription changes
   * @param {Object} params - Parameters for subscription processing
   * @returns {Object} Result with company, message, and details
   */
  async processSubscriptionChange({ company, newPlan, billingCycle, payment, userId }) {
    // Get current plan if exists
    const currentPlanId = company.subscriptionId;
    let currentPlan = null;

    if (currentPlanId) {
      currentPlan = await Subscription.findById(currentPlanId);
    }

    // Case 1: New subscription (no current plan or trial)
    if (!currentPlan || company.isTrial) {
      return this.handleNewSubscription(company, newPlan, billingCycle, payment, userId);
    }

    // Case 2: Same plan renewal
    if (this.isSamePlanRenewal(currentPlanId, newPlan._id)) {
      return this.handleRenewal(company, newPlan, billingCycle, payment, userId);
    }

    // Case 3: Plan upgrade (higher price)
    if (this.isPlanUpgrade(currentPlan, newPlan, billingCycle)) {
      return this.handleUpgrade(company, currentPlan, newPlan, billingCycle, payment, userId);
    }

    // Case 4: Plan downgrade (lower price)
    return this.handleDowngrade(company, currentPlan, newPlan, billingCycle, payment, userId);
  }
  async createPlan(data) {
    const { name } = data;

    // Validate plan name — only letters, spaces, hyphens, and basic punctuation allowed
    if (name && /\d/.test(name)) {
      throw new BadRequestError('Plan name cannot contain numbers');
    }

    // Check if plan name exists
    const existingPlan = await Subscription.findOne({ name });
    if (existingPlan) {
      throw new ConflictError('Subscription plan with this name already exists');
    }

    // Set default durationDays if not provided
    if (!data.durationDays) {
      data.durationDays = {
        monthly: 28,  // 28 days for monthly
        yearly: 336   // 336 days (12 × 28) for yearly
      };
    }

    // Set planType based on price
    if (!data.planType) {
      data.planType = (data.price?.monthly === 0 && data.price?.yearly === 0) ? 'free_trial' : 'paid';
    }

    const plan = new Subscription(data);
    await plan.save();

    return plan;
  }

  async getAllPlans(query = {}) {
    const { activeOnly } = query;

    const filter = {};
    // Handle different activeOnly values:
    // - 'all' or undefined: show all plans
    // - 'true', true, or 'active': show only active plans
    // - 'false', false, or 'inactive': show only inactive plans
    if (activeOnly === 'all' || activeOnly === undefined) {
      // Show all plans - no filter
    } else if (activeOnly === 'true' || activeOnly === true || activeOnly === 'active') {
      filter.isActive = true;
    } else if (activeOnly === 'false' || activeOnly === false || activeOnly === 'inactive') {
      filter.isActive = false;
    }

    const plans = await Subscription.find(filter).sort({ sortOrder: 1 });

    return plans;
  }

  async getPlanById(planId) {
    const plan = await Subscription.findById(planId);

    if (!plan) {
      throw new NotFoundError('Subscription plan');
    }

    return plan;
  }

  async updatePlan(planId, updateData) {
    // Validate plan name — only letters, spaces, hyphens, and basic punctuation allowed
    if (updateData.name && /\d/.test(updateData.name)) {
      throw new BadRequestError('Plan name cannot contain numbers');
    }

    const plan = await Subscription.findByIdAndUpdate(
      planId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!plan) {
      throw new NotFoundError('Subscription plan');
    }

    return plan;
  }

  async deletePlan(planId) {
    // Check if plan exists
    const plan = await Subscription.findById(planId);

    if (!plan) {
      throw new NotFoundError('Subscription plan');
    }

    // Check if any companies are using this plan
    const companiesUsingPlan = await Company.countDocuments({ subscriptionId: planId });

    if (companiesUsingPlan > 0) {
      throw new ConflictError(
        `This plan is currently used by ${companiesUsingPlan} business${companiesUsingPlan > 1 ? 'es' : ''}. You cannot delete it.`
      );
    }

    // Safe to delete - no companies using this plan
    await Subscription.findByIdAndDelete(planId);

    // Return the plan object for audit log
    return plan;
  }

  async togglePlanStatus(planId) {
    const plan = await Subscription.findById(planId);

    if (!plan) {
      throw new NotFoundError('Subscription plan');
    }

    plan.isActive = !plan.isActive;
    await plan.save();

    return plan;
  }

  async initializeDefaultPlans() {
    const defaultPlans = Subscription.defaultPlans;
    const createdPlans = [];

    for (const planData of defaultPlans) {
      const existing = await Subscription.findOne({ name: planData.name });
      if (!existing) {
        const plan = new Subscription(planData);
        await plan.save();
        createdPlans.push(plan);
      }
    }

    // Also ensure free trial plan exists
    await this.ensureFreeTrialPlan();

    return {
      message: `Created ${createdPlans.length} default plans`,
      plans: createdPlans,
    };
  }

  /**
   * Ensure free trial plan exists and has correct duration
   */
  async ensureFreeTrialPlan() {
    const existingTrial = await Subscription.findOne({ planType: 'free_trial' });
    if (!existingTrial) {
      await Subscription.createFreeTrialPlan();
    } else {
      // Fix: ensure existing free trial plan has 14-day duration (not the schema default of 28)
      if (existingTrial.durationDays?.monthly !== 14 || existingTrial.durationDays?.yearly !== 14) {
        existingTrial.durationDays = { monthly: 14, yearly: 14 };
        await existingTrial.save();
      }
    }
  }

  async getPlanStats() {
    const totalPlans = await Subscription.countDocuments();
    const activePlans = await Subscription.countDocuments({ isActive: true });
    const popularPlans = await Subscription.find({ isPopular: true, isActive: true });
    const freeTrialPlans = await Subscription.countDocuments({ planType: 'free_trial', isActive: true });

    return {
      totalPlans,
      activePlans,
      popularPlans,
      freeTrialPlans,
    };
  }

  async comparePlans() {
    const plans = await Subscription.find({ isActive: true })
      .sort({ sortOrder: 1 })
      .select('name description price features limits isPopular planType durationDays');

    return plans.map((plan) => ({
      ...plan.toObject(),
      yearlySavings: plan.planType === 'paid' ? plan.calculateYearlySavings() : 0,
      formattedPrice: plan.formattedPrice,
      durationInDays: plan.durationInDays,
    }));
  }

  /**
   * Get usage statistics for a specific plan
   * Returns count of companies using the plan
   */
  async getPlanUsage(planId) {
    const plan = await Subscription.findById(planId);

    if (!plan) {
      throw new NotFoundError('Subscription plan');
    }

    const companiesCount = await Company.countDocuments({ subscriptionId: planId });
    const activeCompaniesCount = await Company.countDocuments({
      subscriptionId: planId,
      isActive: true
    });

    return {
      planId,
      planName: plan.name,
      totalCompanies: companiesCount,
      activeCompanies: activeCompaniesCount,
      canDelete: companiesCount === 0
    };
  }

  /**
   * Get usage statistics for all plans
   */
  async getAllPlansUsage() {
    const plans = await Subscription.find({}).sort({ sortOrder: 1 });

    const plansWithUsage = await Promise.all(
      plans.map(async (plan) => {
        const companiesCount = await Company.countDocuments({ subscriptionId: plan._id });
        return {
          ...plan.toObject(),
          companiesCount,
          canDelete: companiesCount === 0
        };
      })
    );

    return plansWithUsage;
  }

  /**
   * Get free trial plan
   */
  async getFreeTrialPlan() {
    return Subscription.findFreeTrialPlan();
  }
}

module.exports = new SubscriptionService();