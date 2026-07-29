const statusService = require('../../services/status/status.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

class StatusController {
  async getStatus(req, res, next) {
    try {
      const status = await statusService.getStatus(req.params.simId, req.user);
      return successResponse(res, status);
    } catch (error) {
      next(error);
    }
  }

  async updateWhatsApp(req, res, next) {
    try {
      const { enabled } = req.body;
      const status = await statusService.updateWhatsAppStatus(req.params.simId, enabled, req.user);

      // Audit log: SIM_MESSAGING_UPDATE
      try {
        await auditLogService.logAction({
          action: 'SIM_MESSAGING_UPDATE',
          module: 'SIM',
          description: `WhatsApp ${enabled ? 'enabled' : 'disabled'} for SIM ${req.params.simId}`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: req.params.simId,
          entityType: 'SIM',
          metadata: { platform: 'whatsapp', enabled },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log SIM_MESSAGING_UPDATE', { error: auditError.message });
      }

      return successResponse(res, status, 'WhatsApp status updated');
    } catch (error) {
      next(error);
    }
  }

  async updateTelegram(req, res, next) {
    try {
      const { enabled } = req.body;
      const status = await statusService.updateTelegramStatus(req.params.simId, enabled, req.user);

      // Audit log: SIM_MESSAGING_UPDATE
      try {
        await auditLogService.logAction({
          action: 'SIM_MESSAGING_UPDATE',
          module: 'SIM',
          description: `Telegram ${enabled ? 'enabled' : 'disabled'} for SIM ${req.params.simId}`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: req.params.simId,
          entityType: 'SIM',
          metadata: { platform: 'telegram', enabled },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log SIM_MESSAGING_UPDATE', { error: auditError.message });
      }

      return successResponse(res, status, 'Telegram status updated');
    } catch (error) {
      next(error);
    }
  }

  async getHistory(req, res, next) {
    try {
      const history = await statusService.getStatusHistory(req.params.simId, req.user);
      return successResponse(res, history);
    } catch (error) {
      next(error);
    }
  }

  async bulkUpdate(req, res, next) {
    try {
      const { simIds, platform, enabled } = req.body;
      const result = await statusService.bulkUpdateStatus(simIds, platform, enabled, req.user);

      // Audit log: SIM_MESSAGING_UPDATE (bulk)
      try {
        await auditLogService.logAction({
          action: 'SIM_MESSAGING_UPDATE',
          module: 'SIM',
          description: `Bulk ${platform} ${enabled ? 'enabled' : 'disabled'} for ${result.modified || simIds.length} SIMs`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          metadata: {
            platform,
            enabled,
            count: result.modified || simIds.length,
            bulk: true
          },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log SIM_MESSAGING_UPDATE', { error: auditError.message });
      }

      return successResponse(res, result, 'Bulk status updated');
    } catch (error) {
      next(error);
    }
  }

  async getOverview(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const overview = await statusService.getAllStatusOverview(companyId);
      return successResponse(res, overview);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new StatusController();