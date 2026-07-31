const cameraAlertService = require('../../services/cctv/cameraAlert.service');
const { successResponse, paginatedResponse } = require('../../utils/response');

class CameraAlertController {
  async getAll(req, res, next) {
    try {
      const result = await cameraAlertService.getAllAlerts(req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async getByCamera(req, res, next) {
    try {
      const result = await cameraAlertService.getByCamera(req.params.cameraId, req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async acknowledge(req, res, next) {
    try {
      const alert = await cameraAlertService.acknowledgeAlert(req.params.id, req.user);
      return successResponse(res, alert, 'Alert acknowledged successfully');
    } catch (error) {
      next(error);
    }
  }

  async resolve(req, res, next) {
    try {
      const alert = await cameraAlertService.resolveAlert(
        req.params.id,
        req.user,
        req.body.resolutionNote
      );
      return successResponse(res, alert, 'Alert resolved successfully');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new CameraAlertController();