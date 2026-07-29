/**
 * RechargePlan Controller
 *
 * HTTP handlers for local recharge plan CRUD management.
 * Admin-only endpoints for creating, updating, deleting plans.
 * Public endpoints for listing/filtering plans.
 */

const rechargePlanService = require('../../services/rechargePlan/rechargePlan.service');
const logger = require('../../utils/logger');

class RechargePlanController {
  /**
   * GET /api/recharge-plans
   * List plans with optional filters (operator, circle, planType, isActive)
   */
  async getAll(req, res, next) {
    try {
      const { operator, circle, planType, isActive, page, limit } = req.query;
      const result = await rechargePlanService.getPlans({
        operator, circle, planType, isActive, page, limit,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error('[RechargePlan Controller] getAll error:', error);
      next(error);
    }
  }

  /**
   * GET /api/recharge-plans/:id
   * Get a single plan by ID
   */
  async getById(req, res, next) {
    try {
      const plan = await rechargePlanService.getPlanById(req.params.id);
      if (!plan) {
        return res.status(404).json({ success: false, message: 'Plan not found' });
      }
      res.json({ success: true, data: plan });
    } catch (error) {
      logger.error('[RechargePlan Controller] getById error:', error);
      next(error);
    }
  }

  /**
   * POST /api/recharge-plans
   * Create a new plan (admin only)
   */
  async create(req, res, next) {
    try {
      const plan = await rechargePlanService.createPlan(req.body);
      res.status(201).json({ success: true, data: plan });
    } catch (error) {
      logger.error('[RechargePlan Controller] create error:', error);
      if (error.name === 'ValidationError') {
        return res.status(400).json({ success: false, message: error.message, errors: error.errors });
      }
      next(error);
    }
  }

  /**
   * PUT /api/recharge-plans/:id
   * Update a plan (admin only)
   */
  async update(req, res, next) {
    try {
      const plan = await rechargePlanService.updatePlan(req.params.id, req.body);
      res.json({ success: true, data: plan });
    } catch (error) {
      logger.error('[RechargePlan Controller] update error:', error);
      if (error.name === 'NotFoundError') {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * DELETE /api/recharge-plans/:id
   * Delete a plan (admin only)
   */
  async delete(req, res, next) {
    try {
      await rechargePlanService.deletePlan(req.params.id);
      res.json({ success: true, message: 'Plan deleted successfully' });
    } catch (error) {
      logger.error('[RechargePlan Controller] delete error:', error);
      if (error.name === 'NotFoundError') {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * PATCH /api/recharge-plans/:id/toggle-status
   * Toggle plan active/inactive (admin only)
   */
  async toggleStatus(req, res, next) {
    try {
      const plan = await rechargePlanService.togglePlanStatus(req.params.id);
      res.json({ success: true, data: plan });
    } catch (error) {
      logger.error('[RechargePlan Controller] toggleStatus error:', error);
      next(error);
    }
  }

  /**
   * POST /api/recharge-plans/seed
   * Bulk seed plans from an array (admin only)
   */
  async seed(req, res, next) {
    try {
      const { plans } = req.body;
      if (!Array.isArray(plans) || plans.length === 0) {
        return res.status(400).json({ success: false, message: 'plans array is required and must not be empty' });
      }
      const result = await rechargePlanService.seedPlans(plans);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('[RechargePlan Controller] seed error:', error);
      next(error);
    }
  }

  /**
   * GET /api/recharge-plans/operators
   * Get distinct operators that have active plans
   */
  async getOperators(req, res, next) {
    try {
      const operators = await rechargePlanService.getOperators();
      res.json({ success: true, data: operators });
    } catch (error) {
      logger.error('[RechargePlan Controller] getOperators error:', error);
      next(error);
    }
  }

  /**
   * GET /api/recharge-plans/circles/:operator
   * Get distinct circles for an operator
   */
  async getCircles(req, res, next) {
    try {
      const circles = await rechargePlanService.getCircles(req.params.operator);
      res.json({ success: true, data: circles });
    } catch (error) {
      logger.error('[RechargePlan Controller] getCircles error:', error);
      next(error);
    }
  }
}

module.exports = new RechargePlanController();