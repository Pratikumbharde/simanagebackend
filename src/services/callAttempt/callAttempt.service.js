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
      filter.status = status;
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