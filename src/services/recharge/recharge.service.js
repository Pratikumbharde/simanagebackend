const Recharge = require('../../models/recharge/recharge.model');
const Sim = require('../../models/sim/sim.model');
const Company = require('../../models/company/company.model');
const Notification = require('../../models/notification/notification.model');
const notificationHelper = require('../../utils/notificationHelper');
const User = require('../../models/auth/user.model');
const { NotFoundError, ForbiddenError, BadRequestError } = require('../../utils/errors');
const { buildPhoneQuery, normalizePhoneNumber } = require('../../utils/response');
const logger = require('../../utils/logger');

class RechargeService {
  async createRecharge(data, user) {
    const { simId, amount, validity, plan, rechargeDate, paymentMethod, transactionId, notes, receiptImage } = data;

    // Get SIM
    const sim = await Sim.findById(simId);
    if (!sim) {
      throw new NotFoundError('SIM');
    }

    // Check access
    if (user.role !== 'super_admin' && sim.companyId.toString() !== user.companyId.toString()) {
      throw new ForbiddenError('Access denied to this SIM');
    }

    // Create recharge
    const recharge = new Recharge({
      companyId: sim.companyId,
      simId,
      amount,
      validity: validity || 28,
      plan,
      rechargeDate: rechargeDate || new Date(),
      paymentMethod: paymentMethod || 'cash',
      transactionId,
      notes,
      receiptImage: receiptImage || null,
      createdBy: user.id,
    });

    await recharge.save();

    // Update SIM last active date
    sim.lastActiveDate = new Date();
    await sim.save();

    // Update company stats
    await this.updateCompanyStats(sim.companyId);

    // Send recharge notification to company admin and SIM assigned user (non-blocking)
    this._sendRechargeNotification(recharge, sim, user).catch(err => {
      logger.error('Failed to send recharge notification:', err.message);
    });

    return recharge.populate('simId', 'mobileNumber operator');
  }

  /**
   * Create recharge automatically from SMS
   * Used by external SMS processing systems
   */
  async createAutoRecharge(data) {
    const {
      mobileNumber,
      amount,
      operator,
      planName,
      validity,
      rechargeDate,
      smsText,
      transactionId,
    } = data;

    // [DUPLICATE CHECK] - Prevent duplicate recharges within ±2 minutes
    const duplicateCheckWindow = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago

    // Find SIM by Contact Number (using phone query for compatibility)
    const phoneQuery = buildPhoneQuery(mobileNumber);
    if (!phoneQuery) {
      throw new BadRequestError('Invalid Contact Number format');
    }

    const sim = await Sim.findOne(phoneQuery);
    if (!sim) {
      throw new NotFoundError('SIM');
    }

    // Check for duplicate recharge: same simId, same amount, within 2 minutes
    const existingRecharge = await Recharge.findOne({
      simId: sim._id,
      amount: amount,
      rechargeDate: { $gte: duplicateCheckWindow },
      source: 'AUTO_SMS',
    });

    if (existingRecharge) {
      logger.warn('Duplicate auto-recharge prevented', {
        mobileNumber,
        amount,
        existingRechargeId: existingRecharge._id,
        simId: sim._id,
      });
      throw new BadRequestError('Duplicate recharge detected. A recharge with the same amount for this Contact Number was created within the last 2 minutes.');
    }

    // Parse validity to number (handle string like "28 days" or "28")
    let validityDays = 28; // default
    if (validity) {
      const validityMatch = validity.toString().match(/(\d+)/);
      if (validityMatch) {
        validityDays = parseInt(validityMatch[1]);
      }
    }

    // Create recharge record
    const recharge = new Recharge({
      companyId: sim.companyId,
      simId: sim._id,
      amount: amount,
      validity: validityDays,
      plan: {
        name: planName || null,
        validity: validityDays,
      },
      rechargeDate: rechargeDate ? new Date(rechargeDate) : new Date(),
      paymentMethod: 'other',
      transactionId: transactionId || null,
      source: 'AUTO_SMS',
      smsText: smsText || null,
      operator: operator || sim.operator || null,
      status: 'completed',
      createdBy: sim.assignedTo || null, // Link to user if SIM is assigned
    });

    await recharge.save();

    // Update SIM last active date
    sim.lastActiveDate = new Date();
    await sim.save();

    // Update company stats
    await this.updateCompanyStats(sim.companyId);

    // Send auto-recharge notification (non-blocking)
    this._sendAutoRechargeNotification(recharge, sim).catch(err => {
      logger.error('Failed to send auto-recharge notification:', err.message);
    });

    logger.info('Auto-recharge created from SMS', {
      rechargeId: recharge._id,
      mobileNumber,
      amount,
      simId: sim._id,
      companyId: sim.companyId,
    });

    return recharge.populate('simId', 'mobileNumber operator status');
  }

  async getAllRecharges(query, user) {
    const {
      page = 1,
      limit = 10,
      simId,
      status,
      startDate,
      endDate,
      sortBy = 'rechargeDate',
      sortOrder = 'desc',
    } = query;

    const filter = {};

    // Data isolation
    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    } else if (query.companyId) {
      filter.companyId = query.companyId;
    }

    if (simId) filter.simId = simId;
    if (status) filter.status = status;

    if (startDate || endDate) {
      filter.rechargeDate = {};
      if (startDate) filter.rechargeDate.$gte = new Date(startDate);
      if (endDate) filter.rechargeDate.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const recharges = await Recharge.find(filter)
      .populate('simId', 'mobileNumber operator status')
      .populate('createdBy', 'name')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await Recharge.countDocuments(filter);

    return { data: recharges, total, page: parseInt(page), limit: parseInt(limit) };
  }

  async getRechargeById(rechargeId, user) {
    const filter = { _id: rechargeId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const recharge = await Recharge.findOne(filter)
      .populate('simId', 'mobileNumber operator status')
      .populate('createdBy', 'name');

    if (!recharge) {
      throw new NotFoundError('Recharge');
    }

    return recharge;
  }

  async updateRecharge(rechargeId, updateData, user) {
    const filter = { _id: rechargeId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const allowedUpdates = ['amount', 'validity', 'plan', 'notes', 'status', 'receiptImage'];
    const updates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    const recharge = await Recharge.findOneAndUpdate(filter, updates, {
      new: true,
      runValidators: true,
    }).populate('simId', 'mobileNumber operator');

    if (!recharge) {
      throw new NotFoundError('Recharge');
    }

    return recharge;
  }

  async deleteRecharge(rechargeId, user) {
    const filter = { _id: rechargeId };

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    }

    const recharge = await Recharge.findOneAndDelete(filter);

    if (!recharge) {
      throw new NotFoundError('Recharge');
    }

    // Update company stats
    await this.updateCompanyStats(recharge.companyId);

    return recharge;
  }

  async getUpcomingRecharges(companyId, days = 7) {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const recharges = await Recharge.find({
      companyId,
      nextRechargeDate: {
        $gte: now,
        $lte: futureDate,
      },
      status: 'completed',
      reminderSent: false,
    })
      .populate('simId', 'mobileNumber operator status circle')
      .sort({ nextRechargeDate: 1 });

    return recharges;
  }

  async getOverdueRecharges(companyId) {
    return Recharge.find({
      companyId,
      nextRechargeDate: { $lt: new Date() },
      status: 'completed',
    })
      .populate('simId', 'mobileNumber operator status circle')
      .sort({ nextRechargeDate: 1 });
  }

  async getSimRechargeHistory(simId, limit = 10) {
    return Recharge.find({ simId, status: 'completed' })
      .sort({ rechargeDate: -1 })
      .limit(limit);
  }

  async getRechargeStats(companyId, startDate, endDate) {
    const query = { companyId, status: 'completed' };

    if (startDate || endDate) {
      query.rechargeDate = {};
      if (startDate) query.rechargeDate.$gte = new Date(startDate);
      if (endDate) query.rechargeDate.$lte = new Date(endDate);
    }

    const stats = await Recharge.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
          avgAmount: { $avg: '$amount' },
          minAmount: { $min: '$amount' },
          maxAmount: { $max: '$amount' },
        },
      },
    ]);

    const monthlyStats = await Recharge.aggregate([
      { $match: query },
      {
        $group: {
          _id: {
            year: { $year: '$rechargeDate' },
            month: { $month: '$rechargeDate' },
          },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 },
    ]);

    return {
      overall: stats[0] || { totalAmount: 0, count: 0, avgAmount: 0 },
      monthly: monthlyStats,
    };
  }

  async processReminders() {
    const companies = await Company.find({ isActive: true });

    let remindersSent = 0;

    for (const company of companies) {
      const upcomingRecharges = await this.getUpcomingRecharges(
        company._id,
        company.settings.rechargeReminderDays || 3
      );

      for (const recharge of upcomingRecharges) {
        const daysLeft = Math.ceil(
          (recharge.nextRechargeDate - new Date()) / (1000 * 60 * 60 * 24)
        );

        await Notification.createRechargeReminder(company, recharge.simId, recharge, daysLeft);

        recharge.reminderSent = true;
        recharge.reminderSentAt = new Date();
        await recharge.save();

        remindersSent++;
      }
    }

    return { remindersSent };
  }

  async updateCompanyStats(companyId) {
    const totalRecharges = await Recharge.countDocuments({
      companyId,
      status: 'completed',
    });

    const stats = await Recharge.getTotalSpent(companyId);

    await Company.findByIdAndUpdate(companyId, {
      'stats.totalRecharges': totalRecharges,
      'stats.totalSpent': stats.total,
    });
  }

  /**
   * Send recharge notification to company admin and SIM assigned user
   * @param {Object} recharge - Recharge document
   * @param {Object} sim - SIM document
   * @param {Object} performedBy - User who performed the recharge
   */
  async _sendRechargeNotification(recharge, sim, performedBy) {
    try {
      const company = await Company.findById(sim.companyId);
      if (!company) return;

      const notificationData = {
        companyId: company._id,
        type: 'recharge_due',
        title: `Recharge Added - ${sim.mobileNumber}`,
        message: `Recharge of ₹${recharge.amount} has been added for SIM ${sim.mobileNumber} (${sim.operator}). Valid for ${recharge.validity} days.`,
        priority: 'medium',
        metadata: {
          companyName: company.name,
          simNumber: sim.mobileNumber,
          amount: recharge.amount,
          validity: recharge.validity,
        },
        data: { simId: sim._id, rechargeId: recharge._id },
      };

      // Get company admin
      const admin = await User.findOne({ companyId: company._id, role: 'admin' });

      // Notify admin
      if (admin) {
        await notificationHelper.createWithNotification(
          { ...notificationData, userId: admin._id },
          {
            to: admin.email,
            subject: `Recharge Added - ${sim.mobileNumber}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #16a34a, #15803d); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                  <h1 style="margin: 0;">Recharge Added</h1>
                </div>
                <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                  <h2>Hello ${admin.name},</h2>
                  <p>A recharge has been added to a SIM card.</p>
                  <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; margin: 15px 0;">
                    <p style="margin: 0;"><strong>Contact Number:</strong> ${sim.mobileNumber}</p>
                    <p style="margin: 10px 0 0 0;"><strong>Operator:</strong> ${sim.operator}</p>
                    <p style="margin: 10px 0 0 0;"><strong>Amount:</strong> ₹${recharge.amount}</p>
                    <p style="margin: 10px 0 0 0;"><strong>Validity:</strong> ${recharge.validity} days</p>
                    <p style="margin: 10px 0 0 0;"><strong>Plan:</strong> ${recharge.plan?.name || 'N/A'}</p>
                    ${recharge.nextRechargeDate ? `<p style="margin: 10px 0 0 0;"><strong>Next Recharge Date:</strong> ${new Date(recharge.nextRechargeDate).toDateString()}</p>` : ''}
                  </div>
                  ${performedBy ? `<p>Added by: ${performedBy.name}</p>` : ''}
                  <p>Best regards,<br>SIM Management Team</p>
                </div>
              </div>
            `,
          }
        );
      }

      // Also notify the user if SIM is assigned
      if (sim.assignedTo) {
        const assignedUser = await User.findById(sim.assignedTo);
        if (assignedUser && (!admin || assignedUser._id.toString() !== admin._id.toString())) {
          await notificationHelper.createNotification({
            ...notificationData,
            userId: assignedUser._id,
            title: `Your SIM Recharged - ${sim.mobileNumber}`,
            message: `Your SIM ${sim.mobileNumber} has been recharged with ₹${recharge.amount}. Valid for ${recharge.validity} days.`,
          });
        }
      }
    } catch (error) {
      logger.error('Error sending recharge notification:', error.message);
    }
  }

  /**
   * Send auto-recharge notification (from SMS)
   * @param {Object} recharge - Recharge document
   * @param {Object} sim - SIM document
   */
  async _sendAutoRechargeNotification(recharge, sim) {
    try {
      const company = await Company.findById(sim.companyId);
      if (!company) return;

      const notificationData = {
        companyId: company._id,
        type: 'recharge_due',
        title: `Auto-Recharge Detected - ${sim.mobileNumber}`,
        message: `Auto-recharge of ₹${recharge.amount} detected for SIM ${sim.mobileNumber} (${sim.operator}) from SMS.`,
        priority: 'medium',
        metadata: {
          companyName: company.name,
          simNumber: sim.mobileNumber,
          amount: recharge.amount,
          validity: recharge.validity,
        },
        data: { simId: sim._id, rechargeId: recharge._id },
      };

      // Get company admin
      const admin = await User.findOne({ companyId: company._id, role: 'admin' });

      if (admin) {
        await notificationHelper.createWithNotification(
          { ...notificationData, userId: admin._id },
          {
            to: admin.email,
            subject: `Auto-Recharge Detected - ${sim.mobileNumber}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                  <h1 style="margin: 0;">Auto-Recharge Detected</h1>
                </div>
                <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                  <h2>Hello ${admin.name},</h2>
                  <p>An automatic recharge has been detected from SMS.</p>
                  <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; margin: 15px 0;">
                    <p style="margin: 0;"><strong>Contact Number:</strong> ${sim.mobileNumber}</p>
                    <p style="margin: 10px 0 0 0;"><strong>Operator:</strong> ${sim.operator}</p>
                    <p style="margin: 10px 0 0 0;"><strong>Amount:</strong> ₹${recharge.amount}</p>
                    <p style="margin: 10px 0 0 0;"><strong>Validity:</strong> ${recharge.validity} days</p>
                    <p style="margin: 10px 0 0 0;"><strong>Detected At:</strong> ${new Date(recharge.createdAt).toLocaleString()}</p>
                  </div>
                  <p>Best regards,<br>SIM Management Team</p>
                </div>
              </div>
            `,
          }
        );
      }

      // Also notify the user if SIM is assigned
      if (sim.assignedTo) {
        const assignedUser = await User.findById(sim.assignedTo);
        if (assignedUser && (!admin || assignedUser._id.toString() !== admin._id.toString())) {
          await notificationHelper.createNotification({
            ...notificationData,
            userId: assignedUser._id,
            title: `Your SIM Auto-Recharged - ${sim.mobileNumber}`,
            message: `Your SIM ${sim.mobileNumber} has been auto-recharged with ₹${recharge.amount}.`,
          });
        }
      }
    } catch (error) {
      logger.error('Error sending auto-recharge notification:', error.message);
    }
  }

  async exportRecharges(query, user) {
    const { simId, status, startDate, endDate } = query;

    const filter = {};

    if (user.role !== 'super_admin') {
      filter.companyId = user.companyId;
    } else if (query.companyId) {
      filter.companyId = query.companyId;
    }

    if (simId) filter.simId = simId;
    if (status) filter.status = status;

    if (startDate || endDate) {
      filter.rechargeDate = {};
      if (startDate) filter.rechargeDate.$gte = new Date(startDate);
      if (endDate) filter.rechargeDate.$lte = new Date(endDate);
    }

    const recharges = await Recharge.find(filter)
      .populate('simId', 'mobileNumber operator status')
      .populate('createdBy', 'name')
      .sort({ rechargeDate: -1 })
      .limit(10000);

    return recharges;
  }
}

module.exports = new RechargeService();