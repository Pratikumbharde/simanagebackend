const mongoose = require('mongoose');
const Sim = require('../../models/sim/sim.model');
const WifiNetwork = require('../../models/wifi/wifiNetwork.model');
const WifiMetric = require('../../models/wifi/wifiMetric.model');
const WifiAlert = require('../../models/wifi/wifiAlert.model');
const { NotFoundError, ForbiddenError, ValidationError, UnauthorizedError } = require('../../utils/errors');
const { buildPhoneQuery, normalizePhoneNumber } = require('../../utils/response');
const logger = require('../../utils/logger');
const crypto = require('crypto');

class DeviceService {
  /**
   * Auto-authenticate device using SIM number
   * POST /api/device/auto-auth
   *
   * Flow:
   * 1. Find SIM by Contact Number
   * 2. Check if SIM is active
   * 3. Bind device to SIM (update deviceId)
   * 4. Generate device token
   * 5. Return WiFi networks accessible by this SIM
   */
  async autoAuth(data) {
    const { simNumber, deviceId } = data;

    if (!simNumber || !deviceId) {
      throw new ValidationError('SIM number and device ID are required');
    }

    // [PHONE NORMALIZATION] - Handle different phone formats
    const phoneQuery = buildPhoneQuery(simNumber);
    if (!phoneQuery) {
      throw new ValidationError('Invalid Contact Number format');
    }

    // Find SIM by Contact Number
    const sim = await Sim.findOne(phoneQuery);

    if (!sim) {
      logger.warn('[DEVICE AUTH] SIM not found', { simNumber });
      throw new NotFoundError('SIM not found. Please register the SIM first.');
    }

    // Check if SIM is active
    if (!sim.isActive || sim.status !== 'active') {
      logger.warn('[DEVICE AUTH] SIM not active', { simId: sim._id, status: sim.status });
      throw new ForbiddenError('SIM is not active. Please contact administrator.');
    }

    // Check for device binding change
    if (sim.deviceId && sim.deviceId !== deviceId) {
      logger.info('[DEVICE AUTH] Device change detected', {
        simId: sim._id,
        oldDeviceId: sim.deviceId,
        newDeviceId: deviceId
      });
      // Allow device change (user got new phone)
    }

    // Bind device to SIM
    sim.deviceId = deviceId;
    sim.deviceLastSeen = new Date();

    // Generate device token
    const { token, expiresAt } = sim.generateDeviceToken();
    await sim.save();

    // [SIM-BASED WIFI ACCESS CONTROL] - Fetch WiFi networks accessible by this SIM
    // Only return WiFi networks where:
    // - assignedSims is empty/undefined (backward compatible - all SIMs allowed)
    // - OR this SIM is in assignedSims array
    const wifiNetworks = await WifiNetwork.findAccessibleBySim(sim.companyId, sim._id);

    // Format WiFi config for device
    const wifiConfig = wifiNetworks.map(wifi => ({
      wifiId: wifi._id,
      ssid: wifi.ssid || wifi.wifiName,
      bssid: wifi.bssid,
      wifiName: wifi.wifiName,
      expectedSpeed: wifi.expectedSpeed,
      alertThreshold: wifi.alertThreshold
    }));

    // [WIFI DEVICE TRACKING] - Create or update WifiDevice record for alert monitoring
    // Without this, cron jobs for device_offline, wifi_off, and wifi_disconnected never find devices
    try {
      const WifiDevice = mongoose.models.WifiDevice || mongoose.model('WifiDevice');
      let wifiDevice = await WifiDevice.findOne({ deviceId });

      if (wifiDevice) {
        // Update existing device - reset offline flags on re-auth
        wifiDevice.lastSeen = new Date();
        wifiDevice.lastMetricAt = wifiDevice.lastMetricAt || new Date();
        wifiDevice.lastWifiConnected = true;
        if (wifiDevice.isOffline) {
          wifiDevice.isOffline = false;
          wifiDevice.offlineSince = null;
          wifiDevice.offlineAlertSent = false;
        }
        // Update wifiId if SIM now accesses a different WiFi
        if (wifiNetworks.length > 0 && wifiDevice.wifiId?.toString() !== wifiNetworks[0]._id.toString()) {
          wifiDevice.wifiId = wifiNetworks[0]._id;
        }
        await wifiDevice.save();
      } else if (wifiNetworks.length > 0) {
        // Create new WifiDevice record - auto-approved in SIM-based flow
        wifiDevice = new WifiDevice({
          deviceId,
          deviceName: sim.mobileNumber || deviceId,
          companyId: sim.companyId,
          wifiId: wifiNetworks[0]._id,
          isActive: true,
          lastSeen: new Date(),
          lastMetricAt: new Date(),
          lastWifiConnected: true,
          isOffline: false,
          offlineAlertSent: false,
        });
        await wifiDevice.save();
      }

      logger.info('[DEVICE AUTH] WifiDevice tracking updated', {
        deviceId,
        wifiDeviceId: wifiDevice?._id,
        wifiId: wifiDevice?.wifiId,
        isNew: !wifiDevice?.__v && wifiDevice?.__v !== 0,
      });
    } catch (deviceError) {
      logger.warn('[DEVICE AUTH] Could not update WifiDevice tracking', {
        deviceId,
        error: deviceError.message
      });
    }

    logger.info('[DEVICE AUTH] Device authenticated successfully', {
      simId: sim._id,
      companyId: sim.companyId,
      deviceId,
      wifiCount: wifiConfig.length
    });

    return {
      allowed: true,
      deviceToken: token,
      tokenExpires: expiresAt,
      simId: sim._id,
      mobileNumber: sim.mobileNumber,
      companyId: sim.companyId,
      wifiConfig
    };
  }

  /**
   * Submit WiFi metrics with SIM-based access validation
   * POST /api/wifi/metrics
   *
   * Validation Flow (strict order):
   * 1. Device token validation
   * 2. SIM validation (exists, active)
   * 3. Device binding validation
   * 4. WiFi access validation (NEW)
   * 5. BSSID validation
   * 6. Store metrics
   */
  async submitMetrics(data) {
    const {
      simNumber,
      deviceId,
      deviceToken,
      ssid,
      bssid,
      downloadSpeed,
      uploadSpeed,
      latency
    } = data;

    // 1. Validate required fields
    if (!simNumber || !deviceId || !deviceToken) {
      throw new ValidationError('SIM number, device ID, and device token are required');
    }

    if (!ssid || !bssid) {
      throw new ValidationError('WiFi SSID and BSSID are required');
    }

    if (downloadSpeed === undefined || uploadSpeed === undefined) {
      throw new ValidationError('Download and upload speeds are required');
    }

    // 2. Find SIM by Contact Number
    const phoneQuery = buildPhoneQuery(simNumber);
    if (!phoneQuery) {
      throw new ValidationError('Invalid Contact Number format');
    }

    const sim = await Sim.findOne(phoneQuery);

    if (!sim) {
      throw new NotFoundError('SIM not found');
    }

    // 3. Validate SIM is active
    if (!sim.isActive || sim.status !== 'active') {
      throw new ForbiddenError('SIM is not active');
    }

    // 4. [DEVICE TOKEN VALIDATION]
    if (!sim.validateDeviceToken(deviceToken)) {
      logger.warn('[WIFI METRICS] Invalid device token', {
        simId: sim._id,
        deviceId
      });
      throw new UnauthorizedError('Invalid or expired device token');
    }

    // 5. [DEVICE BINDING VALIDATION]
    if (sim.deviceId !== deviceId) {
      logger.warn('[WIFI METRICS] Device ID mismatch', {
        simId: sim._id,
        expectedDeviceId: sim.deviceId,
        receivedDeviceId: deviceId
      });
      throw new ForbiddenError('Device not bound to this SIM');
    }

    // 6. [WIFI ACCESS VALIDATION] - Find WiFi network
    // Log search criteria for debugging
    logger.info('[WIFI METRICS] Searching for WiFi network', {
      simCompanyId: sim.companyId,
      simId: sim._id,
      ssid,
      bssid
    });

    // Try to find WiFi network with flexible BSSID matching
    // Priority: 1. Exact SSID + BSSID match, 2. SSID match (ignore BSSID)
    let wifi = await WifiNetwork.findOne({
      companyId: sim.companyId,
      isActive: true,
      $or: [
        { ssid, bssid },                        // Exact SSID + BSSID match
        { wifiName: ssid, bssid },              // wifiName + BSSID match
      ]
    });

    // If not found, try matching by SSID only (for mesh/dual-band networks)
    if (!wifi) {
      logger.info('[WIFI METRICS] Exact BSSID not found, trying SSID-only match', { ssid, bssid });

      wifi = await WifiNetwork.findOne({
        companyId: sim.companyId,
        isActive: true,
        $or: [
          { ssid },
          { wifiName: ssid }
        ]
      });

      if (wifi) {
        logger.info('[WIFI METRICS] WiFi found by SSID (BSSID ignored)', {
          wifiId: wifi._id,
          wifiName: wifi.wifiName,
          ssid: wifi.ssid,
          storedBssid: wifi.bssid,
          receivedBssid: bssid
        });
      }
    }

    if (!wifi) {
      // Log all WiFi networks for this company for debugging
      const allWifiNetworks = await WifiNetwork.find({ companyId: sim.companyId });
      logger.warn('[WIFI METRICS] WiFi network not found', {
        ssid,
        bssid,
        companyId: sim.companyId,
        availableNetworks: allWifiNetworks.map(w => ({
          id: w._id,
          name: w.wifiName,
          ssid: w.ssid,
          bssid: w.bssid,
          isActive: w.isActive,
          assignedSims: w.assignedSims
        }))
      });
      throw new NotFoundError('WiFi network not found. Please ensure the WiFi network is created in admin panel with matching SSID.');
    }

    // 7. [SIM-BASED ACCESS VALIDATION] - Check if SIM is allowed for this WiFi
    if (!this.isSimAllowedForWifi(wifi, sim._id)) {
      logger.warn('[WIFI METRICS] SIM not authorized for WiFi', {
        simId: sim._id,
        wifiId: wifi._id,
        assignedSims: wifi.assignedSims
      });
      throw new ForbiddenError('SIM not authorized for this WiFi network');
    }

    // 8. [BSSID VALIDATION] - Log if BSSID doesn't match (but don't reject)
    // This is common for mesh networks, dual-band routers, and when users change routers
    if (wifi.bssid && wifi.bssid !== bssid && bssid) {
      logger.info('[WIFI METRICS] BSSID mismatch - likely mesh/dual-band network', {
        wifiId: wifi._id,
        wifiName: wifi.wifiName,
        storedBssid: wifi.bssid,
        receivedBssid: bssid,
        note: 'This is normal for mesh networks, dual-band routers, or when router was replaced'
      });
    }

    // 9. Update SIM last seen and metrics tracking
    sim.deviceLastSeen = new Date();
    sim.lastMetricAt = new Date();
    await sim.save();

    // 10. Update WifiDevice tracking if available
    let wifiDevice = null;
    try {
      const WifiDevice = mongoose.model('WifiDevice');
      wifiDevice = await WifiDevice.findOne({ deviceId });
      if (wifiDevice) {
        wifiDevice.lastMetricAt = new Date();
        wifiDevice.lastSeen = new Date();
        wifiDevice.lastWifiConnected = true;
        // Reset offline status if device comes back online
        if (wifiDevice.isOffline) {
          wifiDevice.isOffline = false;
          wifiDevice.offlineSince = null;
          wifiDevice.offlineAlertSent = false;
        }
        await wifiDevice.save();

        // Resolve active alerts since device is back online
        try {
          const deviceAlertsResolved = await WifiAlert.updateMany(
            {
              wifiId: wifiDevice.wifiId,
              deviceId: wifiDevice._id,
              status: 'active',
              alertType: { $in: ['device_offline', 'wifi_disconnected'] }
            },
            { status: 'resolved', resolvedAt: new Date() }
          );
          if (deviceAlertsResolved.modifiedCount > 0) {
            logger.info('[WIFI METRICS] Device back online, alerts resolved immediately', {
              deviceId,
              wifiId: wifiDevice.wifiId,
              count: deviceAlertsResolved.modifiedCount
            });
          }

          // Also resolve wifi_off alerts since this device is sending metrics
          const wifiOffResolved = await WifiAlert.updateMany(
            { wifiId: wifiDevice.wifiId, status: 'active', alertType: 'wifi_off' },
            { status: 'resolved', resolvedAt: new Date() }
          );
          if (wifiOffResolved.modifiedCount > 0) {
            logger.info('[WIFI METRICS] WiFi back online, wifi_off alert resolved immediately', {
              wifiId: wifiDevice.wifiId,
              count: wifiOffResolved.modifiedCount
            });
          }
        } catch (alertError) {
          logger.warn('[WIFI METRICS] Could not resolve alerts on device return', {
            deviceId,
            error: alertError.message
          });
        }
      }
    } catch (deviceError) {
      logger.warn('[WIFI METRICS] Could not update WifiDevice tracking', {
        deviceId,
        error: deviceError.message
      });
    }

    // 11. Store metrics
    const metric = new WifiMetric({
      wifiId: wifi._id,
      companyId: sim.companyId,
      deviceId,
      deviceObjectId: wifiDevice ? wifiDevice._id : sim._id,
      simId: sim._id, // Track which SIM submitted the metrics
      downloadSpeed,
      uploadSpeed,
      latency: latency || 0,
      timestamp: new Date(),
    });

    await metric.save();

    logger.info('[WIFI METRICS] Metrics stored successfully', {
      metricId: metric._id,
      simId: sim._id,
      wifiId: wifi._id,
      downloadSpeed,
      uploadSpeed
    });

    return {
      success: true,
      message: 'Metrics stored successfully',
      metricId: metric._id
    };
  }

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
   * Validate device token without submitting metrics
   * GET /api/device/validate
   */
  async validateDevice(data) {
    const { simNumber, deviceId, deviceToken } = data;

    if (!simNumber || !deviceId || !deviceToken) {
      throw new ValidationError('SIM number, device ID, and device token are required');
    }

    const phoneQuery = buildPhoneQuery(simNumber);
    if (!phoneQuery) {
      throw new ValidationError('Invalid Contact Number format');
    }

    const sim = await Sim.findOne(phoneQuery);

    if (!sim) {
      throw new NotFoundError('SIM not found');
    }

    if (!sim.isActive || sim.status !== 'active') {
      throw new ForbiddenError('SIM is not active');
    }

    if (!sim.validateDeviceToken(deviceToken)) {
      throw new UnauthorizedError('Invalid or expired device token');
    }

    if (sim.deviceId !== deviceId) {
      throw new ForbiddenError('Device not bound to this SIM');
    }

    return {
      valid: true,
      simId: sim._id,
      mobileNumber: sim.mobileNumber,
      companyId: sim.companyId
    };
  }

  /**
   * Refresh device token
   * POST /api/device/refresh-token
   */
  async refreshToken(data) {
    const { simNumber, deviceId, deviceToken } = data;

    if (!simNumber || !deviceId || !deviceToken) {
      throw new ValidationError('SIM number, device ID, and device token are required');
    }

    const phoneQuery = buildPhoneQuery(simNumber);
    if (!phoneQuery) {
      throw new ValidationError('Invalid Contact Number format');
    }

    const sim = await Sim.findOne(phoneQuery);

    if (!sim) {
      throw new NotFoundError('SIM not found');
    }

    // Validate current token (even if expired, allow refresh)
    if (sim.deviceToken !== deviceToken) {
      throw new UnauthorizedError('Invalid device token');
    }

    // Generate new token
    const { token, expiresAt } = sim.generateDeviceToken();
    sim.deviceLastSeen = new Date();
    await sim.save();

    logger.info('[DEVICE AUTH] Token refreshed', { simId: sim._id });

    return {
      deviceToken: token,
      tokenExpires: expiresAt
    };
  }
}

module.exports = new DeviceService();