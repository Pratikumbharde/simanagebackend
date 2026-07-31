const dashboardService = require('../../services/cctv/dashboard.service');
const { successResponse } = require('../../utils/response');

class DashboardController {
  async getStats(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const stats = await dashboardService.getDashboardStats(companyId);
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }

  async getRecentSnapshots(req, res, next) {
    try {
      const companyId = req.user.role === 'super_admin' ? req.query.companyId : req.user.companyId;
      const limit = parseInt(req.query.limit) || 5;
      const snapshots = await dashboardService.getRecentSnapshots(companyId, limit);
      return successResponse(res, snapshots);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DashboardController();