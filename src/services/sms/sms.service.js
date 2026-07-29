const Sms = require('../../models/sms/sms.model');
const Sim = require('../../models/sim/sim.model');
const { NotFoundError, ForbiddenError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class SmsService {
  /**
   * Sync SMS from mobile device
   * POST /api/sms/sync
   */
  async syncSms(data, user, deviceId) {
    const { simNumber, messages } = data;

    if (!simNumber) {
      throw new Error('SIM number is required');
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { synced: 0, message: 'No SMS to sync' };
    }

    // Find SIM by Contact Number for the logged-in user
    // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
    const sim = await Sim.findOne({
      mobileNumber: simNumber,
      assignedTo: user._id,
      companyId: user.companyId,
    });

    if (!sim) {
      logger.warn('[SMS SYNC SECURITY] Unauthorized SIM access attempt', {
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

    logger.info('[SMS SYNC] Validated SIM ownership', {
      simId: sim._id,
      simNumber: sim.mobileNumber,
      userId: user._id,
      messagesCount: messages.length,
    });

    // Sync SMS using the model's static method
    const result = await Sms.syncFromDevice(
      sim.companyId,
      user._id,
      sim._id,
      simNumber,
      messages,
      deviceId || 'mobile'
    );

    // Update SIM last active date
    sim.lastActiveDate = new Date();
    await sim.save();

    return result;
  }

  /**
   * Get SMS logs with filters and pagination
   * GET /api/sms
   */
  async getSmsLogs(query, user) {
    const {
      page = 1,
      limit = 20,
      userId,
      simId,
      type,
      sender,
      search,
      fromDate,
      toDate,
      sortBy = 'timestamp',
      sortOrder = 'desc',
    } = query;

    const filter = {};

    // Data isolation - company-based filtering
    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    } else if (query.companyId) {
      filter.companyId = query.companyId;
    }

    // Apply filters
    if (userId) filter.userId = userId;
    if (simId) filter.simId = simId;
    if (type) filter.type = type;

    // Escape special regex characters in sender
    if (sender) {
      const escapedSender = sender.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.sender = { $regex: escapedSender, $options: 'i' };
    }

    // Search in message content
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.message = { $regex: escapedSearch, $options: 'i' };
    }

    // Date range filter
    if (fromDate || toDate) {
      filter.timestamp = {};
      if (fromDate) filter.timestamp.$gte = new Date(fromDate);
      if (toDate) filter.timestamp.$lte = new Date(toDate);
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const smsLogs = await Sms.find(filter)
      .populate('simId', 'mobileNumber operator')
      .populate('userId', 'name email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await Sms.countDocuments(filter);

    return {
      data: smsLogs,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    };
  }

  /**
   * Get SMS by ID
   */
  async getSmsById(smsId, user) {
    const filter = { _id: smsId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const sms = await Sms.findOne(filter)
      .populate('simId', 'mobileNumber operator')
      .populate('userId', 'name email');

    if (!sms) {
      throw new NotFoundError('SMS log');
    }

    return sms;
  }

  /**
   * Get SMS statistics
   */
  async getSmsStats(companyId, startDate, endDate) {
    const stats = await Sms.getStats(companyId, startDate, endDate);
    const dailyCounts = await Sms.getDailyCounts(companyId, 30);
    const topSenders = await Sms.getTopSenders(companyId, 10);

    return {
      ...stats,
      dailyCounts,
      topSenders,
    };
  }

  /**
   * Export SMS logs to Excel
   */
  async exportSmsLogs(query, user) {
    const { userId, simId, type, sender, search, fromDate, toDate } = query;

    const filter = {};

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    } else if (query.companyId) {
      filter.companyId = query.companyId;
    }

    if (userId) filter.userId = userId;
    if (simId) filter.simId = simId;
    if (type) filter.type = type;
    if (sender) filter.sender = { $regex: sender, $options: 'i' };
    if (search) filter.message = { $regex: search, $options: 'i' };

    if (fromDate || toDate) {
      filter.timestamp = {};
      if (fromDate) filter.timestamp.$gte = new Date(fromDate);
      if (toDate) filter.timestamp.$lte = new Date(toDate);
    }

    const smsLogs = await Sms.find(filter)
      .populate('simId', 'mobileNumber operator')
      .populate('userId', 'name email')
      .sort({ timestamp: -1 })
      .limit(10000);

    return smsLogs;
  }

  /**
   * Delete old SMS logs (for cleanup)
   */
  async deleteOldSmsLogs(companyId, daysToKeep = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await Sms.deleteMany({
      companyId,
      timestamp: { $lt: cutoffDate },
    });

    return { deletedCount: result.deletedCount };
  }

  /**
   * Get unique senders for a company
   */
  async getUniqueSenders(companyId) {
    const senders = await Sms.distinct('sender', { companyId });
    return senders.sort();
  }

  /**
   * Get SMS count by SIM
   */
  async getSmsCountBySim(simId, startDate, endDate) {
    const match = { simId };

    if (startDate || endDate) {
      match.timestamp = {};
      if (startDate) match.timestamp.$gte = new Date(startDate);
      if (endDate) match.timestamp.$lte = new Date(endDate);
    }

    const stats = await Sms.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
        },
      },
    ]);

    const totalSms = await Sms.countDocuments(match);

    return {
      byType: stats,
      totalSms,
    };
  }
}

module.exports = new SmsService();