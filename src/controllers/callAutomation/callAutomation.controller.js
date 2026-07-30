/**
 * Call Automation Controller
 *
 * Handles HTTP requests for call automation configuration.
 * UPDATED: Now supports per-target caller assignment.
 */

const callAutomationService = require('../../services/callAutomation/callAutomation.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

class CallAutomationController {
  /**
   * Save or update call automation configuration
   * POST /api/call-automation/config
   */
  async saveConfig(req, res, next) {
    try {
      logger.info('[CALL AUTOMATION CONTROLLER] saveConfig request:', {
        userId: req.user._id?.toString(),
        userRole: req.user.role,
        userCompanyId: req.user.companyId?.toString(),
        mappingsCount: req.body.targetCallerMappings?.length || 0,
        targetCallerMappings: req.body.targetCallerMappings?.map(m => ({
          targetSimId: m.targetSimId,
          callerSimIds: m.callerSimIds,
          callDuration: m.callDuration,
        })),
        frequency: req.body.frequency,
        callDuration: req.body.callDuration,
        scheduledTime: req.body.scheduledTime,
        scheduledDay: req.body.scheduledDay,
        isActive: req.body.isActive,
      });

      const config = await callAutomationService.saveConfig(req.body, req.user, req.companyId);

      // Audit log
      await auditLogService.logAction({
        action: 'CALL_AUTOMATION_CONFIG_SAVE',
        module: 'CALL_AUTOMATION',
        description: `Saved call automation configuration with ${config.targetCallerMappings.length} target-caller mappings`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: config.companyId,
        entityId: config._id,
        entityType: 'CallAutomationConfig',
        metadata: {
          mappingsCount: config.targetCallerMappings.length,
          callDuration: config.callDuration,
          frequency: config.frequency,
          scheduledTime: config.scheduledTime,
          scheduledDay: config.scheduledDay,
          isActive: config.isActive
        },
        req,
      });

      return successResponse(res, config, 'Call automation configuration saved successfully');
    } catch (error) {
      logger.error('[CALL AUTOMATION CONTROLLER] Save config error', { error: error.message });
      next(error);
    }
  }

  /**
   * Get call automation configuration
   * GET /api/call-automation/config
   */
  async getConfig(req, res, next) {
    try {
      // Resolve companyId: checkCompanyAccess middleware > query param > user.companyId
      // For super_admin: checkCompanyAccess passes through, use query param
      // For admin: checkCompanyAccess sets req.companyId = req.user.companyId
      const companyId = req.companyId || req.query.companyId || undefined;
      logger.info('[CALL AUTOMATION CONTROLLER] getConfig request:', {
        userId: req.user._id?.toString(),
        userRole: req.user.role,
        userCompanyId: req.user.companyId?.toString(),
        reqCompanyId: req.companyId?.toString?.() || 'not set',
        queryCompanyId: req.query.companyId?.toString() || 'not provided',
        resolvedCompanyId: companyId?.toString() || 'not resolved',
      });
      const config = await callAutomationService.getConfig(req.user, companyId, req.companyId);

      logger.info('[CALL AUTOMATION CONTROLLER] getConfig response:', {
        configFound: !!config,
        configId: config?._id?.toString(),
        companyId: config?.companyId?.toString(),
        mappingsCount: config?.targetCallerMappings?.length || 0,
      });

      return successResponse(res, config);
    } catch (error) {
      logger.error('[CALL AUTOMATION CONTROLLER] Get config error', { error: error.message });
      next(error);
    }
  }

  /**
   * Toggle automation active status
   * PUT /api/call-automation/toggle
   */
  async toggleActive(req, res, next) {
    try {
      const { isActive } = req.body;
      // Resolve companyId: checkCompanyAccess > query param > user.companyId
      const companyId = req.companyId || req.query.companyId || undefined;
      logger.info('[CALL AUTOMATION CONTROLLER] toggleActive request:', {
        userId: req.user._id?.toString(),
        userRole: req.user.role,
        isActive,
        companyId: companyId?.toString(),
        userCompanyId: req.user.companyId?.toString(),
      });
      const config = await callAutomationService.toggleActive(req.user, isActive, companyId);

      // Audit log
      await auditLogService.logAction({
        action: 'CALL_AUTOMATION_TOGGLE',
        module: 'CALL_AUTOMATION',
        description: `Call automation ${isActive ? 'enabled' : 'disabled'}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: config.companyId,
        entityId: config._id,
        entityType: 'CallAutomationConfig',
        metadata: { isActive },
        req,
      });

      return successResponse(res, config, `Call automation ${isActive ? 'enabled' : 'disabled'} successfully`);
    } catch (error) {
      logger.error('[CALL AUTOMATION CONTROLLER] Toggle error', { error: error.message });
      next(error);
    }
  }

  /**
   * Get eligible SIMs for selection
   * GET /api/call-automation/eligible-sims
   */
  async getEligibleSims(req, res, next) {
    try {
      // Resolve companyId: checkCompanyAccess > query param > user.companyId
      const companyId = req.companyId || req.query.companyId || undefined;
      const sims = await callAutomationService.getEligibleSims(req.user, companyId);
      return successResponse(res, sims);
    } catch (error) {
      logger.error('[CALL AUTOMATION CONTROLLER] Get eligible SIMs error', { error: error.message });
      next(error);
    }
  }

  /**
   * Get device configuration for mobile app
   * GET /api/device/call-config
   * Public endpoint - no JWT required (uses SIM number for auth)
   */
  async getDeviceConfig(req, res, next) {
    try {
      const { simNumber } = req.query;

      if (!simNumber) {
        return successResponse(res, {
          role: 'NONE',
          targets: [],
          callDuration: 10,
          frequency: 'daily',
          isActive: false,
        });
      }

      const config = await callAutomationService.getDeviceConfig(simNumber);

      return successResponse(res, config);
    } catch (error) {
      logger.error('[CALL AUTOMATION CONTROLLER] Get device config error', { error: error.message });
      next(error);
    }
  }

  /**
   * Update last run timestamp (called by mobile app)
   * POST /api/device/call-complete
   */
  async updateLastRun(req, res, next) {
    try {
      const { configId, simNumber, successCount, failCount, results } = req.body;

      logger.info('[CALL AUTOMATION CONTROLLER] Call complete notification received', {
        configId,
        simNumber,
        successCount,
        failCount,
        resultsCount: results?.length || 0
      });

      if (!configId) {
        return successResponse(res, { success: false, message: 'configId is required' });
      }

      const result = await callAutomationService.updateLastRun(configId, {
        simNumber,
        successCount: successCount || 0,
        failCount: failCount || 0,
        results
      });

      return successResponse(res, {
        success: true,
        data: {
          lastRunAt: result.lastRunAt,
          nextRunAt: result.nextRunAt
        }
      });
    } catch (error) {
      logger.error('[CALL AUTOMATION CONTROLLER] Update last run error', { error: error.message });
      next(error);
    }
  }

  /**
   * Add a new target-caller mapping
   * POST /api/call-automation/mapping
   */
  async addTargetMapping(req, res, next) {
    try {
      const { targetSimId, callerSimIds, callDuration } = req.body;

      // Resolve companyId: checkCompanyAccess middleware > query/body > user.companyId
      const companyId = req.companyId || req.query.companyId || req.body.companyId || undefined;

      logger.info('[CALL AUTOMATION CONTROLLER] Add target mapping request:', {
        targetSimId,
        callerSimIds,
        callDuration,
        callersCount: callerSimIds?.length || 0,
        userId: req.user._id?.toString(),
        userRole: req.user.role,
        userCompanyId: req.user.companyId?.toString(),
        resolvedCompanyId: companyId?.toString(),
      });

      const config = await callAutomationService.addTargetMapping(req.user, {
        targetSimId,
        callerSimIds,
        callDuration
      }, companyId);

      // Audit log
      await auditLogService.logAction({
        action: 'CALL_AUTOMATION_MAPPING_ADD',
        module: 'CALL_AUTOMATION',
        description: `Added target-caller mapping`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: config.companyId,
        entityId: config._id,
        entityType: 'CallAutomationConfig',
        metadata: { targetSimId, callersCount: callerSimIds?.length },
        req,
      });

      return successResponse(res, config, 'Target mapping added successfully');
    } catch (error) {
      logger.error('[CALL AUTOMATION CONTROLLER] Add mapping error', { error: error.message });
      next(error);
    }
  }

  /**
   * Delete call automation configuration
   * DELETE /api/call-automation/config
   */
  async deleteConfig(req, res, next) {
    try {
      // Resolve companyId: checkCompanyAccess middleware > query > user.companyId
      const companyId = req.companyId || req.query.companyId || undefined;

      logger.info('[CALL AUTOMATION CONTROLLER] Delete config request:', {
        userId: req.user._id?.toString(),
        userRole: req.user.role,
        companyId: companyId?.toString(),
        userCompanyId: req.user.companyId?.toString(),
        reqCompanyId: req.companyId?.toString?.() || 'not set',
      });

      const result = await callAutomationService.deleteConfig(req.user, companyId);

      // Audit log
      await auditLogService.logAction({
        action: 'CALL_AUTOMATION_CONFIG_DELETE',
        module: 'CALL_AUTOMATION',
        description: 'Deleted call automation configuration',
        performedBy: req.user._id,
        role: req.user.role,
        companyId: companyId || req.user.companyId,
        req,
      });

      return successResponse(res, null, result.message);
    } catch (error) {
      logger.error('[CALL AUTOMATION CONTROLLER] Delete config error', { error: error.message });
      next(error);
    }
  }

  /**
   * Remove a target-caller mapping
   * DELETE /api/call-automation/mapping/:targetSimId
   */
  async removeTargetMapping(req, res, next) {
    try {
      const { targetSimId } = req.params;

      // Resolve companyId: checkCompanyAccess middleware > query > user.companyId
      const companyId = req.companyId || req.query.companyId || undefined;

      logger.info('[CALL AUTOMATION CONTROLLER] Remove target mapping request:', {
        targetSimId,
        userId: req.user._id?.toString(),
        userRole: req.user.role,
        companyId: companyId?.toString(),
        companyIdType: typeof companyId,
        userCompanyId: req.user.companyId?.toString(),
        reqCompanyId: req.companyId?.toString?.() || 'not set',
      });

      const config = await callAutomationService.removeTargetMapping(req.user, targetSimId, companyId);

      // Audit log
      await auditLogService.logAction({
        action: 'CALL_AUTOMATION_MAPPING_REMOVE',
        module: 'CALL_AUTOMATION',
        description: `Removed target-caller mapping`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: config.companyId,
        entityId: config._id,
        entityType: 'CallAutomationConfig',
        metadata: { targetSimId },
        req,
      });

      return successResponse(res, config, 'Target mapping removed successfully');
    } catch (error) {
      logger.error('[CALL AUTOMATION CONTROLLER] Remove mapping error', { error: error.message });
      next(error);
    }
  }

  /**
   * Get call attempt history for the authenticated user's company
   * GET /api/call-automation/call-attempts?page=1&limit=50&status=connected
   */
  async getCallAttempts(req, res, next) {
    try {
      const callAttemptController = require('../callAttempt/callAttempt.controller');
      return callAttemptController.getCallAttempts(req, res, next);
    } catch (error) {
      logger.error('[CALL AUTOMATION CONTROLLER] Error delegating to call attempt controller:', error);
      next(error);
    }
  }

  /**
   * Get connection status for each target SIM in the authenticated user's company
   * GET /api/call-automation/connection-status
   */
  async getConnectionStatus(req, res, next) {
    try {
      const callAttemptController = require('../callAttempt/callAttempt.controller');
      return callAttemptController.getConnectionStatus(req, res, next);
    } catch (error) {
      logger.error('[CALL AUTOMATION CONTROLLER] Error delegating to call attempt controller:', error);
      next(error);
    }
  }
}

module.exports = new CallAutomationController();