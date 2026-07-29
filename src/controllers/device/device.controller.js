const deviceService = require('../../services/device/device.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

class DeviceController {
  /**
   * Auto-authenticate device using SIM number
   * POST /api/device/auto-auth
   * Public endpoint (no JWT required) - uses SIM number for authentication
   */
  async autoAuth(req, res, next) {
    try {
      const { simNumber, deviceId } = req.body;
      const result = await deviceService.autoAuth({ simNumber, deviceId });

      // Audit log: DEVICE_AUTH
      await auditLogService.logAction({
        action: 'DEVICE_AUTH',
        module: 'DEVICE',
        description: `Device authenticated for SIM ${result.mobileNumber}`,
        performedBy: null,
        role: 'system',
        companyId: result.companyId,
        entityId: result.simId,
        entityType: 'Sim',
        metadata: {
          deviceId,
          mobileNumber: result.mobileNumber,
          wifiCount: result.wifiConfig.length
        },
        req,
      });

      return successResponse(res, result, 'Device authenticated successfully', 200);
    } catch (error) {
      logger.error('[DEVICE CONTROLLER] Auto-auth error', { error: error.message });
      next(error);
    }
  }

  /**
   * Submit WiFi metrics from device
   * POST /api/wifi/metrics
   * Public endpoint (no JWT required) - uses device token for authentication
   */
  async submitMetrics(req, res, next) {
    try {
      const result = await deviceService.submitMetrics(req.body);

      return successResponse(res, result, 'Metrics stored successfully', 201);
    } catch (error) {
      logger.error('[DEVICE CONTROLLER] Submit metrics error', { error: error.message });
      next(error);
    }
  }

  /**
   * Validate device token
   * GET /api/device/validate
   */
  async validateDevice(req, res, next) {
    try {
      const { simNumber, deviceId, deviceToken } = req.query;
      const result = await deviceService.validateDevice({
        simNumber,
        deviceId,
        deviceToken
      });

      return successResponse(res, result, 'Device validated successfully');
    } catch (error) {
      logger.error('[DEVICE CONTROLLER] Validate device error', { error: error.message });
      next(error);
    }
  }

  /**
   * Refresh device token
   * POST /api/device/refresh-token
   */
  async refreshToken(req, res, next) {
    try {
      const result = await deviceService.refreshToken(req.body);

      return successResponse(res, result, 'Token refreshed successfully');
    } catch (error) {
      logger.error('[DEVICE CONTROLLER] Refresh token error', { error: error.message });
      next(error);
    }
  }
}

module.exports = new DeviceController();