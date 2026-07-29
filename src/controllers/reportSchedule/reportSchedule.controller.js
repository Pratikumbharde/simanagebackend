const reportScheduleService = require('../../services/reportSchedule/reportSchedule.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

class ReportScheduleController {
  async getAll(req, res, next) {
    try {
      const result = await reportScheduleService.getAll(req.query, req.user);
      return successResponse(res, result.data, 'Schedules retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const schedule = await reportScheduleService.getById(req.params.id, req.user);
      return successResponse(res, schedule);
    } catch (error) {
      next(error);
    }
  }

  async create(req, res, next) {
    try {
      const schedule = await reportScheduleService.create(req.body, req.user);

      // Audit log
      try {
        await auditLogService.logAction({
          action: 'REPORT_SCHEDULE_CREATE',
          module: 'SETTINGS',
          description: `Created report schedule for ${schedule.email}`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: schedule._id,
          entityType: 'REPORT_SCHEDULE',
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log REPORT_SCHEDULE_CREATE', { error: auditError.message });
      }

      return successResponse(res, schedule, 'Report schedule created successfully');
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const schedule = await reportScheduleService.update(req.params.id, req.body, req.user);

      // Audit log
      try {
        await auditLogService.logAction({
          action: 'REPORT_SCHEDULE_UPDATE',
          module: 'SETTINGS',
          description: `Updated report schedule for ${schedule.email}`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: schedule._id,
          entityType: 'REPORT_SCHEDULE',
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log REPORT_SCHEDULE_UPDATE', { error: auditError.message });
      }

      return successResponse(res, schedule, 'Report schedule updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async toggle(req, res, next) {
    try {
      const schedule = await reportScheduleService.toggle(req.params.id, req.user);

      // Audit log
      try {
        await auditLogService.logAction({
          action: 'REPORT_SCHEDULE_TOGGLE',
          module: 'SETTINGS',
          description: `${schedule.isActive ? 'Enabled' : 'Disabled'} report schedule for ${schedule.email}`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: schedule._id,
          entityType: 'REPORT_SCHEDULE',
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log REPORT_SCHEDULE_TOGGLE', { error: auditError.message });
      }

      return successResponse(res, schedule, `Report schedule ${schedule.isActive ? 'enabled' : 'disabled'} successfully`);
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      const result = await reportScheduleService.delete(req.params.id, req.user);

      // Audit log
      try {
        await auditLogService.logAction({
          action: 'REPORT_SCHEDULE_DELETE',
          module: 'SETTINGS',
          description: `Deleted report schedule ${req.params.id}`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: req.params.id,
          entityType: 'REPORT_SCHEDULE',
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log REPORT_SCHEDULE_DELETE', { error: auditError.message });
      }

      return successResponse(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }

  async sendTest(req, res, next) {
    try {
      const result = await reportScheduleService.sendTestReport(req.user);
      return successResponse(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ReportScheduleController();