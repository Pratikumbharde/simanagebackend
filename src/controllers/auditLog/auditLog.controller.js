const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, paginatedResponse } = require('../../utils/response');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const mongoose = require('mongoose');

class AuditLogController {
  /**
   * Get all audit logs with filters
   * GET /api/audit-logs
   */
  async getAll(req, res, next) {
    try {
      const result = await auditLogService.getLogs(req.query, req.user);

      return paginatedResponse(
        res,
        result.data,
        result.total,
        result.page,
        result.limit
      );
    } catch (error) {
      logger.error('Error fetching audit logs', { error: error.message });
      next(error);
    }
  }

  /**
   * Get single audit log by ID
   * GET /api/audit-logs/:id
   */
  async getById(req, res, next) {
    try {
      const { id } = req.params;

      if (!id) {
        throw new BadRequestError('Log ID is required');
      }

      const log = await auditLogService.getLogById(id, req.user);

      if (!log) {
        throw new NotFoundError('Audit log');
      }

      return successResponse(res, log);
    } catch (error) {
      logger.error('Error fetching audit log by ID', { error: error.message });
      next(error);
    }
  }

  /**
   * Get audit log statistics
   * GET /api/audit-logs/stats
   */
  async getStats(req, res, next) {
    try {
      const stats = await auditLogService.getStats(req.query, req.user);
      return successResponse(res, stats);
    } catch (error) {
      logger.error('Error fetching audit log stats', { error: error.message });
      next(error);
    }
  }

  /**
   * Get available modules
   * GET /api/audit-logs/modules
   */
  async getModules(req, res, next) {
    try {
      let modules = auditLogService.getAllModules();
      // [AUDIT LOG FIX] - Hide SUBSCRIPTION module from non-super_admin users
      if (req.user && req.user.role !== 'super_admin') {
        modules = modules.filter(m => m !== 'SUBSCRIPTION');
      }
      return successResponse(res, { modules });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get available actions for a module
   * GET /api/audit-logs/actions/:module
   */
  async getActions(req, res, next) {
    try {
      const { module } = req.params;
      // [AUDIT LOG FIX] - Hide SUBSCRIPTION module actions from non-super_admin users
      if (module && module.toUpperCase() === 'SUBSCRIPTION' && req.user && req.user.role !== 'super_admin') {
        return successResponse(res, { actions: [] });
      }
      let actions = auditLogService.getModuleActions(module);
      // [AUDIT LOG FIX] - Hide CONTENT_UPDATE action from non-super_admin users
      if (req.user && req.user.role !== 'super_admin' && actions.includes('CONTENT_UPDATE')) {
        actions = actions.filter(a => a !== 'CONTENT_UPDATE');
      }
      return successResponse(res, { actions });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Export audit logs
   * GET /api/audit-logs/export
   */
  async export(req, res, next) {
    try {
      const xlsx = require('xlsx');
      const { startDate, endDate, module, action } = req.query;

      // Build filters
      const filters = {};
      if (module) filters.module = module;
      if (action) filters.action = action;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;

      // Apply role-based filtering
      // [AUDIT LOG FIX] - Convert companyId to ObjectId for proper comparison
      if (req.user.role !== 'super_admin') {
        // Admin and Company Admin can only export their company's logs
        if (!req.user.companyId) {
          return res.status(403).json({ success: false, message: 'No company assigned' });
        }
        filters.companyId = req.user.companyId instanceof mongoose.Types.ObjectId
          ? req.user.companyId
          : new mongoose.Types.ObjectId(req.user.companyId);
      }

      // Get all matching logs (up to 10000)
      const result = await auditLogService.getLogs(
        { ...filters, limit: 10000 },
        req.user
      );

      // Prepare data for export
      const data = result.data.map((log) => ({
        'Date & Time': log.createdAt ? new Date(log.createdAt).toLocaleString('en-IN') : '',
        'Action': log.action,
        'Module': log.module,
        'User': log.performedBy?.name || log.metadata?.mobileNumber || 'System',
        'Description': log.description,
        'Role': log.role,
        'Company': log.companyId?.name || 'N/A',
        'Email': log.performedBy?.email || (log.metadata?.mobileNumber ? 'Mobile User' : ''),
      }));

      // Create workbook
      const workbook = xlsx.utils.book_new();
      const sheet = xlsx.utils.json_to_sheet(data);

      // Set column widths
      sheet['!cols'] = [
        { wch: 20 }, // Date/Time
        { wch: 20 }, // Action
        { wch: 12 }, // Module
        { wch: 20 }, // User
        { wch: 50 }, // Description
        { wch: 12 }, // Role
        { wch: 20 }, // Company
        { wch: 25 }, // Email
      ];

      xlsx.utils.book_append_sheet(workbook, sheet, 'Audit Logs');

      // Write to buffer
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      // Generate filename
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `audit-logs-export-${dateStr}.xlsx`;

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);

      // Log the export action
      await auditLogService.logAction({
        action: 'REPORT_EXPORT',
        module: 'REPORT',
        description: `Exported audit logs (${result.data.length} records)`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: req.user.companyId,
        req,
      });
    } catch (error) {
      logger.error('Error exporting audit logs', { error: error.message });
      next(error);
    }
  }
}

module.exports = new AuditLogController();