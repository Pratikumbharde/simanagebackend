const CallLog = require('../../models/callLog/callLog.model');
const Sim = require('../../models/sim/sim.model');
const User = require('../../models/auth/user.model');
const { NotFoundError, ForbiddenError } = require('../../utils/errors');
// [PHONE NORMALIZATION FIX]
const { buildPhoneQuery, normalizePhoneNumber } = require('../../utils/response');
const logger = require('../../utils/logger');

class CallLogService {
  async syncCallLogs(data, user, deviceId) {
    const { simId, callLogs } = data;

    // Verify SIM exists and belongs to user's company
    const sim = await Sim.findById(simId);
    if (!sim) {
      throw new NotFoundError('SIM');
    }

    if (user.role !== 'super_admin' && sim.companyId.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('Access denied to this SIM');
    }

    // Check if data sync is enabled for the SIM's assigned user
    if (sim.assignedTo) {
      const assignedUser = await User.findById(sim.assignedTo).select('dataSync');
      if (assignedUser && assignedUser.dataSync === false) {
        throw new ForbiddenError('Data sync is disabled for this user. Contact your admin to re-enable it.');
      }
    }

    // Bulk upsert call logs
    const result = await CallLog.syncFromDevice(sim.companyId, simId, callLogs, deviceId);

    // Update SIM last active date
    sim.lastActiveDate = new Date();
    await sim.save();

    return result;
  }

  /**
   * [MULTI-SIM SUPPORT] - Sync call logs from mobile device with JWT authentication
   * Validates that the SIM belongs to the logged-in user before saving logs
   * POST /api/call-logs (authenticated)
   */
  async syncCallLogsForUser(data, user, deviceId) {
    const { simNumber, callLogs } = data;

    if (!simNumber) {
      throw new Error('SIM number is required');
    }

    if (!callLogs || !Array.isArray(callLogs) || callLogs.length === 0) {
      return { synced: 0, message: 'No call logs to sync' };
    }

    // [SECURITY] - Verify SIM belongs to the logged-in user
    // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
    const sim = await Sim.findOne({
      mobileNumber: simNumber,
      assignedTo: user._id,
      companyId: user.companyId,
    });

    if (!sim) {
      logger.warn('[CALL LOG SECURITY] Unauthorized SIM access attempt', {
        simNumber,
        userId: user._id,
        companyId: user.companyId,
      });
      throw new ForbiddenError('Unauthorized SIM - SIM not assigned to your account');
    }

    // Check if data sync is disabled for this user
    if (user.dataSync === false) {
      throw new ForbiddenError('Data sync is disabled for your account. Contact your admin to re-enable it.');
    }

    logger.info('[CALL LOG SYNC] Validated SIM ownership', {
      simId: sim._id,
      simNumber: sim.mobileNumber,
      userId: user._id,
      callLogsCount: callLogs.length,
    });

    // Bulk insert call logs with duplicate prevention
    const result = await this.insertCallLogsWithDupCheck(sim.companyId, sim._id, callLogs, deviceId);

    // Update SIM last active date
    sim.lastActiveDate = new Date();
    await sim.save();

    return result;
  }

  /**
   * Insert call logs with duplicate prevention
   * [PERFORMANCE] - Uses bulkWrite for efficient insertion
   */
  async insertCallLogsWithDupCheck(companyId, simId, callLogs, deviceId) {
    const insertedLogs = [];
    const duplicateLogs = [];
    const bulkOps = [];

    for (const log of callLogs) {
      // Check for duplicate
      const existingLog = await CallLog.findOne({
        sim: simId,
        phoneNumber: log.phoneNumber || log.number,
        timestamp: new Date(log.timestamp || log.date),
      });

      if (existingLog) {
        duplicateLogs.push({
          phoneNumber: log.phoneNumber || log.number,
          timestamp: log.timestamp || log.date,
        });
        continue;
      }

      bulkOps.push({
        insertOne: {
          document: {
            companyId,
            sim: simId,
            phoneNumber: log.phoneNumber || log.number,
            callType: log.callType || log.type || 'outgoing',
            duration: log.duration || 0,
            timestamp: new Date(log.timestamp || log.date),
            syncedFrom: 'mobile',
            deviceId: deviceId || 'mobile-device',
            contactName: log.contactName || log.name || null,
          },
        },
      });
    }

    if (bulkOps.length > 0) {
      await CallLog.bulkWrite(bulkOps);
    }

    return {
      synced: insertedLogs.length + bulkOps.length,
      inserted: bulkOps.length,
      duplicates: duplicateLogs.length,
      duplicatesList: duplicateLogs.slice(0, 10), // Return first 10 duplicates
    };
  }

  /**
   * Sync call logs from mobile device without JWT authentication
   * Uses Contact Number to identify the SIM
   * [PHONE NORMALIZATION FIX] - Handle both phone formats for backward compatibility
   * [SECURITY UPDATE] - This endpoint is now deprecated, use authenticated sync
   */
  async deviceSync(data, deviceId) {
    const { mobileNumber, callLogs } = data;

    if (!mobileNumber) {
      throw new Error('Contact Number is required');
    }

    if (!callLogs || !Array.isArray(callLogs) || callLogs.length === 0) {
      return { synced: 0, message: 'No call logs to sync' };
    }

    // [PHONE NORMALIZATION FIX] - Normalize and build query for backward compatibility
    const { normalized, original } = normalizePhoneNumber(mobileNumber);
    const phoneQuery = buildPhoneQuery(mobileNumber);

    if (!phoneQuery) {
      throw new Error('Invalid Contact Number format');
    }

    // [PHONE NORMALIZATION FIX] - Log normalization
    logger.info('Phone number normalized for deviceSync', {
      original: original,
      normalized: normalized,
      query: JSON.stringify(phoneQuery)
    });

    // [PHONE NORMALIZATION FIX] - Find SIM by Contact Number (matches both formats)
    const sim = await Sim.findOne(phoneQuery);

    if (!sim) {
      logger.error('SIM not found for deviceSync', {
        phoneQuery: JSON.stringify(phoneQuery),
        originalMobileNumber: original,
        normalizedMobileNumber: normalized
      });
      throw new NotFoundError('SIM not found with this Contact Number. Please register the SIM first.');
    }

    logger.info('SIM found for deviceSync', {
      simId: sim._id,
      simMobileNumber: sim.mobileNumber,
      companyId: sim.companyId
    });

    // Check if data sync is disabled for the SIM's assigned user
    if (sim.assignedTo) {
      const assignedUser = await User.findById(sim.assignedTo).select('dataSync');
      if (assignedUser && assignedUser.dataSync === false) {
        throw new ForbiddenError('Data sync is disabled for this user. Contact your admin to re-enable it.');
      }
    }

    // Get company from SIM
    const companyId = sim.companyId;

    // Bulk upsert call logs
    const result = await CallLog.syncFromDevice(companyId, sim._id, callLogs, deviceId || 'mobile');

    // Update SIM last active date
    sim.lastActiveDate = new Date();
    await sim.save();

    return result;
  }

  async getCallLogs(query, user) {
    const {
      page = 1,
      limit = 20,
      simId,
      callType,
      phoneNumber,
      startDate,
      endDate,
      uniqueOnly,
      sortBy = 'timestamp',
      sortOrder = 'desc',
    } = query;

    const showUniqueOnly = uniqueOnly === 'true' || uniqueOnly === true;

    const filter = {};

    // Data isolation
    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    } else if (query.companyId) {
      filter.companyId = query.companyId;
    }

    if (simId) filter.simId = simId;
    if (callType) filter.callType = callType;

    // [PHONE SEARCH FIX] - Escape special regex characters in phone number
    if (phoneNumber) {
      const escapedPhoneNumber = phoneNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.phoneNumber = { $regex: escapedPhoneNumber, $options: 'i' };
    }

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Unique numbers mode: return one record per phone number (most recent call)
    if (showUniqueOnly) {
      const allCallLogs = await CallLog.find(filter)
        .populate('simId', 'mobileNumber operator')
        .sort(sort)
        .limit(10000)
        .lean();

      const uniqueMap = new Map();
      allCallLogs.forEach(c => {
        const key = c.phoneNumber;
        if (!uniqueMap.has(key) || new Date(c.timestamp) > new Date(uniqueMap.get(key).timestamp)) {
          uniqueMap.set(key, c);
        }
      });

      const uniqueResults = Array.from(uniqueMap.values())
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      const totalUnique = uniqueResults.length;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const paginatedResults = uniqueResults.slice(skip, skip + parseInt(limit));

      return { data: paginatedResults, total: totalUnique, page: parseInt(page), limit: parseInt(limit) };
    }

    const skip = (page - 1) * limit;

    const callLogs = await CallLog.find(filter)
      .populate('simId', 'mobileNumber operator')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await CallLog.countDocuments(filter);

    return { data: callLogs, total, page: parseInt(page), limit: parseInt(limit) };
  }

  async getCallLogById(callLogId, user) {
    const filter = { _id: callLogId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const callLog = await CallLog.findOne(filter).populate('simId', 'mobileNumber operator');

    if (!callLog) {
      throw new NotFoundError('Call log');
    }

    return callLog;
  }

  async getCallStats(companyId, startDate, endDate, filters = {}) {
    const stats = await CallLog.getStats(companyId, startDate, endDate, filters);
    const dailyCounts = await CallLog.getDailyCounts(companyId, 30);
    const topContacts = await CallLog.getTopContacts(companyId, 10);

    return {
      ...stats,
      dailyCounts,
      topContacts,
    };
  }

  async getSimCallStats(simId, startDate, endDate) {
    const match = { simId };

    if (startDate || endDate) {
      match.timestamp = {};
      if (startDate) match.timestamp.$gte = new Date(startDate);
      if (endDate) match.timestamp.$lte = new Date(endDate);
    }

    const stats = await CallLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$callType',
          count: { $sum: 1 },
          totalDuration: { $sum: '$duration' },
          avgDuration: { $avg: '$duration' },
        },
      },
    ]);

    const totalCalls = await CallLog.countDocuments(match);
    const uniqueNumbers = await CallLog.distinct('phoneNumber', match);

    return {
      byType: stats,
      totalCalls,
      uniqueNumbers: uniqueNumbers.length,
    };
  }

  async exportCallLogs(query, user) {
    const { simId, callType, startDate, endDate } = query;

    const filter = {};

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    } else if (query.companyId) {
      filter.companyId = query.companyId;
    }

    if (simId) filter.simId = simId;
    if (callType) filter.callType = callType;

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    const callLogs = await CallLog.find(filter)
      .populate('simId', 'mobileNumber operator')
      .sort({ timestamp: -1 })
      .limit(10000);

    return callLogs;
  }

  async flagCallLog(callLogId, flagged, reason, user) {
    const filter = { _id: callLogId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const callLog = await CallLog.findOneAndUpdate(
      filter,
      {
        isFlagged: flagged,
        flaggedReason: flagged ? reason : null,
      },
      { new: true }
    );

    if (!callLog) {
      throw new NotFoundError('Call log');
    }

    return callLog;
  }

  async deleteOldCallLogs(companyId, daysToKeep = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await CallLog.deleteMany({
      companyId,
      timestamp: { $lt: cutoffDate },
    });

    return { deletedCount: result.deletedCount };
  }
}

module.exports = new CallLogService();