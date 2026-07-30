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
      logger.info(`[Test Report] API called by user=${req.user.email} (id=${req.user._id}, companyId=${req.user.companyId})`);
      const result = await reportScheduleService.sendTestReport(req.user);
      logger.info(`[Test Report] API response: success=${result.success}, message="${result.message}"`);
      return successResponse(res, null, result.message);
    } catch (error) {
      logger.error(`[Test Report] API error for user=${req.user?.email}: ${error.message}`, { stack: error.stack });
      next(error);
    }
  }

  // Debug endpoint: test SMTP connection and email delivery without schedule
  async debugEmail(req, res, next) {
    try {
      const emailService = require('../../utils/emailService');
      const logger = require('../../utils/logger');

      logger.info(`[Debug Email] SMTP diagnostic requested by user=${req.user.email}`);

      // Check if email service is configured
      const isConfigured = emailService.isConfigured;
      const isConnected = emailService.connectionVerified;

      logger.info(`[Debug Email] Email service configured: ${isConfigured}, connection verified: ${isConnected}`);

      if (!isConfigured) {
        return res.json({
          success: false,
          step: 'configuration',
          error: 'Email service is NOT configured. Check SMTP_HOST, SMTP_USER, SMTP_PASS in .env',
          isConfigured,
          isConnected,
        });
      }

      // Try to verify connection
      let verifyResult = null;
      try {
        verifyResult = await emailService.verifyConnection();
        logger.info(`[Debug Email] Connection verify result: ${verifyResult}`);
      } catch (verifyErr) {
        logger.error(`[Debug Email] Connection verify error: ${verifyErr.message}`);
        verifyResult = { error: verifyErr.message };
      }

      // Try to send a simple test email
      const testEmail = req.body?.testEmail || req.user.email;
      let sendResult = null;
      try {
        sendResult = await emailService.sendEmail({
          to: testEmail,
          subject: '[DEBUG] SMTP Test — Report Schedule Diagnostic',
          html: `<h2>SMTP Test Email</h2><p>This is a diagnostic email sent at ${new Date().toISOString()}.</p><p>If you received this, SMTP is working correctly.</p>`,
        });
        logger.info(`[Debug Email] Test email send result: success=${sendResult.success}, messageId=${sendResult.messageId || 'N/A'}`);
      } catch (sendErr) {
        sendResult = { success: false, error: sendErr.message, stack: sendErr.stack };
        logger.error(`[Debug Email] Test email send error: ${sendErr.message}`);
      }

      return res.json({
        success: sendResult?.success || false,
        step: sendResult?.success ? 'email_sent' : 'send_failed',
        isConfigured,
        isConnected,
        connectionVerified: verifyResult,
        testEmailSent: sendResult?.success || false,
        testEmailMessageId: sendResult?.messageId || null,
        testEmailError: sendResult?.error || null,
        testEmailRecipient: testEmail,
        smtpConfig: {
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT || 587,
          user: process.env.SMTP_USER ? `${process.env.SMTP_USER.substring(0, 5)}***` : 'NOT SET',
          passSet: !!process.env.SMTP_PASS,
          from: process.env.EMAIL_FROM,
        },
      });
    } catch (error) {
      logger.error(`[Debug Email] Unhandled error: ${error.message}`, { stack: error.stack });
      next(error);
    }
  }
}

module.exports = new ReportScheduleController();