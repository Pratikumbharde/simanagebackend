const Camera = require('../../models/cctv/camera.model');
const Agent = require('../../models/cctv/agent.model');
const Snapshot = require('../../models/cctv/snapshot.model');
const CameraAlert = require('../../models/cctv/cameraAlert.model');
const Office = require('../../models/cctv/office.model');

class DashboardService {
  /**
   * Get CCTV dashboard statistics
   */
  async getDashboardStats(companyId) {
    const [
      cameraStats,
      agentStats,
      snapshotStats,
      alertStats,
      officeCount,
    ] = await Promise.all([
      this.getCameraStats(companyId),
      this.getAgentStats(companyId),
      this.getSnapshotStats(companyId),
      this.getAlertStats(companyId),
      Office.countDocuments({ companyId, isActive: true }),
    ]);

    return {
      cameras: cameraStats,
      agents: agentStats,
      snapshots: snapshotStats,
      alerts: alertStats,
      offices: officeCount,
    };
  }

  /**
   * Get camera statistics
   */
  async getCameraStats(companyId) {
    const [
      total,
      online,
      offline,
      error,
      disabled,
    ] = await Promise.all([
      Camera.countDocuments({ companyId, isActive: true }),
      Camera.countDocuments({ companyId, status: 'online', isActive: true }),
      Camera.countDocuments({ companyId, status: 'offline', isActive: true }),
      Camera.countDocuments({ companyId, status: 'error', isActive: true }),
      Camera.countDocuments({ companyId, status: 'disabled', isActive: true }),
    ]);

    return { total, online, offline, error, disabled };
  }

  /**
   * Get agent statistics
   */
  async getAgentStats(companyId) {
    const [
      total,
      active,
      inactive,
      suspended,
    ] = await Promise.all([
      Agent.countDocuments({ companyId, isActive: true }),
      Agent.countDocuments({ companyId, status: 'active', isActive: true }),
      Agent.countDocuments({ companyId, status: 'inactive', isActive: true }),
      Agent.countDocuments({ companyId, status: 'suspended', isActive: true }),
    ]);

    // Check which agents are currently online (heartbeat within 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const onlineAgents = await Agent.countDocuments({
      companyId,
      isActive: true,
      lastHeartbeat: { $gte: tenMinutesAgo },
    });

    return { total, active, inactive, suspended, online: onlineAgents };
  }

  /**
   * Get snapshot statistics
   */
  async getSnapshotStats(companyId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const [
      total,
      todayCount,
      yesterdayCount,
      storageUsage,
    ] = await Promise.all([
      Snapshot.countDocuments({ companyId, status: 'uploaded' }),
      Snapshot.countDocuments({ companyId, status: 'uploaded', capturedAt: { $gte: today } }),
      Snapshot.countDocuments({ companyId, capturedAt: { $gte: yesterday, $lt: today } }),
      Snapshot.getStorageUsage(companyId),
    ]);

    return {
      total,
      today: todayCount,
      yesterday: yesterdayCount,
      storage: storageUsage,
    };
  }

  /**
   * Get alert statistics
   */
  async getAlertStats(companyId) {
    const [
      activeAlerts,
      acknowledgedAlerts,
      recentAlerts,
    ] = await Promise.all([
      CameraAlert.countDocuments({ companyId, status: 'active' }),
      CameraAlert.countDocuments({ companyId, status: 'acknowledged' }),
      // Alerts in last 24 hours
      CameraAlert.countDocuments({
        companyId,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
    ]);

    // Get recent alerts (last 10)
    const recentAlertsList = await CameraAlert.find({
      companyId,
      status: { $in: ['active', 'acknowledged'] },
    })
      .populate('cameraId', 'name type')
      .sort({ createdAt: -1 })
      .limit(10);

    return {
      active: activeAlerts,
      acknowledged: acknowledgedAlerts,
      recent24h: recentAlerts,
      recentList: recentAlertsList,
    };
  }

  /**
   * Get recent snapshots for dashboard
   */
  async getRecentSnapshots(companyId, limit = 5) {
    return Snapshot.find({ companyId, status: 'uploaded' })
      .populate('cameraId', 'name type')
      .sort({ capturedAt: -1 })
      .limit(limit);
  }
}

module.exports = new DashboardService();