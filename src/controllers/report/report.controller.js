const reportService = require('../../services/report/report.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { reportResponse } = require('../../utils/response');
const xlsx = require('xlsx');

class ReportController {
  async generateSimReport(req, res, next) {
    try {
      const result = await reportService.generateSimReport(req.query, req.user);
      const isExport = req.query.format === 'excel' || req.query.format === 'csv' || req.query.download === 'true';

      // Only log when user actually downloads/exports, not when just viewing
      if (isExport) {
        // Audit log: REPORT_DOWNLOAD for exports only
        await auditLogService.logAction({
          action: 'REPORT_DOWNLOAD',
          module: 'REPORT',
          description: `Downloaded SIM report (${result.total} records)`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          metadata: { type: 'sim', count: result.total, format: req.query.format || 'excel' },
          req,
        });

        if (req.query.format === 'csv') {
          const csv = await reportService.exportToCsv(result.data, 'sims');
          res.setHeader('Content-Disposition', 'attachment; filename=sim-report.csv');
          res.setHeader('Content-Type', 'text/csv');
          res.send(csv);
        } else {
          const workbook = await reportService.exportToExcel(result, 'sims');
          const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
          res.setHeader('Content-Disposition', 'attachment; filename=sim-report.xlsx');
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.send(buffer);
        }
      } else {
        return reportResponse(
          res,
          result.data,
          result.summary,
          result.total,
          result.page,
          result.limit,
          'SIM report generated successfully'
        );
      }
    } catch (error) {
      next(error);
    }
  }

  async generateRechargeReport(req, res, next) {
    try {
      const result = await reportService.generateRechargeReport(req.query, req.user);
      const isExport = req.query.format === 'excel' || req.query.format === 'csv' || req.query.download === 'true';

      // Only log when user actually downloads/exports, not when just viewing
      if (isExport) {
        // Audit log: REPORT_DOWNLOAD for exports only
        await auditLogService.logAction({
          action: 'REPORT_DOWNLOAD',
          module: 'REPORT',
          description: `Downloaded Recharge report (${result.total} records)`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          metadata: { type: 'recharge', count: result.total, format: req.query.format || 'excel' },
          req,
        });

        if (req.query.format === 'csv') {
          const csv = await reportService.exportToCsv(result.data, 'recharges');
          res.setHeader('Content-Disposition', 'attachment; filename=recharge-report.csv');
          res.setHeader('Content-Type', 'text/csv');
          res.send(csv);
        } else {
          const workbook = await reportService.exportToExcel(result, 'recharges');
          const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
          res.setHeader('Content-Disposition', 'attachment; filename=recharge-report.xlsx');
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.send(buffer);
        }
      } else {
        return reportResponse(
          res,
          result.data,
          result.summary,
          result.total,
          result.page,
          result.limit,
          'Recharge report generated successfully'
        );
      }
    } catch (error) {
      next(error);
    }
  }

  async generateCallLogReport(req, res, next) {
    try {
      const result = await reportService.generateCallLogReport(req.query, req.user);
      const isExport = req.query.format === 'excel' || req.query.format === 'csv' || req.query.download === 'true';

      // Only log when user actually downloads/exports, not when just viewing
      if (isExport) {
        // Audit log: REPORT_DOWNLOAD for exports only
        await auditLogService.logAction({
          action: 'REPORT_DOWNLOAD',
          module: 'REPORT',
          description: `Downloaded Call Log report (${result.total} records)`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          metadata: { type: 'callLog', count: result.total, format: req.query.format || 'excel' },
          req,
        });

        if (req.query.format === 'csv') {
          const csv = await reportService.exportToCsv(result.data, 'callLogs');
          res.setHeader('Content-Disposition', 'attachment; filename=call-log-report.csv');
          res.setHeader('Content-Type', 'text/csv');
          res.send(csv);
        } else {
          const workbook = await reportService.exportToExcel(result, 'callLogs');
          const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
          res.setHeader('Content-Disposition', 'attachment; filename=call-log-report.xlsx');
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.send(buffer);
        }
      } else {
        return reportResponse(
          res,
          result.data,
          result.summary,
          result.total,
          result.page,
          result.limit,
          'Call log report generated successfully'
        );
      }
    } catch (error) {
      next(error);
    }
  }

  async generateCompanyReport(req, res, next) {
    try {
      // Super admin only
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const result = await reportService.generateCompanyReport(req.query);
      const isExport = req.query.format === 'excel' || req.query.format === 'csv' || req.query.download === 'true';

      // Only log when user actually downloads/exports, not when just viewing
      if (isExport) {
        // Audit log: REPORT_DOWNLOAD for exports only
        await auditLogService.logAction({
          action: 'REPORT_DOWNLOAD',
          module: 'REPORT',
          description: `Downloaded Company report (${result.total} records)`,
          performedBy: req.user._id,
          role: req.user.role,
          metadata: { type: 'company', count: result.total, format: req.query.format || 'excel' },
          req,
        });

        if (req.query.format === 'csv') {
          const csv = await reportService.exportToCsv(result.data, 'companies');
          res.setHeader('Content-Disposition', 'attachment; filename=company-report.csv');
          res.setHeader('Content-Type', 'text/csv');
          res.send(csv);
        } else {
          const workbook = await reportService.exportToExcel(result, 'companies');
          const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
          res.setHeader('Content-Disposition', 'attachment; filename=company-report.xlsx');
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.send(buffer);
        }
      } else {
        return reportResponse(
          res,
          result.data,
          result.summary,
          result.total,
          result.page,
          result.limit,
          'Company report generated successfully'
        );
      }
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ReportController();