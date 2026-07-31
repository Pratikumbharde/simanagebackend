const CameraAlert = require('../../models/cctv/cameraAlert.model');
const Camera = require('../../models/cctv/camera.model');
const { NotFoundError, ForbiddenError } = require('../../utils/errors');
const { AlertNotFoundError } = require('../../utils/cctvErrors');
const { emitToCompany } = require('../../config/socket');

class CameraAlertService {
  /**
   * Create a new alert (used internally, e.g., when camera goes offline)
   */
  async createAlert(data) {
    const { companyId, cameraId, agentId, alertType, message, metadata } = data;

    const alert = new CameraAlert({
      companyId,
      cameraId,
      agentId: agentId || null,
      alertType,
      message,
      status: 'active',
      metadata: metadata || {},
    });

    await alert.save();

    // Emit Socket.IO event for real-time alert notification
    emitToCompany(companyId, 'camera:alert', {
      id: alert._id,
      alertType,
      message,
      cameraId,
      timestamp: alert.createdAt,
    });

    return alert;
  }

  /**
   * Get all alerts for a company (paginated, filtered)
   */
  async getAllAlerts(query, user) {
    const {
      page = 1,
      limit = 20,
      status,
      alertType,
      cameraId,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const filter = {};

    // Data isolation
    if (user.role === 'super_admin' && query.companyId) {
      filter.companyId = query.companyId;
    } else if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    if (status) filter.status = status;
    if (alertType) filter.alertType = alertType;
    if (cameraId) filter.cameraId = cameraId;

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const alerts = await CameraAlert.find(filter)
      .populate('cameraId', 'name type status')
      .populate('agentId', 'name hostname')
      .populate('resolvedBy', 'name email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await CameraAlert.countDocuments(filter);

    return { data: alerts, total, page: parseInt(page), limit: parseInt(limit) };
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId, user) {
    const filter = { _id: alertId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const alert = await CameraAlert.findOne(filter);

    if (!alert) {
      throw new AlertNotFoundError();
    }

    await alert.acknowledge(user._id);
    return alert;
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId, user, resolutionNote) {
    const filter = { _id: alertId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const alert = await CameraAlert.findOne(filter);

    if (!alert) {
      throw new AlertNotFoundError();
    }

    await alert.resolve(user._id, resolutionNote);

    // Emit Socket.IO event for real-time alert resolution
    try {
      emitToCompany(alert.companyId.toString(), 'camera:alert', {
        alertId: alert._id,
        type: 'resolved',
        alertType: alert.alertType,
        cameraId: alert.cameraId,
        resolvedBy: user._id,
        resolvedAt: alert.resolvedAt,
        resolutionNote: resolutionNote || null,
      });
    } catch (e) {
      // Socket.IO might not be initialized
    }

    return alert;
  }

  /**
   * Get alerts for a specific camera
   */
  async getByCamera(cameraId, query, user) {
    const {
      page = 1,
      limit = 20,
      status,
    } = query;

    const filter = { cameraId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    if (status) filter.status = status;

    const skip = (page - 1) * limit;

    const alerts = await CameraAlert.find(filter)
      .populate('agentId', 'name hostname')
      .populate('resolvedBy', 'name email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await CameraAlert.countDocuments(filter);

    return { data: alerts, total, page: parseInt(page), limit: parseInt(limit) };
  }

  /**
   * Get active alert count for a company
   */
  async getActiveAlertCount(companyId) {
    return CameraAlert.countDocuments({ companyId, status: 'active' });
  }
}

module.exports = new CameraAlertService();