const callLogService = require('../../services/callLog/callLog.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, paginatedResponse } = require('../../utils/response');
// [PHONE NORMALIZATION FIX]
const { normalizePhoneNumber } = require('../../utils/response');
const logger = require('../../utils/logger');
const xlsx = require('xlsx');

class CallLogController {
  async sync(req, res, next) {
    try {
      const { simId, callLogs } = req.body;
      const deviceId = req.headers['x-device-id'] || 'web';
      const result = await callLogService.syncCallLogs({ simId, callLogs }, req.user, deviceId);

      // Audit log: CALL_LOG_SYNC
      try {
        await auditLogService.logAction({
          action: 'CALL_LOG_SYNC',
          module: 'CALL_LOG',
          description: `Synced ${result.synced || 0} call logs`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: simId,
          entityType: 'SIM',
          metadata: { synced: result.synced || 0, duplicates: result.duplicates || 0, deviceId },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log CALL_LOG_SYNC', { error: auditError.message });
      }

      return successResponse(res, result, 'Call logs synced successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * [MULTI-SIM SUPPORT] - Sync call logs for logged-in user's assigned SIMs
   * Validates SIM ownership before saving
   * POST /api/call-logs/sync-user
   */
  async syncUserLogs(req, res, next) {
    try {
      const { simNumber, callLogs } = req.body;
      const deviceId = req.headers['x-device-id'] || req.body.deviceId || 'mobile';

      if (!simNumber) {
        return res.status(400).json({
          success: false,
          message: 'SIM number is required',
        });
      }

      if (!callLogs || !Array.isArray(callLogs) || callLogs.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Call logs array is required',
        });
      }

      const result = await callLogService.syncCallLogsForUser(
        { simNumber, callLogs },
        req.user,
        deviceId
      );

      // Audit log: CALL_LOG_SYNC
      try {
        await auditLogService.logAction({
          action: 'CALL_LOG_SYNC',
          module: 'CALL_LOG',
          description: `Synced ${result.synced || 0} call logs for SIM ${simNumber}`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityType: 'SIM',
          metadata: { simNumber, synced: result.synced || 0, duplicates: result.duplicates || 0, deviceId },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log CALL_LOG_SYNC', { error: auditError.message });
      }

      return successResponse(res, result, 'Call logs synced successfully');
    } catch (error) {
      logger.error('[CALL LOG SYNC] Error syncing user logs', {
        error: error.message,
        userId: req.user?._id,
      });
      next(error);
    }
  }

  /**
   * Sync call logs from mobile device without JWT authentication
   * Public endpoint - uses Contact Number from header/body for identification
   */
  async deviceSync(req, res, next) {
    try {
      const { mobileNumber, callLogs } = req.body;
      const deviceId = req.headers['x-device-id'] || req.body.deviceId || 'mobile-device';

      const result = await callLogService.deviceSync({ mobileNumber, callLogs }, deviceId);

      // Audit log: CALL_LOG_SYNC (device - no user)
      try {
        await auditLogService.logAction({
          action: 'CALL_LOG_SYNC',
          module: 'CALL_LOG',
          description: `Device synced ${result.synced || 0} call logs for ${mobileNumber}`,
          role: 'device',
          entityType: 'SIM',
          metadata: { mobileNumber, synced: result.synced || 0, deviceId },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log CALL_LOG_SYNC', { error: auditError.message });
      }

      return successResponse(res, result, 'Call logs synced successfully');
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const result = await callLogService.getCallLogs(req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const callLog = await callLogService.getCallLogById(req.params.id, req.user);
      return successResponse(res, callLog);
    } catch (error) {
      next(error);
    }
  }

  async getStats(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const { startDate, endDate, simId, callType, phoneNumber } = req.query;
      const filters = { simId, callType, phoneNumber };
      const stats = await callLogService.getCallStats(companyId, startDate, endDate, filters);
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }

  async getSimStats(req, res, next) {
    try {
      const { simId } = req.params;
      const { startDate, endDate } = req.query;
      const stats = await callLogService.getSimCallStats(simId, startDate, endDate);
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }

  async export(req, res, next) {
    try {
      const callLogs = await callLogService.exportCallLogs(req.query, req.user);

      const workbook = xlsx.utils.book_new();
      const data = callLogs.map((log) => ({
        'Phone Number': log.phoneNumber,
        'Call Type': log.callType,
        'Duration (s)': log.duration,
        'Timestamp': log.timestamp.toISOString(),
        'SIM': log.simId?.mobileNumber || 'N/A',
        'Contact Name': log.contactName || '',
      }));

      const sheet = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(workbook, sheet, 'Call Logs');

      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      // Audit log: CALL_LOG_EXPORT
      try {
        await auditLogService.logAction({
          action: 'CALL_LOG_EXPORT',
          module: 'CALL_LOG',
          description: `Exported ${callLogs.length} call logs to Excel`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          metadata: { count: callLogs.length, filters: req.query },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log CALL_LOG_EXPORT', { error: auditError.message });
      }

      res.setHeader('Content-Disposition', 'attachment; filename=call-logs-export.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }

  async flag(req, res, next) {
    try {
      const { flagged, reason } = req.body;
      const callLog = await callLogService.flagCallLog(req.params.id, flagged, reason, req.user);

      // Audit log: CALL_LOG_FLAG
      try {
        await auditLogService.logAction({
          action: 'CALL_LOG_FLAG',
          module: 'CALL_LOG',
          description: `${flagged ? 'Flagged' : 'Unflagged'} call log ${req.params.id}`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: req.params.id,
          entityType: 'CALL_LOG',
          metadata: { flagged, reason: reason || null },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log CALL_LOG_FLAG', { error: auditError.message });
      }

      return successResponse(res, callLog, 'Call log flagged');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new CallLogController();