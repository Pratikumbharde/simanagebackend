/**
 * Call Attempt Service
 *
 * Handles creating and querying call attempt records.
 * Each call attempt records the result of a single caller→target call.
 */

const CallAttempt = require('../../models/callAttempt/callAttempt.model');
const Sim = require('../../models/sim/sim.model');
const { buildPhoneQuery } = require('../../utils/response');
const logger = require('../../utils/logger');

class CallAttemptService {
  /**
   * Record call attempt results from the mobile app
   * Resolves phone numbers to SIM ObjectIds where possible.
   * @param {Object} data - { configId, companyId, callerSimNumber, results: [{ targetNumber, status, duration }] }
   */
  async recordAttempts(data) {
    const { configId, companyId, callerSimNumber, results } = data;

    if (!results || !Array.isArray(results) || results.length === 0) {
      logger.warn('[CallAttempt] No results to record');
      return [];
    }

    // Build a phone-number-to-SimId map for resolving caller/target ObjectIds
    const numberToSimId = {};

    try {
      // Collect all unique phone numbers from caller and targets
      const allNumbers = [...new Set([
        callerSimNumber,
        ...results.map(r => r.targetNumber || r.targetSimNumber)
      ])].filter(Boolean);

      if (allNumbers.length > 0) {
        // Use buildPhoneQuery to handle different phone number formats (+91XXXXXXXXXX, XXXXXXXXXX, 91XXXXXXXXXX)
        const phoneQueries = allNumbers.map(n => buildPhoneQuery(n)).filter(Boolean);

        if (phoneQueries.length > 0) {
          const simDocs = await Sim.find({ $or: phoneQueries }).select('_id mobileNumber').lean();

          for (const sim of simDocs) {
            numberToSimId[sim.mobileNumber] = sim._id;
            // Also index by last 10 digits for format-agnostic lookup
            const digits = sim.mobileNumber.replace(/\D/g, '');
            const last10 = digits.slice(-10);
            if (last10) {
              numberToSimId[last10] = sim._id;
              numberToSimId[`+91${last10}`] = sim._id;
              numberToSimId[`91${last10}`] = sim._id;
            }
          }
        }

        logger.info(`[CallAttempt] Resolved ${Object.keys(numberToSimId).length} phone number(s) to SIM IDs`);
      }
    } catch (err) {
      // Non-fatal: ObjectId resolution is best-effort, don't block attempt recording
      logger.warn(`[CallAttempt] Error resolving phone numbers to SIM IDs: ${err.message}`);
    }

    // Helper to look up a SIM ObjectId by phone number
    const resolveSimId = (phoneNumber) => {
      if (!phoneNumber) return null;
      // Try exact match first, then by last 10 digits
      if (numberToSimId[phoneNumber]) return numberToSimId[phoneNumber];
      const digits = phoneNumber.replace(/\D/g, '');
      const last10 = digits.slice(-10);
      if (last10 && numberToSimId[last10]) return numberToSimId[last10];
      if (last10 && numberToSimId[`+91${last10}`]) return numberToSimId[`+91${last10}`];
      if (last10 && numberToSimId[`91${last10}`]) return numberToSimId[`91${last10}`];
      return null;
    };

    const attempts = results.map((result) => {
      const targetNumber = result.targetNumber || result.targetSimNumber || '';
      return {
        companyId,
        configId,
        callerSimId: resolveSimId(callerSimNumber),
        callerSimNumber: callerSimNumber || '',
        targetSimId: resolveSimId(targetNumber),
        targetSimNumber: targetNumber,
        status: result.status || 'unknown',
        callDuration: result.duration || result.callDuration || 0,
        retryAttempt: result.retryAttempt || 0,
        attemptedAt: result.attemptedAt ? new Date(result.attemptedAt) : new Date(),
      };
    });

    try {
      const saved = await CallAttempt.insertMany(attempts);
      logger.info(`[CallAttempt] Recorded ${saved.length} call attempt(s) for config ${configId}`);
      return saved;
    } catch (error) {
      logger.error('[CallAttempt] Error recording attempts:', error);
      throw error;
    }
  }

  /**
   * Get paginated call attempts for a company
   * @param {string} companyId - Company ID
   * @param {Object} options - { page, limit, status, callerSimNumber, targetSimNumber, startDate, endDate }
   */
  async getAttempts(companyId, options = {}) {
    const { page = 1, limit = 50, status, callerSimNumber, targetSimNumber, startDate, endDate } = options;
    const skip = (page - 1) * limit;

    const filter = { companyId };
    if (status) {
      // "not_connected" is a virtual filter that matches all non-connected statuses
      if (status === 'not_connected') {
        filter.status = { $in: ['rejected', 'switched_off', 'unreachable', 'unknown', 'max_retries_exceeded'] };
      } else {
        filter.status = status;
      }
    }
    if (callerSimNumber) {
      filter.callerSimNumber = callerSimNumber;
    }
    if (targetSimNumber) {
      filter.targetSimNumber = targetSimNumber;
    }
    if (startDate || endDate) {
      filter.attemptedAt = {};
      if (startDate) filter.attemptedAt.$gte = new Date(startDate);
      if (endDate) filter.attemptedAt.$lte = new Date(endDate);
    }

    const [data, total] = await Promise.all([
      CallAttempt.find(filter)
        .sort({ attemptedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CallAttempt.countDocuments(filter),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get latest status for each target SIM in a company
   * @param {string} companyId
   */
  async getLatestStatusPerTarget(companyId) {
    return CallAttempt.getLatestStatusPerTarget(companyId);
  }

  /**
   * Get connection status for each target SIM in a company.
   * Returns whether each target is "connected" or "not_connected" based on the latest call attempt.
   * Also includes the detailed status, retry count, and last attempt timestamp.
   * @param {string} companyId
   */
  async getConnectionStatus(companyId) {
    const CallAutomationConfig = require('../../models/callAutomation/callAutomation.model');

    // Get the call automation config to find all target SIMs
    const config = await CallAutomationConfig.findOne({ companyId }).lean();

    // Get latest status per target from call attempts
    const latestStatuses = await CallAttempt.getLatestStatusPerTarget(companyId);

    // Build a map of target number → latest status
    const statusMap = {};
    for (const entry of latestStatuses) {
      statusMap[entry.targetSimNumber] = entry;
    }

    // Build the result: include ALL configured targets, even if no call attempts exist yet
    const results = [];

    if (config && config.targetCallerMappings) {
      for (const mapping of config.targetCallerMappings) {
        // Resolve target SIM info
        let targetNumber = '';
        let targetSimId = null;

        if (mapping.targetSimId && typeof mapping.targetSimId === 'object') {
          targetSimId = mapping.targetSimId._id || mapping.targetSimId;
          targetNumber = mapping.targetSimId.mobileNumber || '';
        } else {
          targetSimId = mapping.targetSimId;
        }

        // If we don't have the number yet, try to find it from SIM data
        if (!targetNumber && targetSimId) {
          try {
            const sim = await Sim.findById(targetSimId).select('mobileNumber').lean();
            if (sim) {
              targetNumber = sim.mobileNumber;
            }
          } catch (e) {
            // Ignore
          }
        }

        // Also check by last 10 digits in case of format differences
        const latestStatus = statusMap[targetNumber] ||
          (targetNumber ? Object.entries(statusMap).find(([key]) => {
            const digits1 = key.replace(/\D/g, '').slice(-10);
            const digits2 = targetNumber.replace(/\D/g, '').slice(-10);
            return digits1 && digits2 && digits1 === digits2;
          })?.[1] : null);

        // Get caller SIMs for this target
        const callerSimIds = mapping.callerSimIds || [];
        const callerNumbers = [];
        for (const callerId of callerSimIds) {
          try {
            const id = typeof callerId === 'object' ? (callerId._id || callerId) : callerId;
            if (id) {
              const sim = await Sim.findById(id).select('mobileNumber').lean();
              if (sim) {
                callerNumbers.push(sim.mobileNumber);
              }
            }
          } catch (e) {
            // Ignore
          }
        }

        const latestCallStatus = latestStatus?.status || null;
        const isConnected = latestCallStatus === 'connected';

        results.push({
          targetSimId: targetSimId?.toString() || (mapping.targetSimId?.toString ? mapping.targetSimId.toString() : ''),
          targetSimNumber: targetNumber,
          callerSimNumbers: callerNumbers,
          connectionStatus: isConnected ? 'connected' : (latestCallStatus ? 'not_connected' : 'never_called'),
          detailedStatus: latestCallStatus,
          callDuration: latestStatus?.callDuration || 0,
          lastAttemptAt: latestStatus?.attemptedAt || null,
          lastCallerSimNumber: latestStatus?.callerSimNumber || '',
          retryAttempt: latestStatus?.retryAttempt || 0,
        });
      }
    }

    // Also include any targets that have call attempts but may not be in the config anymore
    for (const entry of latestStatuses) {
      const targetNumber = entry.targetSimNumber;
      const alreadyIncluded = results.some(r =>
        r.targetSimNumber === targetNumber ||
        (r.targetSimNumber && targetNumber &&
          r.targetSimNumber.replace(/\D/g, '').slice(-10) === targetNumber.replace(/\D/g, '').slice(-10))
      );

      if (!alreadyIncluded) {
        const isConnected = entry.status === 'connected';
        results.push({
          targetSimId: entry._id?.toString() || '',
          targetSimNumber: targetNumber,
          callerSimNumbers: [entry.callerSimNumber || ''],
          connectionStatus: isConnected ? 'connected' : (entry.status ? 'not_connected' : 'never_called'),
          detailedStatus: entry.status,
          callDuration: entry.callDuration || 0,
          lastAttemptAt: entry.attemptedAt || null,
          lastCallerSimNumber: entry.callerSimNumber || '',
          retryAttempt: entry.retryAttempt || 0,
        });
      }
    }

    return {
      summary: {
        total: results.length,
        connected: results.filter(r => r.connectionStatus === 'connected').length,
        notConnected: results.filter(r => r.connectionStatus === 'not_connected').length,
        neverCalled: results.filter(r => r.connectionStatus === 'never_called').length,
      },
      targets: results,
    };
  }

  /**
   * Delete old call attempts older than a given number of days
   * @param {number} days - Number of days to keep (default 90)
   */
  async cleanupOldAttempts(days = 90) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const result = await CallAttempt.deleteMany({ attemptedAt: { $lt: cutoff } });
    logger.info(`[CallAttempt] Cleaned up ${result.deletedCount} attempts older than ${days} days`);
    return result;
  }
}

module.exports = new CallAttemptService();