/**
 * PayU BBPS Controller
 *
 * HTTP handlers for BBPS recharge plan APIs:
 * - GET  /plans/operator-circle  — Detect operator & circle from mobile number
 * - GET  /plans/operators        — List all operators
 * - GET  /plans/circles           — List all circles
 * - GET  /plans                   — Fetch plans by operatorId + circleId
 * - GET  /plans/by-number/:mobile — Auto-detect operator & fetch plans for a number
 * - GET  /plans/by-sim/:simId    — Fetch plans for an existing SIM (uses stored operator/circle)
 * - GET  /plans/custom            — Fetch personalized plans for a mobile number
 */

const bbpsService = require('../../services/payu/bbps.service');
const Sim = require('../../models/sim/sim.model');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class BBPSController {
  /**
   * GET /api/payu/plans/operator-circle
   * Detect operator and circle from a mobile number
   * Query params: mobileNumber
   */
  async getOperatorAndCircle(req, res, next) {
    try {
      const { mobileNumber } = req.query;

      if (!mobileNumber) {
        return res.status(400).json({ success: false, message: 'mobileNumber query parameter is required' });
      }

      // Normalize mobile number
      let normalized = String(mobileNumber).replace(/[\s\-()]/g, '');
      if (normalized.startsWith('+91')) normalized = normalized.slice(3);
      if (normalized.startsWith('91') && normalized.length === 12) normalized = normalized.slice(2);

      if (!/^\d{10}$/.test(normalized)) {
        return res.status(400).json({ success: false, message: 'Invalid mobile number. Must be 10 digits.' });
      }

      const result = await bbpsService.getOperatorAndCircle(normalized);

      return res.json({
        success: result.success,
        data: result.success ? {
          operatorName: result.operatorName,
          operatorId: result.operatorId,
          circleName: result.circleName,
          circleId: result.circleId,
        } : null,
        error: result.success ? undefined : result.error,
      });
    } catch (error) {
      logger.error('[BBPS Controller] getOperatorAndCircle error:', error);
      next(error);
    }
  }

  /**
   * GET /api/payu/plans/operators
   * List all available operators
   */
  async getOperators(req, res, next) {
    try {
      const result = await bbpsService.getOperators();
      return res.json({
        success: result.success,
        data: result.operators,
        error: result.success ? undefined : result.error,
      });
    } catch (error) {
      logger.error('[BBPS Controller] getOperators error:', error);
      next(error);
    }
  }

  /**
   * GET /api/payu/plans/circles
   * List all available circles
   */
  async getCircles(req, res, next) {
    try {
      const result = await bbpsService.getCircles();
      return res.json({
        success: result.success,
        data: result.circles,
        error: result.success ? undefined : result.error,
      });
    } catch (error) {
      logger.error('[BBPS Controller] getCircles error:', error);
      next(error);
    }
  }

  /**
   * GET /api/payu/plans
   * Fetch recharge plans by operatorId and circleId
   * Query params: operatorId, circleId
   */
  async getPlans(req, res, next) {
    try {
      const { operatorId, circleId } = req.query;

      if (!operatorId) {
        return res.status(400).json({ success: false, message: 'operatorId query parameter is required' });
      }

      const result = await bbpsService.getRechargePlans(operatorId, circleId || '1');

      return res.json({
        success: result.success,
        data: result.success ? {
          plans: result.plans,
          operatorName: result.operatorName,
          operatorId: result.operatorId,
        } : null,
        error: result.success ? undefined : result.error,
      });
    } catch (error) {
      logger.error('[BBPS Controller] getPlans error:', error);
      next(error);
    }
  }

  /**
   * GET /api/payu/plans/by-number/:mobile
   * Auto-detect operator from mobile number and fetch available plans
   */
  async getPlansByNumber(req, res, next) {
    try {
      const { mobile } = req.params;

      // Normalize mobile number
      let normalized = String(mobile).replace(/[\s\-()]/g, '');
      if (normalized.startsWith('+91')) normalized = normalized.slice(3);
      if (normalized.startsWith('91') && normalized.length === 12) normalized = normalized.slice(2);

      if (!/^\d{10}$/.test(normalized)) {
        return res.status(400).json({ success: false, message: 'Invalid mobile number. Must be 10 digits.' });
      }

      // Step 1: Detect operator/circle
      const operatorInfo = await bbpsService.getOperatorAndCircle(normalized);

      if (!operatorInfo.success || !operatorInfo.operatorId) {
        return res.json({
          success: false,
          data: null,
          error: operatorInfo.error || 'Could not detect operator for this mobile number',
        });
      }

      // Step 2: Fetch plans using detected operator/circle
      const plansResult = await bbpsService.getRechargePlans(
        operatorInfo.operatorId,
        operatorInfo.circleId || '1'
      );

      // Step 3: If no plans found, try custom plans
      let plans = plansResult.plans || [];
      if (plans.length === 0) {
        const customResult = await bbpsService.getCustomPlans(
          normalized,
          operatorInfo.operatorId,
          operatorInfo.circleId || '1'
        );
        if (customResult.success) {
          plans = customResult.plans || [];
        }
      }

      return res.json({
        success: true,
        data: {
          operatorInfo: {
            operatorName: operatorInfo.operatorName,
            operatorId: operatorInfo.operatorId,
            circleName: operatorInfo.circleName,
            circleId: operatorInfo.circleId,
          },
          plans,
        },
      });
    } catch (error) {
      logger.error('[BBPS Controller] getPlansByNumber error:', error);
      next(error);
    }
  }

  /**
   * GET /api/payu/plans/by-sim/:simId
   * Fetch available plans for an existing SIM card
   * Uses the SIM's stored mobileNumber, operator, and circle
   * Tries BBPS first, falls back to local RechargePlan collection
   */
  async getPlansBySim(req, res, next) {
    try {
      const { simId } = req.params;
      const user = req.user;

      // Find the SIM
      const sim = await Sim.findById(simId);
      if (!sim) {
        throw new NotFoundError('SIM');
      }

      // Check access
      if (user.role !== 'super_admin' && sim.companyId.toString() !== user.companyId?.toString()) {
        throw new ForbiddenError('Access denied to this SIM');
      }

      // Fetch plans (BBPS first, then local fallback)
      const result = await bbpsService.getPlansForSim(sim);

      return res.json({
        success: result.success,
        data: result.success ? {
          source: result.source,
          operatorInfo: result.operatorInfo,
          plans: result.plans,
        } : null,
        error: result.success ? undefined : result.error,
      });
    } catch (error) {
      logger.error('[BBPS Controller] getPlansBySim error:', error);
      next(error);
    }
  }

  /**
   * GET /api/payu/plans/custom
   * Fetch custom/personalized plans for a mobile number
   * Query params: mobileNumber, operatorId, circleId
   */
  async getCustomPlans(req, res, next) {
    try {
      const { mobileNumber, operatorId, circleId } = req.query;

      if (!mobileNumber || !operatorId) {
        return res.status(400).json({ success: false, message: 'mobileNumber and operatorId are required' });
      }

      // Normalize mobile number
      let normalized = String(mobileNumber).replace(/[\s\-()]/g, '');
      if (normalized.startsWith('+91')) normalized = normalized.slice(3);
      if (normalized.startsWith('91') && normalized.length === 12) normalized = normalized.slice(2);

      const result = await bbpsService.getCustomPlans(normalized, operatorId, circleId || '1');

      return res.json({
        success: result.success,
        data: result.success ? {
          plans: result.plans,
          operatorName: result.operatorName,
          operatorId: result.operatorId,
        } : null,
        error: result.success ? undefined : result.error,
      });
    } catch (error) {
      logger.error('[BBPS Controller] getCustomPlans error:', error);
      next(error);
    }
  }
}

module.exports = new BBPSController();