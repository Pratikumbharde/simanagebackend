const wifiService = require('../../services/wifi/wifi.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, paginatedResponse } = require('../../utils/response');

class WifiController {
  // ==================== WIFI NETWORK ENDPOINTS ====================

  async createNetwork(req, res, next) {
    try {
      const network = await wifiService.createWifiNetwork(req.body, req.user);

      // Audit log: WIFI_NETWORK_CREATE
      await auditLogService.logAction({
        action: 'WIFI_NETWORK_CREATE',
        module: 'WIFI',
        description: `Created WiFi network "${network.wifiName}"`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: network.companyId,
        entityId: network._id,
        entityType: 'WifiNetwork',
        metadata: { wifiName: network.wifiName, expectedSpeed: network.expectedSpeed },
        req,
      });

      return successResponse(res, network, 'WiFi network created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  async getNetworks(req, res, next) {
    try {
      const result = await wifiService.getWifiNetworks(req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async getNetworkById(req, res, next) {
    try {
      const network = await wifiService.getWifiNetworkById(req.params.id, req.user);
      return successResponse(res, network);
    } catch (error) {
      next(error);
    }
  }

  async updateNetwork(req, res, next) {
    try {
      const network = await wifiService.updateWifiNetwork(req.params.id, req.body, req.user);

      // Audit log: WIFI_NETWORK_UPDATE
      // Exclude password from audit log for security
      const { password, ...auditData } = req.body;
      await auditLogService.logAction({
        action: 'WIFI_NETWORK_UPDATE',
        module: 'WIFI',
        description: `Updated WiFi network "${network.wifiName}"`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: network.companyId,
        entityId: network._id,
        entityType: 'WifiNetwork',
        metadata: { wifiName: network.wifiName, changes: auditData },
        req,
      });

      return successResponse(res, network, 'WiFi network updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async deleteNetwork(req, res, next) {
    try {
      await wifiService.deleteWifiNetwork(req.params.id, req.user);

      // Audit log: WIFI_NETWORK_DELETE
      await auditLogService.logAction({
        action: 'WIFI_NETWORK_DELETE',
        module: 'WIFI',
        description: `Deleted WiFi network ${req.params.id}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: req.user.companyId,
        entityId: req.params.id,
        entityType: 'WifiNetwork',
        req,
      });

      return successResponse(res, null, 'WiFi network deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // ==================== WIFI DEVICE ENDPOINTS ====================

  async registerDevice(req, res, next) {
    try {
      const device = await wifiService.registerDevice(req.body);

      return successResponse(res, device, 'Device registered successfully. Waiting for admin approval.', 201);
    } catch (error) {
      next(error);
    }
  }

  async getDeviceStatus(req, res, next) {
    try {
      const status = await wifiService.getDeviceStatus(req.params.deviceId);
      return successResponse(res, status);
    } catch (error) {
      next(error);
    }
  }

  async assignDevice(req, res, next) {
    try {
      const device = await wifiService.assignDevice(req.body, req.user);

      // Audit log: WIFI_DEVICE_ASSIGN
      await auditLogService.logAction({
        action: 'WIFI_DEVICE_ASSIGN',
        module: 'WIFI',
        description: `Assigned device "${device.deviceName}" to WiFi network`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: device.companyId,
        entityId: device._id,
        entityType: 'WifiDevice',
        metadata: { deviceId: device.deviceId, wifiId: device.wifiId },
        req,
      });

      return successResponse(res, device, 'Device assigned successfully');
    } catch (error) {
      next(error);
    }
  }

  async unassignDevice(req, res, next) {
    try {
      const device = await wifiService.unassignDevice(req.params.deviceId, req.user);

      // Audit log: WIFI_DEVICE_UNASSIGN
      await auditLogService.logAction({
        action: 'WIFI_DEVICE_UNASSIGN',
        module: 'WIFI',
        description: `Unassigned device "${device.deviceName}"`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: device.companyId,
        entityId: device._id,
        entityType: 'WifiDevice',
        metadata: { deviceId: device.deviceId },
        req,
      });

      return successResponse(res, device, 'Device unassigned successfully');
    } catch (error) {
      next(error);
    }
  }

  async getDevices(req, res, next) {
    try {
      const result = await wifiService.getDevices(req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async updateDevice(req, res, next) {
    try {
      const device = await wifiService.updateDevice(req.params.deviceId, req.body, req.user);

      // Audit log: WIFI_DEVICE_UPDATE
      await auditLogService.logAction({
        action: 'WIFI_DEVICE_UPDATE',
        module: 'WIFI',
        description: `Updated device "${device.deviceName}"`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: device.companyId,
        entityId: device._id,
        entityType: 'WifiDevice',
        metadata: { deviceId: device.deviceId, changes: req.body },
        req,
      });

      return successResponse(res, device, 'Device updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async deleteDevice(req, res, next) {
    try {
      await wifiService.deleteDevice(req.params.deviceId, req.user);

      // Audit log: WIFI_DEVICE_DELETE
      await auditLogService.logAction({
        action: 'WIFI_DEVICE_DELETE',
        module: 'WIFI',
        description: `Deleted device ${req.params.deviceId}`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: req.user.companyId,
        entityId: req.params.deviceId,
        entityType: 'WifiDevice',
        req,
      });

      return successResponse(res, null, 'Device deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  // ==================== WIFI METRIC ENDPOINTS ====================

  async submitMetrics(req, res, next) {
    try {
      const metric = await wifiService.submitMetrics(req.body);

      return successResponse(res, metric, 'Metrics submitted successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  async getMetrics(req, res, next) {
    try {
      const metrics = await wifiService.getMetrics(req.params.wifiId, req.query, req.user);
      return successResponse(res, metrics);
    } catch (error) {
      next(error);
    }
  }

  async getDeviceMetrics(req, res, next) {
    try {
      const metrics = await wifiService.getDeviceMetrics(req.params.deviceId, req.query, req.user);
      return successResponse(res, metrics);
    } catch (error) {
      next(error);
    }
  }

  // ==================== WIFI ALERT ENDPOINTS ====================

  async getAlerts(req, res, next) {
    try {
      const result = await wifiService.getAlerts(req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async resolveAlert(req, res, next) {
    try {
      const alert = await wifiService.resolveAlert(req.params.id, req.user);

      // Audit log: WIFI_ALERT_RESOLVE
      await auditLogService.logAction({
        action: 'WIFI_ALERT_RESOLVE',
        module: 'WIFI',
        description: `Resolved WiFi alert`,
        performedBy: req.user._id,
        role: req.user.role,
        companyId: alert.companyId,
        entityId: alert._id,
        entityType: 'WifiAlert',
        metadata: { wifiId: alert.wifiId },
        req,
      });

      return successResponse(res, alert, 'Alert resolved successfully');
    } catch (error) {
      next(error);
    }
  }

  // ==================== DASHBOARD ENDPOINTS ====================

  async getDashboardStats(req, res, next) {
    try {
      const stats = await wifiService.getDashboardStats(req.user);
      return successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }

  async getHourlyMetrics(req, res, next) {
    try {
      const { hours = 24 } = req.query;
      const metrics = await wifiService.getHourlyMetrics(req.params.wifiId, parseInt(hours), req.user);
      return successResponse(res, metrics);
    } catch (error) {
      next(error);
    }
  }

  // ==================== [SIM-BASED WIFI ACCESS CONTROL] ENDPOINTS ====================

  async getEligibleSims(req, res, next) {
    try {
      const sims = await wifiService.getEligibleSims(req.user, req.query.companyId);
      return successResponse(res, sims);
    } catch (error) {
      next(error);
    }
  }

  async getWifiAssignedSims(req, res, next) {
    try {
      const sims = await wifiService.getWifiAssignedSims(req.params.id, req.user);
      return successResponse(res, sims);
    } catch (error) {
      next(error);
    }
  }

  // ==================== MANUAL ALERT CHECK (Testing) ====================

  async checkAlerts(req, res, next) {
    try {
      const result = await wifiService.checkAndCreateAlerts();
      return successResponse(res, result, 'WiFi alert check completed');
    } catch (error) {
      next(error);
    }
  }

  async testAlertEmail(req, res, next) {
    try {
      const result = await wifiService.testAlertEmail(req.params.wifiId, req.user);
      return successResponse(res, result, 'Test alert email sent successfully');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new WifiController();