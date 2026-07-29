const subscriptionService = require('../../services/subscription/subscription.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse } = require('../../utils/response');

class SubscriptionController {
  async create(req, res, next) {
    try {
      const plan = await subscriptionService.createPlan(req.body);

      // Audit log: SUBSCRIPTION_CREATE
      await auditLogService.logAction({
        action: 'SUBSCRIPTION_CREATE',
        module: 'SUBSCRIPTION',
        description: `Created subscription plan ${plan.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        entityId: plan._id,
        entityType: 'SUBSCRIPTION',
        metadata: { name: plan.name, price: plan.price, planType: plan.planType },
        req,
      });

      return successResponse(res, plan, 'Subscription plan created', 201);
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const plans = await subscriptionService.getAllPlans(req.query);
      return successResponse(res, plans);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const plan = await subscriptionService.getPlanById(req.params.id);
      return successResponse(res, plan);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const plan = await subscriptionService.updatePlan(req.params.id, req.body);

      // Audit log: SUBSCRIPTION_UPDATE
      await auditLogService.logAction({
        action: 'SUBSCRIPTION_UPDATE',
        module: 'SUBSCRIPTION',
        description: `Updated subscription plan ${plan.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        entityId: plan._id,
        entityType: 'SUBSCRIPTION',
        metadata: { changes: req.body },
        req,
      });

      return successResponse(res, plan, 'Subscription plan updated');
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      const plan = await subscriptionService.deletePlan(req.params.id);

      // Audit log: SUBSCRIPTION_DELETE
      await auditLogService.logAction({
        action: 'SUBSCRIPTION_DELETE',
        module: 'SUBSCRIPTION',
        description: `Deleted subscription plan ${plan.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        entityId: plan._id,
        entityType: 'SUBSCRIPTION',
        metadata: { name: plan.name },
        req,
      });

      return successResponse(res, null, 'Subscription plan deleted');
    } catch (error) {
      next(error);
    }
  }

  async toggleStatus(req, res, next) {
    try {
      const plan = await subscriptionService.togglePlanStatus(req.params.id);

      // Audit log: SUBSCRIPTION_TOGGLE
      await auditLogService.logAction({
        action: 'SUBSCRIPTION_TOGGLE',
        module: 'SUBSCRIPTION',
        description: `${plan.isActive ? 'Activated' : 'Deactivated'} subscription plan ${plan.name}`,
        performedBy: req.user._id,
        role: req.user.role,
        entityId: plan._id,
        entityType: 'SUBSCRIPTION',
        metadata: { isActive: plan.isActive },
        req,
      });

      return successResponse(res, plan, `Plan ${plan.isActive ? 'activated' : 'deactivated'}`);
    } catch (error) {
      next(error);
    }
  }

  async initialize(req, res, next) {
    try {
      const result = await subscriptionService.initializeDefaultPlans();

      // Audit log: SUBSCRIPTION_INIT
      await auditLogService.logAction({
        action: 'SUBSCRIPTION_CREATE',
        module: 'SUBSCRIPTION',
        description: 'Initialized default subscription plans',
        performedBy: req.user._id,
        role: req.user.role,
        metadata: { count: result.plans?.length || 0 },
        req,
      });

      return successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }

  async getStats(req, res, next) {
    try {
      const stats = await subscriptionService.getPlanStats();
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }

  async compare(req, res, next) {
    try {
      const plans = await subscriptionService.comparePlans();
      return successResponse(res, plans);
    } catch (error) {
      next(error);
    }
  }

  async getUsage(req, res, next) {
    try {
      const usage = await subscriptionService.getPlanUsage(req.params.id);
      return successResponse(res, usage);
    } catch (error) {
      next(error);
    }
  }

  async getAllUsage(req, res, next) {
    try {
      const usage = await subscriptionService.getAllPlansUsage();
      return successResponse(res, usage);
    } catch (error) {
      next(error);
    }
  }

  async getFreeTrialPlan(req, res, next) {
    try {
      const plan = await subscriptionService.getFreeTrialPlan();
      return successResponse(res, plan);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SubscriptionController();