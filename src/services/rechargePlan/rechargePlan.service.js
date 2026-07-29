/**
 * RechargePlan Service
 *
 * Manages local recharge plans stored in MongoDB.
 * These plans serve as:
 * 1. A fallback when PayU BBPS is unavailable
 * 2. Custom admin-created plans for operators/circles
 * 3. Cached versions of BBPS plans
 */

const RechargePlan = require('../../models/rechargePlan/rechargePlan.model');
const logger = require('../../utils/logger');

class RechargePlanService {
  /**
   * Get all plans with optional filters
   */
  async getPlans({ operator, circle, planType, isActive, page = 1, limit = 50 }) {
    const query = {};
    if (operator) query.operator = { $regex: new RegExp(`^${operator}$`, 'i') };
    if (circle) query.circle = { $regex: new RegExp(`^${circle}$`, 'i') };
    if (planType) query.planType = planType;
    if (isActive !== undefined) query.isActive = isActive === 'true' || isActive === true;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [plans, total] = await Promise.all([
      RechargePlan.find(query).sort({ sortOrder: 1, amount: 1 }).skip(skip).limit(parseInt(limit)),
      RechargePlan.countDocuments(query),
    ]);

    return {
      data: plans,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get a single plan by ID
   */
  async getPlanById(id) {
    return RechargePlan.findById(id);
  }

  /**
   * Create a new plan
   */
  async createPlan(planData) {
    const plan = new RechargePlan(planData);
    await plan.save();
    logger.info('[RechargePlan] Created plan', { id: plan._id, operator: plan.operator, amount: plan.amount });
    return plan;
  }

  /**
   * Update a plan
   */
  async updatePlan(id, updateData) {
    const plan = await RechargePlan.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
    if (!plan) {
      const { NotFoundError } = require('../../utils/errors');
      throw new NotFoundError('RechargePlan');
    }
    logger.info('[RechargePlan] Updated plan', { id });
    return plan;
  }

  /**
   * Delete a plan
   */
  async deletePlan(id) {
    const plan = await RechargePlan.findByIdAndDelete(id);
    if (!plan) {
      const { NotFoundError } = require('../../utils/errors');
      throw new NotFoundError('RechargePlan');
    }
    logger.info('[RechargePlan] Deleted plan', { id });
    return plan;
  }

  /**
   * Toggle plan active status
   */
  async togglePlanStatus(id) {
    const plan = await RechargePlan.findById(id);
    if (!plan) {
      const { NotFoundError } = require('../../utils/errors');
      throw new NotFoundError('RechargePlan');
    }
    plan.isActive = !plan.isActive;
    await plan.save();
    logger.info('[RechargePlan] Toggled plan status', { id, isActive: plan.isActive });
    return plan;
  }

  /**
   * Bulk seed plans from an array of plan definitions
   * Used to seed initial plan data for operators
   */
  async seedPlans(plansArray) {
    let created = 0;
    let skipped = 0;

    for (const planData of plansArray) {
      // Check if plan already exists (by operator + amount + circle + planType)
      const existing = await RechargePlan.findOne({
        operator: { $regex: new RegExp(`^${planData.operator}$`, 'i') },
        amount: planData.amount,
        circle: planData.circle || 'all',
        planType: planData.planType || 'popular',
      });

      if (existing) {
        skipped++;
        continue;
      }

      await RechargePlan.create(planData);
      created++;
    }

    logger.info('[RechargePlan] Seed completed', { created, skipped, total: plansArray.length });
    return { created, skipped, total: plansArray.length };
  }

  /**
   * Get distinct operators that have active plans
   */
  async getOperators() {
    return RechargePlan.distinct('operator', { isActive: true });
  }

  /**
   * Get distinct circles for a given operator
   */
  async getCircles(operator) {
    return RechargePlan.distinct('circle', {
      operator: { $regex: new RegExp(`^${operator}$`, 'i') },
      isActive: true,
    });
  }
}

module.exports = new RechargePlanService();