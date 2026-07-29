const { WifiNetwork, WifiDevice, WifiMetric, WifiAlert } = require('../../models/wifi');
const Company = require('../../models/company/company.model');
const Sim = require('../../models/sim/sim.model');
const mongoose = require('mongoose');
const { NotFoundError, ConflictError, ForbiddenError, ValidationError } = require('../../utils/errors');
const notificationHelper = require('../../utils/notificationHelper');
const emailService = require('../../utils/emailService');
const logger = require('../../utils/logger');

class WifiService {
  // ==================== HELPER METHODS ====================

  /**
   * Safely create or update an alert (handles duplicate key errors)
   * Uses atomic findOneAndUpdate to prevent race conditions
   * @param {Object} filter - Filter to find existing alert
   * @param {Object} alertData - Alert data to create/update
   * @returns {Object} - The created or existing alert
   */
  async _createAlertSafely(filter, alertData) {
    try {
      // Try to create the alert
      const alert = await WifiAlert.create(alertData);
      return { alert, isNew: true };
    } catch (error) {
      // Handle duplicate key error (code 11000)
      if (error.code === 11000) {
        logger.warn('[WIFI ALERT] Duplicate alert detected, updating existing', {
          filter,
          duplicateKey: error.keyValue
        });
        // Find and update the existing alert
        const existingAlert = await WifiAlert.findOne(filter);
        if (existingAlert) {
          // Update relevant fields
          if (alertData.avgSpeed !== undefined) existingAlert.avgSpeed = alertData.avgSpeed;
          if (alertData.message) existingAlert.message = alertData.message;
          if (alertData.threshold !== undefined) existingAlert.threshold = alertData.threshold;
          await existingAlert.save();
          return { alert: existingAlert, isNew: false };
        }
        // If still not found, return null (shouldn't happen)
        return { alert: null, isNew: false };
      }
      // Re-throw other errors
      throw error;
    }
  }

  // ==================== WIFI NETWORK METHODS ====================

  /**
   * Create a new WiFi network
   * [SIM-BASED WIFI ACCESS CONTROL] - Now supports assignedSims field
   */
  async createWifiNetwork(data, user) {
    const { wifiName, expectedSpeed, alertThreshold, emailAlertEnabled, assignedSims, ssid, bssid, location, password } = data;
    const targetCompanyId = user.role === 'super_admin' ? data.companyId : user.companyId;

    if (!targetCompanyId) {
      throw new ForbiddenError('Company ID is required');
    }

    // Check for duplicate WiFi name within company
    const existing = await WifiNetwork.findOne({
      companyId: targetCompanyId,
      wifiName: { $regex: new RegExp(`^${wifiName}$`, 'i') },
      isActive: true,
    });

    if (existing) {
      throw new ConflictError('WiFi network with this name already exists in your company');
    }

    // Check for duplicate BSSID within company
    if (bssid && bssid.trim()) {
      const existingBssid = await WifiNetwork.findOne({
        companyId: targetCompanyId,
        bssid: bssid.trim(),
        isActive: true,
      });

      if (existingBssid) {
        throw new ConflictError(`BSSID ${bssid} is already registered to WiFi network "${existingBssid.wifiName}". Each network must have a unique BSSID.`);
      }
    }

    // [SIM-BASED WIFI ACCESS CONTROL] - Validate assignedSims if provided
    if (assignedSims && Array.isArray(assignedSims) && assignedSims.length > 0) {
      // Validate all SIM IDs
      for (const simId of assignedSims) {
        if (!mongoose.Types.ObjectId.isValid(simId)) {
          throw new ValidationError(`Invalid SIM ID: ${simId}`);
        }

        const sim = await Sim.findById(simId);
        if (!sim) {
          throw new NotFoundError(`SIM not found: ${simId}`);
        }

        // Validate SIM belongs to same company
        if (sim.companyId.toString() !== targetCompanyId.toString()) {
          throw new ValidationError(`SIM ${simId} does not belong to this company`);
        }
      }
    }

    const wifiNetwork = new WifiNetwork({
      companyId: targetCompanyId,
      wifiName,
      expectedSpeed,
      alertThreshold,
      emailAlertEnabled: emailAlertEnabled !== undefined ? emailAlertEnabled : true,
      createdBy: user.id,
      // [SIM-BASED WIFI ACCESS CONTROL] - Optional SIM assignment
      assignedSims: assignedSims || [],
      ssid: ssid || '',
      bssid: bssid || '',
      location: location || '',
      password: password || '',
    });

    await wifiNetwork.save();

    // Populate assigned SIMs in response, and include password (select: false field)
    await wifiNetwork.populate('assignedSims', 'mobileNumber operator status');

    return wifiNetwork;
  }

  /**
   * Get all WiFi networks for a company
   */
  async getWifiNetworks(query, user) {
    const { page = 1, limit = 10, search, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    const filter = { isActive: true };

    // Data isolation
    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    } else if (query.companyId) {
      filter.companyId = query.companyId;
    }

    if (search) {
      filter.wifiName = { $regex: search, $options: 'i' };
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const networks = await WifiNetwork.find(filter)
      .populate('createdBy', 'name email')
      .populate({
        path: 'assignedSims',
        select: 'mobileNumber operator status assignedTo',
        populate: {
          path: 'assignedTo',
          select: 'name email'
        }
      })
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    // Get device count and latest metrics for each network
    const networksWithStats = await Promise.all(
      networks.map(async (network) => {
        const deviceCount = await WifiDevice.countDocuments({ wifiId: network._id, isActive: true });
        const activeAlerts = await WifiAlert.countDocuments({
          wifiId: network._id,
          status: 'active'
        });
        // Get the latest single metric (current speed) - not averaged
        const latestMetric = await WifiMetric.getLatestSpeed(network._id);
        // Also get 30-min average for reference
        const avgMetrics = await WifiMetric.getRecentOrLatestSpeed(network._id, 30);

        return {
          ...network.toObject(),
          deviceCount,
          activeAlerts,
          // Current Speed = Latest single metric (what mobile app shows)
          currentSpeed: latestMetric ? latestMetric.downloadSpeed : null,
          currentUploadSpeed: latestMetric ? latestMetric.uploadSpeed : null,
          currentLatency: latestMetric ? latestMetric.latency : null,
          // Average Speed = 30 min average
          currentAvgSpeed: avgMetrics ? ((avgMetrics.avgDownload + avgMetrics.avgUpload) / 2).toFixed(2) : null,
          lastMetricTime: latestMetric?.timestamp || avgMetrics?.lastTimestamp || null,
        };
      })
    );

    const total = await WifiNetwork.countDocuments(filter);

    return { data: networksWithStats, total, page: parseInt(page), limit: parseInt(limit) };
  }

  /**
   * Get WiFi network by ID
   * [SIM-BASED WIFI ACCESS CONTROL] - Now includes assigned SIMs info
   */
  async getWifiNetworkById(wifiId, user) {
    const filter = { _id: wifiId, isActive: true };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const network = await WifiNetwork.findOne(filter)
      .select('+password')
      .populate('createdBy', 'name email')
      .populate({
        path: 'assignedSims',
        select: 'mobileNumber operator status assignedTo',
        populate: {
          path: 'assignedTo',
          select: 'name email'
        }
      });

    if (!network) {
      throw new NotFoundError('WiFi network');
    }

    // Get devices for this network
    const devices = await WifiDevice.find({ wifiId: wifiId })
      .populate('wifiId', 'wifiName')
      .sort({ lastSeen: -1 });

    // Get latest metrics
    const latestMetrics = await WifiMetric.getLatestByWifi(wifiId, 100);

    return {
      ...network.toObject(),
      devices,
      latestMetrics,
    };
  }

  /**
   * Update WiFi network
   * [SIM-BASED WIFI ACCESS CONTROL] - Now supports updating assignedSims
   */
  async updateWifiNetwork(wifiId, updateData, user) {
    const filter = { _id: wifiId, isActive: true };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const allowedUpdates = ['wifiName', 'expectedSpeed', 'alertThreshold', 'emailAlertEnabled', 'assignedSims', 'ssid', 'bssid', 'location', 'password'];
    const updates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    // [PASSWORD FIX] - Password can be explicitly set or cleared.
    // If 'password' key is present in the update, apply it as-is (including empty string to clear).
    // If 'password' key is absent, the password remains unchanged (no accidental clear).

    // Check for duplicate name if name is being changed
    if (updates.wifiName) {
      const existing = await WifiNetwork.findOne({
        companyId: filter.companyId || (await WifiNetwork.findById(wifiId))?.companyId,
        wifiName: { $regex: new RegExp(`^${updates.wifiName}$`, 'i') },
        _id: { $ne: wifiId },
        isActive: true,
      });

      if (existing) {
        throw new ConflictError('WiFi network with this name already exists');
      }
    }

    // Check for duplicate BSSID if bssid is being changed
    if (updates.bssid && updates.bssid.trim()) {
      const existingBssid = await WifiNetwork.findOne({
        companyId: filter.companyId || (await WifiNetwork.findById(wifiId))?.companyId,
        bssid: updates.bssid.trim(),
        _id: { $ne: wifiId },
        isActive: true,
      });

      if (existingBssid) {
        throw new ConflictError(`BSSID ${updates.bssid} is already registered to WiFi network "${existingBssid.wifiName}". Each network must have a unique BSSID.`);
      }
    }

    // [SIM-BASED WIFI ACCESS CONTROL] - Validate assignedSims if provided
    if (updates.assignedSims !== undefined) {
      // Allow empty array to remove all restrictions
      if (Array.isArray(updates.assignedSims) && updates.assignedSims.length > 0) {
        const targetCompanyId = filter.companyId || (await WifiNetwork.findById(wifiId))?.companyId;

        for (const simId of updates.assignedSims) {
          if (!mongoose.Types.ObjectId.isValid(simId)) {
            throw new ValidationError(`Invalid SIM ID: ${simId}`);
          }

          const sim = await Sim.findById(simId);
          if (!sim) {
            throw new NotFoundError(`SIM not found: ${simId}`);
          }

          // Validate SIM belongs to same company
          if (sim.companyId.toString() !== targetCompanyId.toString()) {
            throw new ValidationError(`SIM ${simId} does not belong to this company`);
          }
        }
      }
    }

    const network = await WifiNetwork.findOneAndUpdate(filter, updates, {
      new: true,
      runValidators: true,
    }).select('+password').populate('assignedSims', 'mobileNumber operator status');

    if (!network) {
      throw new NotFoundError('WiFi network');
    }

    return network;
  }

  /**
   * Delete WiFi network (hard delete - permanently remove from database)
   */
  async deleteWifiNetwork(wifiId, user) {
    const filter = { _id: wifiId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    // First, find the network to verify it exists
    const network = await WifiNetwork.findOne(filter);

    if (!network) {
      throw new NotFoundError('WiFi network');
    }

    // Delete all related WiFi metrics
    await WifiMetric.deleteMany({ wifiId: network._id });
    logger.info('[WIFI] Deleted related metrics', { wifiId: network._id });

    // Delete all related WiFi alerts
    await WifiAlert.deleteMany({ wifiId: network._id });
    logger.info('[WIFI] Deleted related alerts', { wifiId: network._id });

    // Unassign all devices
    await WifiDevice.updateMany(
      { wifiId: network._id },
      { wifiId: null, isActive: false }
    );
    logger.info('[WIFI] Unassigned devices', { wifiId: network._id });

    // Hard delete the WiFi network
    await WifiNetwork.deleteOne({ _id: network._id });
    logger.info('[WIFI] WiFi network deleted permanently', { wifiId: network._id, name: network.wifiName });

    return true;
  }

  // ==================== WIFI DEVICE METHODS ====================

  /**
   * Register a new device (called from mobile app)
   */
  async registerDevice(data) {
    const { deviceId, deviceName, companyId } = data;

    // Check if device already exists
    let device = await WifiDevice.findOne({ deviceId });

    if (device) {
      // Device exists, update last seen if it belongs to same company
      if (device.companyId.toString() !== companyId.toString()) {
        throw new ConflictError('Device already registered with another company');
      }
      device.lastSeen = new Date();
      await device.save();
      return device;
    }

    // Create new device
    device = new WifiDevice({
      deviceId,
      deviceName,
      companyId,
      isActive: false,
      wifiId: null,
      lastWifiConnected: true,
    });

    await device.save();
    return device;
  }

  /**
   * Get device status (for mobile app)
   */
  async getDeviceStatus(deviceId) {
    const device = await WifiDevice.findOne({ deviceId })
      .populate('wifiId', 'wifiName expectedSpeed alertThreshold');

    if (!device) {
      return { exists: false, isActive: false, wifiId: null };
    }

    return {
      exists: true,
      isActive: device.isActive,
      wifiId: device.wifiId?._id || null,
      wifiName: device.wifiId?.wifiName || null,
      deviceName: device.deviceName,
    };
  }

  /**
   * Assign device to WiFi network (Admin action)
   */
  async assignDevice(data, user) {
    const { deviceId, wifiId, isActive } = data;

    const targetCompanyId = user.role === 'super_admin' ? user.companyId : user.companyId;

    // Get device
    const device = await WifiDevice.findOne({ deviceId });
    if (!device) {
      throw new NotFoundError('Device');
    }

    // Verify company access
    if (user.role !== 'super_admin' && device.companyId.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('You do not have access to this device');
    }

    // Verify WiFi exists
    const wifiNetwork = await WifiNetwork.findOne({ _id: wifiId, isActive: true });
    if (!wifiNetwork) {
      throw new NotFoundError('WiFi network');
    }

    // Verify WiFi belongs to same company
    if (wifiNetwork.companyId.toString() !== device.companyId.toString()) {
      throw new ValidationError('WiFi network does not belong to the same company');
    }

    // Update device
    device.wifiId = wifiId;
    device.isActive = isActive !== undefined ? isActive : true;
    device.lastSeen = new Date();
    device.lastWifiConnected = true;
    if (!device.lastMetricAt) {
      device.lastMetricAt = new Date();
    }

    await device.save();

    return device.populate('wifiId', 'wifiName expectedSpeed alertThreshold');
  }

  /**
   * Unassign device from WiFi network
   */
  async unassignDevice(deviceId, user) {
    const device = await WifiDevice.findOne({ deviceId });

    if (!device) {
      throw new NotFoundError('Device');
    }

    // Verify company access
    if (user.role !== 'super_admin' && device.companyId.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('You do not have access to this device');
    }

    device.wifiId = null;
    device.isActive = false;
    await device.save();

    return device;
  }

  /**
   * Get all devices for a company (Admin view)
   */
  async getDevices(query, user) {
    const { page = 1, limit = 10, search, wifiId, isActive, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    const filter = {};

    // Data isolation
    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    } else if (query.companyId) {
      filter.companyId = query.companyId;
    }

    if (wifiId) {
      filter.wifiId = wifiId === 'unassigned' ? null : wifiId;
    }

    if (isActive !== undefined) {
      filter.isActive = isActive === 'true' || isActive === true;
    }

    if (search) {
      filter.$or = [
        { deviceName: { $regex: search, $options: 'i' } },
        { deviceId: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const devices = await WifiDevice.find(filter)
      .populate('wifiId', 'wifiName expectedSpeed alertThreshold')
      .populate('companyId', 'name')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await WifiDevice.countDocuments(filter);

    return { data: devices, total, page: parseInt(page), limit: parseInt(limit) };
  }

  /**
   * Update device
   */
  async updateDevice(deviceId, updateData, user) {
    const device = await WifiDevice.findOne({ deviceId });

    if (!device) {
      throw new NotFoundError('Device');
    }

    // Verify company access
    if (user.role !== 'super_admin' && device.companyId.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('You do not have access to this device');
    }

    const allowedUpdates = ['deviceName'];
    const updates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    Object.assign(device, updates);
    await device.save();

    return device.populate('wifiId', 'wifiName expectedSpeed alertThreshold');
  }

  /**
   * Delete device
   */
  async deleteDevice(deviceId, user) {
    const device = await WifiDevice.findOne({ deviceId });

    if (!device) {
      throw new NotFoundError('Device');
    }

    // Verify company access
    if (user.role !== 'super_admin' && device.companyId.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('You do not have access to this device');
    }

    await WifiDevice.deleteOne({ deviceId });
    return true;
  }

  // ==================== WIFI METRIC METHODS ====================

  /**
   * Submit metrics from mobile device
   */
  async submitMetrics(data) {
    const { deviceId, wifiId, downloadSpeed, uploadSpeed, latency } = data;

    // Validate device
    const device = await WifiDevice.findOne({ deviceId });
    if (!device) {
      throw new NotFoundError('Device');
    }

    // Check if device is active and assigned
    if (!device.isActive) {
      throw new ForbiddenError('Device is not approved. Please wait for admin approval.');
    }

    // Check if wifiId matches assigned wifi
    if (!device.wifiId || device.wifiId.toString() !== wifiId) {
      throw new ValidationError('Device is not assigned to this WiFi network');
    }

    // Update device tracking fields
    device.lastSeen = new Date();
    device.lastMetricAt = new Date();
    device.lastWifiConnected = true;
    // Reset offline status if device comes back online
    if (device.isOffline) {
      device.isOffline = false;
      device.offlineSince = null;
      device.offlineAlertSent = false;
    }
    await device.save();

    // Resolve active alerts for this device since it's back online
    try {
      const deviceAlertsResolved = await WifiAlert.updateMany(
        {
          wifiId: device.wifiId,
          deviceId: device._id,
          status: 'active',
          alertType: { $in: ['device_offline', 'wifi_disconnected'] }
        },
        { status: 'resolved', resolvedAt: new Date() }
      );
      if (deviceAlertsResolved.modifiedCount > 0) {
        logger.info('[WIFI METRICS] Device back online via metrics, alerts resolved', {
          deviceId: device.deviceId,
          wifiId: device.wifiId,
          count: deviceAlertsResolved.modifiedCount
        });
      }

      // Only resolve wifi_off alerts if ALL active devices for this network have recent metrics
      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
      const activeDevicesOnNetwork = await WifiDevice.find({
        wifiId: device.wifiId,
        isActive: true
      });

      const allDevicesReporting = activeDevicesOnNetwork.every(d => {
        const lastActivity = d.lastMetricAt || d.lastSeen;
        return lastActivity && new Date(lastActivity) >= twentyMinutesAgo;
      });

      if (allDevicesReporting && activeDevicesOnNetwork.length > 0) {
        const wifiOffResolved = await WifiAlert.updateMany(
          { wifiId: device.wifiId, status: 'active', alertType: 'wifi_off' },
          { status: 'resolved', resolvedAt: new Date() }
        );
        if (wifiOffResolved.modifiedCount > 0) {
          logger.info('[WIFI METRICS] All devices reporting, wifi_off alert resolved', {
            wifiId: device.wifiId,
            deviceCount: activeDevicesOnNetwork.length,
            count: wifiOffResolved.modifiedCount
          });
        }
      }
    } catch (alertError) {
      logger.warn('[WIFI METRICS] Could not resolve alerts on metrics submission', {
        deviceId: device.deviceId,
        error: alertError.message
      });
    }

    // Create metric
    const metric = new WifiMetric({
      wifiId,
      companyId: device.companyId,
      deviceId,
      deviceObjectId: device._id,
      downloadSpeed,
      uploadSpeed,
      latency,
      timestamp: new Date(),
    });

    await metric.save();

    return metric;
  }

  /**
   * Get metrics for a WiFi network
   */
  async getMetrics(wifiId, query, user) {
    const { startDate, endDate, limit = 100 } = query;

    // Verify access
    const wifiNetwork = await WifiNetwork.findOne({ _id: wifiId, isActive: true });
    if (!wifiNetwork) {
      throw new NotFoundError('WiFi network');
    }

    if (user.role !== 'super_admin' && wifiNetwork.companyId.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('You do not have access to this WiFi network');
    }

    let metrics;
    if (startDate && endDate) {
      metrics = await WifiMetric.getByWifiAndTimeRange(wifiId, new Date(startDate), new Date(endDate));
    } else {
      metrics = await WifiMetric.getLatestByWifi(wifiId, parseInt(limit));
    }

    return metrics;
  }

  /**
   * Get metrics for a device
   */
  async getDeviceMetrics(deviceId, query, user) {
    const { limit = 100 } = query;

    const device = await WifiDevice.findOne({ deviceId });
    if (!device) {
      throw new NotFoundError('Device');
    }

    // Verify company access
    if (user.role !== 'super_admin' && device.companyId.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('You do not have access to this device');
    }

    const metrics = await WifiMetric.find({ deviceId })
      .populate('wifiId', 'wifiName')
      .populate('deviceObjectId', 'deviceName')
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    return metrics;
  }

  // ==================== WIFI ALERT METHODS ====================

  /**
   * Get alerts for a company
   */
  async getAlerts(query, user) {
    const { page = 1, limit = 10, status, wifiId, alertType, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    const filter = {};

    // Data isolation
    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    } else if (query.companyId) {
      filter.companyId = query.companyId;
    }

    if (status) {
      filter.status = status;
    }

    if (wifiId) {
      filter.wifiId = wifiId;
    }

    // Filter by alert type (supports multiple types as comma-separated)
    if (alertType) {
      if (alertType.includes(',')) {
        filter.alertType = { $in: alertType.split(',').map(t => t.trim()) };
      } else {
        filter.alertType = alertType;
      }
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const alerts = await WifiAlert.find(filter)
      .populate('wifiId', 'wifiName expectedSpeed alertThreshold')
      .populate('deviceId', 'deviceName deviceId')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await WifiAlert.countDocuments(filter);

    return { data: alerts, total, page: parseInt(page), limit: parseInt(limit) };
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId, user) {
    const alert = await WifiAlert.findById(alertId);

    if (!alert) {
      throw new NotFoundError('Alert');
    }

    // Verify company access
    if (user.role !== 'super_admin' && alert.companyId.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('You do not have access to this alert');
    }

    await alert.resolve();
    return alert;
  }

  // ==================== DASHBOARD METHODS ====================

  /**
   * Get WiFi dashboard stats
   */
  async getDashboardStats(user) {
    const targetCompanyId = user.role === 'super_admin' ? user.companyId : user.companyId;

    if (!targetCompanyId) {
      throw new ForbiddenError('Company ID is required');
    }

    const companyId = new mongoose.Types.ObjectId(targetCompanyId);

    // Total networks
    const totalNetworks = await WifiNetwork.countDocuments({ companyId, isActive: true });

    // Total devices
    const totalDevices = await WifiDevice.countDocuments({ companyId });
    const activeDevices = await WifiDevice.countDocuments({ companyId, isActive: true });

    // Active alerts
    const activeAlerts = await WifiAlert.countDocuments({ companyId, status: 'active' });

    // Average speed across all networks (use recent or latest speed from last 30 minutes)
    const networks = await WifiNetwork.find({ companyId, isActive: true });
    let totalAvgSpeed = 0;
    let networksWithData = 0;

    for (const network of networks) {
      const avgSpeed = await WifiMetric.getRecentOrLatestSpeed(network._id, 30);
      if (avgSpeed) {
        totalAvgSpeed += (avgSpeed.avgDownload + avgSpeed.avgUpload) / 2;
        networksWithData++;
      }
    }

    const avgSpeed = networksWithData > 0 ? totalAvgSpeed / networksWithData : 0;

    // Network-wise stats
    const networkStats = await Promise.all(
      networks.map(async (network) => {
        const deviceCount = await WifiDevice.countDocuments({ wifiId: network._id, isActive: true });
        // Get the latest single metric (current speed)
        const latestMetric = await WifiMetric.getLatestSpeed(network._id);
        // Get 30-min average for reference
        const avgMetrics = await WifiMetric.getRecentOrLatestSpeed(network._id, 30);
        const activeAlertsCount = await WifiAlert.countDocuments({ wifiId: network._id, status: 'active' });

        return {
          _id: network._id,
          wifiName: network.wifiName,
          expectedSpeed: network.expectedSpeed,
          alertThreshold: network.alertThreshold,
          deviceCount,
          // Current Speed (latest single metric)
          currentSpeed: latestMetric ? latestMetric.downloadSpeed : 0,
          currentUploadSpeed: latestMetric ? latestMetric.uploadSpeed : 0,
          currentLatency: latestMetric ? latestMetric.latency : 0,
          // Average Speed (30 min average)
          avgDownload: avgMetrics?.avgDownload || 0,
          avgUpload: avgMetrics?.avgUpload || 0,
          avgLatency: avgMetrics?.avgLatency || 0,
          avgSpeed: avgMetrics ? ((avgMetrics.avgDownload + avgMetrics.avgUpload) / 2).toFixed(2) : 0,
          lastMetricTime: latestMetric?.timestamp || avgMetrics?.lastTimestamp || null,
          activeAlerts: activeAlertsCount,
          status: activeAlertsCount > 0 ? 'alert' : (latestMetric ? 'healthy' : 'unknown'),
        };
      })
    );

    return {
      totalNetworks,
      totalDevices,
      activeDevices,
      inactiveDevices: totalDevices - activeDevices,
      activeAlerts,
      avgSpeed: avgSpeed.toFixed(2),
      networkStats,
    };
  }

  /**
   * Get hourly metrics for charts
   */
  async getHourlyMetrics(wifiId, hours = 24, user) {
    // Verify access
    const wifiNetwork = await WifiNetwork.findOne({ _id: wifiId, isActive: true });
    if (!wifiNetwork) {
      throw new NotFoundError('WiFi network');
    }

    if (user.role !== 'super_admin' && wifiNetwork.companyId.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('You do not have access to this WiFi network');
    }

    const hourlyData = await WifiMetric.getHourlyAverage(wifiId, hours);

    return hourlyData.map((d) => ({
      time: `${d._id.hour.toString().padStart(2, '0')}:00`,
      downloadSpeed: d.avgDownload.toFixed(2),
      uploadSpeed: d.avgUpload.toFixed(2),
      latency: d.avgLatency.toFixed(2),
      count: d.count,
    }));
  }

  // ==================== CRON METHODS ====================

  /**
   * Check and create alerts for various WiFi issues (called by cron job)
   * Now includes: low_speed, wifi_off, wifi_disconnected, device_offline
   * Returns summary of actions taken
   */
  async checkAndCreateAlerts() {
    const results = {
      checked: 0,
      skipped: 0,
      alertsCreated: 0,
      alertsUpdated: 0,
      alertsResolved: 0,
      emailsSent: 0,
      emailErrors: [],
      errors: [],
      // New tracking fields
      offlineAlertsCreated: 0,
      wifiOffAlertsCreated: 0,
      disconnectedAlertsCreated: 0,
      notificationsCreated: 0,
    };

    // Run all alert checks
    await this._checkLowSpeedAlerts(results);
    await this._checkDeviceOfflineAlerts(results);
    await this._checkWifiOffAlerts(results);

    logger.info('[WIFI ALERT] All checks completed', results);
    return results;
  }

  /**
   * Check for low speed alerts (original logic)
   */
  async _checkLowSpeedAlerts(results) {
    const networks = await WifiNetwork.find({ isActive: true });

    for (const network of networks) {
      try {
        const avgMetrics = await WifiMetric.getAverageSpeed(network._id, 20);

        if (!avgMetrics || avgMetrics.count === 0) {
          // No data received — resolve any active low_speed alerts since we can't confirm low speed without data
          const resolveResult = await WifiAlert.updateMany(
            { wifiId: network._id, status: 'active', alertType: 'low_speed' },
            { status: 'resolved', resolvedAt: new Date() }
          );
          if (resolveResult.modifiedCount > 0) {
            results.alertsResolved += resolveResult.modifiedCount;
            logger.info('[WIFI ALERT] Low_speed alerts resolved (no metrics)', {
              wifiId: network._id,
              wifiName: network.wifiName,
              count: resolveResult.modifiedCount
            });
          }
          results.skipped++;
          continue;
        }

        results.checked++;
        const avgSpeed = (avgMetrics.avgDownload + avgMetrics.avgUpload) / 2;

        logger.info('[WIFI ALERT] Speed check', {
          wifiId: network._id,
          wifiName: network.wifiName,
          avgSpeed: avgSpeed.toFixed(2),
          threshold: network.alertThreshold,
          belowThreshold: avgSpeed < network.alertThreshold,
          emailAlertEnabled: network.emailAlertEnabled
        });

        if (avgSpeed < network.alertThreshold) {
          // Check if there's already an active low_speed alert
          const existingAlert = await WifiAlert.findOne({
            wifiId: network._id,
            status: 'active',
            alertType: 'low_speed',
          });

          if (!existingAlert) {
            // Use safe create to handle duplicate key errors
            const { alert, isNew } = await this._createAlertSafely(
              { wifiId: network._id, status: 'active', alertType: 'low_speed' },
              {
                wifiId: network._id,
                companyId: network.companyId,
                avgSpeed,
                threshold: network.alertThreshold,
                alertType: 'low_speed',
                message: `Average speed ${avgSpeed.toFixed(2)} Mbps is below threshold ${network.alertThreshold} Mbps`,
              }
            );

            if (alert) {
              if (isNew) {
                results.alertsCreated++;
                logger.info('[WIFI ALERT] New low_speed alert created', {
                  wifiId: network._id,
                  wifiName: network.wifiName,
                  avgSpeed: avgSpeed.toFixed(2),
                  alertId: alert._id
                });
              } else {
                results.alertsUpdated++;
                logger.info('[WIFI ALERT] Low_speed alert updated (duplicate handled)', { wifiId: network._id, alertId: alert._id });
              }
            }
          } else {
            existingAlert.avgSpeed = avgSpeed;
            existingAlert.message = `Average speed ${avgSpeed.toFixed(2)} Mbps is below threshold ${network.alertThreshold} Mbps`;
            await existingAlert.save();
            results.alertsUpdated++;
            logger.info('[WIFI ALERT] Low_speed alert updated', { wifiId: network._id, alertId: existingAlert._id });
          }

          // Send email alert if enabled
          const alertToSend = existingAlert || (await WifiAlert.findOne({ wifiId: network._id, status: 'active', alertType: 'low_speed' }));
          if (network.emailAlertEnabled && alertToSend) {
            await this._sendAlertEmails(network, alertToSend, results, 'low_speed');
          }
        } else {
          // Speed is good, resolve any active low_speed alerts
          const resolveResult = await WifiAlert.updateMany(
            { wifiId: network._id, status: 'active', alertType: 'low_speed' },
            { status: 'resolved', resolvedAt: new Date() }
          );
          if (resolveResult.modifiedCount > 0) {
            results.alertsResolved += resolveResult.modifiedCount;
            logger.info('[WIFI ALERT] Low_speed alerts resolved', {
              wifiId: network._id,
              wifiName: network.wifiName,
              avgSpeed: avgSpeed.toFixed(2),
              count: resolveResult.modifiedCount
            });
          }
        }
      } catch (error) {
        results.errors.push({ wifiId: network._id, error: error.message });
        logger.error('[WIFI ALERT] Error in low_speed check', {
          wifiId: network._id,
          error: error.message,
          stack: error.stack
        });
      }
    }
  }

  /**
   * Check for device offline alerts (mobile switched off or no longer reporting)
   * A device is considered offline if:
   * - It hasn't sent metrics in the last OFFLINE_THRESHOLD_MINUTES
   * - And it was previously active
   */
  async _checkDeviceOfflineAlerts(results) {
    const OFFLINE_THRESHOLD_MINUTES = 25; // Device offline if no metrics for 25 minutes

    try {
      // Find all active devices that are assigned to WiFi networks
      const activeDevices = await WifiDevice.find({
        isActive: true,
        wifiId: { $ne: null }
      }).populate('wifiId', 'wifiName emailAlertEnabled companyId');

      for (const device of activeDevices) {
        try {
          const wifiNetwork = device.wifiId;
          if (!wifiNetwork || !wifiNetwork.companyId) continue;

          const now = new Date();
          const offlineThreshold = new Date(now.getTime() - OFFLINE_THRESHOLD_MINUTES * 60 * 1000);

          // Check if device is offline
          const lastSeen = device.lastMetricAt || device.lastSeen;
          const isOffline = !lastSeen || new Date(lastSeen) < offlineThreshold;

          if (isOffline && !device.offlineAlertSent) {
            // Device is offline and alert hasn't been sent yet
            const offlineDuration = lastSeen
              ? Math.round((now - new Date(lastSeen)) / (1000 * 60))
              : OFFLINE_THRESHOLD_MINUTES;

            // Create offline alert using safe method to handle duplicates
            const { alert, isNew } = await this._createAlertSafely(
              { wifiId: wifiNetwork._id, deviceId: device._id, status: 'active', alertType: 'device_offline' },
              {
                wifiId: wifiNetwork._id,
                companyId: wifiNetwork.companyId,
                deviceId: device._id,
                deviceStringId: device.deviceId,
                avgSpeed: 0,
                threshold: 0,
                alertType: 'device_offline',
                message: `Device ${device.deviceName || device.deviceId} is offline. No data received for ${offlineDuration} minutes.`,
              }
            );

            if (alert) {
              if (isNew) {
                results.alertsCreated++;
                results.offlineAlertsCreated++;
              }

              // Mark device as offline and alert sent
              device.isOffline = true;
              device.offlineSince = now;
              device.offlineAlertSent = true;
              await device.save();

              logger.info('[WIFI ALERT] Device offline alert created', {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                wifiId: wifiNetwork._id,
                wifiName: wifiNetwork.wifiName,
                offlineDuration,
                alertId: alert._id,
                isNew
              });

              // Send email alert
              if (wifiNetwork.emailAlertEnabled) {
                await this._sendAlertEmails(wifiNetwork, alert, results, 'device_offline', device);
              }
            }
          } else if (!isOffline && device.isOffline) {
            // Device is back online, resolve alerts
            const resolveResult = await WifiAlert.updateMany(
              {
                deviceId: device._id,
                status: 'active',
                alertType: { $in: ['device_offline', 'wifi_disconnected'] }
              },
              { status: 'resolved', resolvedAt: new Date() }
            );

            if (resolveResult.modifiedCount > 0) {
              results.alertsResolved += resolveResult.modifiedCount;
              logger.info('[WIFI ALERT] Device back online, alerts resolved', {
                deviceId: device.deviceId,
                count: resolveResult.modifiedCount
              });
            }

            // Update device status
            device.isOffline = false;
            device.offlineSince = null;
            device.offlineAlertSent = false;
            await device.save();
          }
        } catch (deviceError) {
          results.errors.push({ deviceId: device.deviceId, error: deviceError.message });
          logger.error('[WIFI ALERT] Error checking device offline', {
            deviceId: device.deviceId,
            error: deviceError.message
          });
        }
      }
    } catch (error) {
      results.errors.push({ type: 'device_offline_check', error: error.message });
      logger.error('[WIFI ALERT] Error in device offline check', { error: error.message });
    }
  }

  /**
   * Check for WiFi off alerts
   * A WiFi is considered off if:
   * - No metrics received for the WiFi network in the last WIFI_OFF_THRESHOLD_MINUTES
   * - And there are active devices assigned to it
   */
  async _checkWifiOffAlerts(results) {
    const WIFI_OFF_THRESHOLD_MINUTES = 20; // WiFi off if no metrics for 20 minutes

    try {
      const networks = await WifiNetwork.find({ isActive: true });

      for (const network of networks) {
        try {
          // Check if there are active devices for this network
          const activeDevices = await WifiDevice.countDocuments({
            wifiId: network._id,
            isActive: true
          });

          if (activeDevices === 0) {
            // No active devices — still check per-device disconnected alerts for any previously assigned devices
            // but skip wifi_off alert creation since there are no active devices to report
          } else {
            // Check for recent metrics
            const thresholdTime = new Date(Date.now() - WIFI_OFF_THRESHOLD_MINUTES * 60 * 1000);
            const recentMetrics = await WifiMetric.findOne({
              wifiId: network._id,
              timestamp: { $gte: thresholdTime }
            }).sort({ timestamp: -1 });

            if (!recentMetrics) {
              // No metrics received — WiFi might be off
              // Check if there's already an active wifi_off alert
              const existingAlert = await WifiAlert.findOne({
                wifiId: network._id,
                status: 'active',
                alertType: 'wifi_off',
              });

              if (!existingAlert) {
                // Create WiFi off alert using safe method
                const { alert, isNew } = await this._createAlertSafely(
                  { wifiId: network._id, status: 'active', alertType: 'wifi_off' },
                  {
                    wifiId: network._id,
                    companyId: network.companyId,
                    avgSpeed: 0,
                    threshold: network.alertThreshold,
                    alertType: 'wifi_off',
                    message: `WiFi network ${network.wifiName} appears to be offline. No speed data received for ${WIFI_OFF_THRESHOLD_MINUTES}+ minutes.`,
                  }
                );

                if (alert) {
                  if (isNew) {
                    results.alertsCreated++;
                    results.wifiOffAlertsCreated++;
                    logger.info('[WIFI ALERT] WiFi off alert created', {
                      wifiId: network._id,
                      wifiName: network.wifiName,
                      alertId: alert._id
                    });
                  } else {
                    logger.info('[WIFI ALERT] WiFi off alert already exists (duplicate handled)', {
                      wifiId: network._id,
                      wifiName: network.wifiName,
                      alertId: alert._id
                    });
                  }

                  // Send email only if email alerts are enabled for this network
                  if (network.emailAlertEnabled) {
                    await this._sendAlertEmails(network, alert, results, 'wifi_off');
                  }
                }
              }
            } else {
              // Metrics are being received, resolve wifi_off alerts
              const resolveResult = await WifiAlert.updateMany(
                { wifiId: network._id, status: 'active', alertType: 'wifi_off' },
                { status: 'resolved', resolvedAt: new Date() }
              );

              if (resolveResult.modifiedCount > 0) {
                results.alertsResolved += resolveResult.modifiedCount;
                logger.info('[WIFI ALERT] WiFi back online, alerts resolved', {
                  wifiId: network._id,
                  wifiName: network.wifiName,
                  count: resolveResult.modifiedCount
                });
              }
            }
          }

          // Always check per-device disconnected alerts for this network
          await this._checkWifiDisconnectedAlerts(network, results);

        } catch (networkError) {
          results.errors.push({ wifiId: network._id, error: networkError.message });
          logger.error('[WIFI ALERT] Error checking WiFi off', {
            wifiId: network._id,
            error: networkError.message
          });
        }
      }
    } catch (error) {
      results.errors.push({ type: 'wifi_off_check', error: error.message });
      logger.error('[WIFI ALERT] Error in WiFi off check', { error: error.message });
    }
  }

  /**
   * Check for WiFi disconnected alerts for a specific network
   * A device is considered disconnected if:
   * - It was previously connected to this WiFi
   * - But hasn't sent metrics for this specific WiFi in a while
   */
  async _checkWifiDisconnectedAlerts(network, results) {
    const DISCONNECT_THRESHOLD_MINUTES = 20;

    try {
      // Find devices assigned to this WiFi
      const devices = await WifiDevice.find({
        wifiId: network._id,
        isActive: true
      });

      for (const device of devices) {
        // Check if this device has sent metrics for this WiFi recently
        const thresholdTime = new Date(Date.now() - DISCONNECT_THRESHOLD_MINUTES * 60 * 1000);

        const recentMetrics = await WifiMetric.findOne({
          wifiId: network._id,
          deviceId: device.deviceId,
          timestamp: { $gte: thresholdTime }
        }).sort({ timestamp: -1 });

        const isDisconnected = !recentMetrics;
        const lastMetricTime = recentMetrics ? recentMetrics.timestamp : device.lastMetricAt;

        if (isDisconnected && device.lastWifiConnected !== false) {
          // Device was connected but now disconnected from this WiFi
          // Create wifi_disconnected alert
          const existingAlert = await WifiAlert.findOne({
            wifiId: network._id,
            deviceId: device._id,
            status: 'active',
            alertType: 'wifi_disconnected',
          });

          if (!existingAlert) {
            const disconnectDuration = lastMetricTime
              ? Math.round((Date.now() - new Date(lastMetricTime).getTime()) / (1000 * 60))
              : DISCONNECT_THRESHOLD_MINUTES;

            // Create alert using safe method
            const { alert, isNew } = await this._createAlertSafely(
              { wifiId: network._id, deviceId: device._id, status: 'active', alertType: 'wifi_disconnected' },
              {
                wifiId: network._id,
                companyId: network.companyId,
                deviceId: device._id,
                deviceStringId: device.deviceId,
                avgSpeed: 0,
                threshold: network.alertThreshold,
                alertType: 'wifi_disconnected',
                message: `Device ${device.deviceName || device.deviceId} disconnected from WiFi ${network.wifiName}. No data for ${disconnectDuration} minutes.`,
              }
            );

            if (alert) {
              if (isNew) {
                results.alertsCreated++;
                results.disconnectedAlertsCreated++;
              }

              // Update device WiFi connection status
              device.lastWifiConnected = false;
              await device.save();

              logger.info('[WIFI ALERT] WiFi disconnected alert created', {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                wifiId: network._id,
                wifiName: network.wifiName,
                disconnectDuration,
                alertId: alert._id,
                isNew
              });

              // Send email
              if (network.emailAlertEnabled) {
                await this._sendAlertEmails(network, alert, results, 'wifi_disconnected', device);
              }
            }
          }
        } else if (!isDisconnected) {
          // Device is connected, update status
          if (device.lastWifiConnected === false) {
            device.lastWifiConnected = true;
            await device.save();
          }

          // Resolve wifi_disconnected alerts
          const resolveResult = await WifiAlert.updateMany(
            {
              wifiId: network._id,
              deviceId: device._id,
              status: 'active',
              alertType: 'wifi_disconnected'
            },
            { status: 'resolved', resolvedAt: new Date() }
          );

          if (resolveResult.modifiedCount > 0) {
            results.alertsResolved += resolveResult.modifiedCount;
            logger.info('[WIFI ALERT] WiFi reconnected, alerts resolved', {
              deviceId: device.deviceId,
              wifiId: network._id,
              count: resolveResult.modifiedCount
            });
          }
        }
      }
    } catch (error) {
      logger.error('[WIFI ALERT] Error checking WiFi disconnected', {
        wifiId: network._id,
        error: error.message
      });
    }
  }

  /**
   * Send alert emails to admins
   * Note: Creates ONE company-wide notification, NOT one per admin
   */
  async _sendAlertEmails(network, alert, results, alertType, device = null) {
    try {
      const company = await Company.findById(network.companyId);
      if (!company) {
        logger.warn('[WIFI ALERT] Company not found', { companyId: network.companyId });
        return;
      }

      // Create ONE company-wide notification (not per-user)
      // This prevents duplicate notifications for the same alert
      const notificationData = {
        companyId: network.companyId,
        type: 'wifi_alert',
        title: notificationHelper._getWifiAlertTitle(network, alertType, device),
        message: alert.message,
        priority: 'high',
        metadata: {
          wifiName: network.wifiName,
          avgSpeed: alert.avgSpeed,
          threshold: network.alertThreshold,
          alertType: alertType,
          deviceName: device?.deviceName,
          deviceId: device?.deviceId,
        },
        data: { wifiId: network._id, alertId: alert._id, deviceId: device?._id },
      };

      await notificationHelper.createNotification(notificationData);
      results.notificationsCreated++;

      // Send emails to all admins (but only one notification)
      const adminUsers = await mongoose.model('User').find({
        companyId: network.companyId,
        role: { $in: ['admin', 'super_admin'] },
        isActive: true,
      });

      if (adminUsers.length === 0) {
        logger.warn('[WIFI ALERT] No admin users found', { companyId: network.companyId });
        return;
      }

      let anyEmailSent = false;
      for (const admin of adminUsers) {
        try {
          // Only send email, don't create notification here
          const emailData = {
            to: admin.email,
            subject: notificationHelper._getWifiAlertSubject(network, alertType, device),
            html: notificationHelper._generateWifiAlertHtml(admin, network, alert, alertType, device),
          };

          // Check if email notifications are enabled for this company
          const { isFeatureEnabled } = require('../../middleware/subscription');
          const featureCheck = await isFeatureEnabled(network.companyId, 'emailNotifications');

          if (featureCheck.enabled && emailService.isReady()) {
            const emailResult = await emailService.sendEmail(emailData);
            if (emailResult.success) {
              results.emailsSent++;
              anyEmailSent = true;
              logger.info('[WIFI ALERT] Email sent', {
                email: admin.email,
                wifiId: network._id,
                alertType
              });
            }
          }
        } catch (emailError) {
          results.emailErrors.push({ email: admin.email, error: emailError.message });
          logger.error('[WIFI ALERT] Email send failed', {
            email: admin.email,
            error: emailError.message
          });
        }
      }

      // Mark alert as email sent if at least one email was delivered
      if (anyEmailSent && alert && alert._id) {
        try {
          await WifiAlert.updateOne(
            { _id: alert._id },
            { $set: { emailSent: true } }
          );
        } catch (updateError) {
          logger.warn('[WIFI ALERT] Failed to update emailSent flag', {
            alertId: alert._id,
            error: updateError.message
          });
        }
      }
    } catch (error) {
      results.errors.push({ wifiId: network._id, error: error.message });
      logger.error('[WIFI ALERT] Email process failed', {
        wifiId: network._id,
        error: error.message
      });
    }
  }

  /**
   * Clean old metrics (called by cron job)
   */
  async cleanOldMetrics(daysToKeep = 30) {
    return await WifiMetric.cleanOldMetrics(daysToKeep);
  }

  // ==================== SIM-BASED WIFI ACCESS CONTROL METHODS ====================

  /**
   * [SIM-BASED WIFI ACCESS CONTROL] - Check if SIM is allowed for WiFi
   * If assignedSims is empty/undefined, allow all SIMs (backward compatible)
   * If assignedSims has entries, only allow SIMs in the list
   */
  isSimAllowedForWifi(wifi, simId) {
    // No restriction - all SIMs allowed (backward compatible)
    if (!wifi.assignedSims || wifi.assignedSims.length === 0) {
      return true;
    }

    // Check if SIM is in the allowed list
    const simIdStr = simId.toString();
    return wifi.assignedSims.some(id => id.toString() === simIdStr);
  }

  /**
   * [SIM-BASED WIFI ACCESS CONTROL] - Get eligible SIMs for WiFi assignment
   * Returns all SIMs in the company that can be assigned to WiFi networks
   */
  async getEligibleSims(user, queryCompanyId) {
    const targetCompanyId = user.role === 'super_admin' ? queryCompanyId : user.companyId;

    if (!targetCompanyId) {
      throw new ForbiddenError('Company ID is required');
    }

    const sims = await Sim.find({
      companyId: targetCompanyId,
      isActive: true,
      status: 'active'
    })
      .select('mobileNumber operator status assignedTo')
      .populate('assignedTo', 'name email')
      .sort({ mobileNumber: 1 });

    return sims;
  }

  /**
   * [SIM-BASED WIFI ACCESS CONTROL] - Get WiFi networks accessible by a SIM
   * Used by device flow to get available WiFi networks
   */
  async getWifiNetworksForSim(companyId, simId) {
    return await WifiNetwork.findAccessibleBySim(companyId, simId);
  }

  /**
   * [SIM-BASED WIFI ACCESS CONTROL] - Get SIMs assigned to a specific WiFi
   */
  async getWifiAssignedSims(wifiId, user) {
    const filter = { _id: wifiId, isActive: true };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const network = await WifiNetwork.findOne(filter)
      .populate('assignedSims', 'mobileNumber operator status assignedTo');

    if (!network) {
      throw new NotFoundError('WiFi network');
    }

    return network.assignedSims || [];
  }

  /**
   * [MANUAL TESTING] - Test alert email for a specific WiFi network
   * Sends a test email to admin regardless of speed threshold or emailAlertEnabled toggle
   * Always sends so admins can verify their email configuration works
   */
  async testAlertEmail(wifiId, user) {
    const network = await WifiNetwork.findById(wifiId).populate('companyId');

    if (!network) {
      throw new NotFoundError('WiFi network');
    }

    // Verify access
    if (user.role !== 'super_admin' && network.companyId._id.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('You do not have access to this WiFi network');
    }

    // Get latest metrics
    const latestMetrics = await WifiMetric.getAverageSpeed(wifiId, 5);
    const avgSpeed = latestMetrics ? (latestMetrics.avgDownload + latestMetrics.avgUpload) / 2 : 0;

    // Create a test alert (using low_speed type which has the most complete email template)
    const alert = {
      _id: 'test_alert_' + Date.now(),
      avgSpeed: avgSpeed || 10,
      threshold: network.alertThreshold,
      alertType: 'low_speed',
      message: `[TEST] WiFi speed test alert — Average speed is below threshold. This is a test email to verify your alert configuration.`,
      createdAt: new Date()
    };

    // Get admin users
    const adminUsers = await mongoose.model('User').find({
      companyId: network.companyId._id,
      role: { $in: ['admin', 'super_admin'] },
      isActive: true,
    });

    const emailResults = [];

    for (const admin of adminUsers) {
      try {
        await notificationHelper.sendWifiAlertEmail(admin, network, alert, 'low_speed');
        emailResults.push({
          email: admin.email,
          name: admin.name,
          status: 'sent'
        });
        logger.info('[WIFI TEST] Test email sent', { email: admin.email, wifiId });
      } catch (emailError) {
        emailResults.push({
          email: admin.email,
          name: admin.name,
          status: 'failed',
          error: emailError.message
        });
        logger.error('[WIFI TEST] Failed to send test email', { email: admin.email, error: emailError.message });
      }
    }

    return {
      wifiName: network.wifiName,
      emailAlertEnabled: network.emailAlertEnabled,
      avgSpeed: avgSpeed,
      threshold: network.alertThreshold,
      adminsNotified: emailResults
    };
  }
}

module.exports = new WifiService();