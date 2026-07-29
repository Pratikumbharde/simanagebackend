const dashboardService = require('../../services/dashboard/dashboard.service');
const { successResponse } = require('../../utils/response');

class DashboardController {
  async getOverview(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const overview = await dashboardService.getOverview(companyId);
      return successResponse(res, overview);
    } catch (error) {
      next(error);
    }
  }

  async getSimStats(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const stats = await dashboardService.getSimStats(companyId);
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }

  async getRechargeStats(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const { period } = req.query;
      const stats = await dashboardService.getRechargeStats(companyId, period);
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }

  async getCallStats(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const { period } = req.query;
      const stats = await dashboardService.getCallStats(companyId, period);
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }

  async getMonthlyReport(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const month = parseInt(req.query.month) || new Date().getMonth() + 1;
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const report = await dashboardService.getMonthlyReport(companyId, month, year);
      return successResponse(res, report);
    } catch (error) {
      next(error);
    }
  }

  async getSuperAdminOverview(req, res, next) {
    try {
      const overview = await dashboardService.getSuperAdminOverview();
      return successResponse(res, overview);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DashboardController();