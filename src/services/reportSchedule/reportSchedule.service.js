const ReportSchedule = require('../../models/reportSchedule/reportSchedule.model');
const Sim = require('../../models/sim/sim.model');
const Recharge = require('../../models/recharge/recharge.model');
const CallLog = require('../../models/callLog/callLog.model');
const Company = require('../../models/company/company.model');
const Notification = require('../../models/notification/notification.model');
const DashboardService = require('../dashboard/dashboard.service');
const emailService = require('../../utils/emailService');
const logger = require('../../utils/logger');
const mongoose = require('mongoose');

class ReportScheduleService {
  // Get all schedules for a company
  async getAll(query, user) {
    const filter = { companyId: user.companyId };

    // Super admin can see all or filter by company
    if (user.role === 'super_admin' && query.companyId) {
      filter.companyId = new mongoose.Types.ObjectId(query.companyId);
    }

    const schedules = await ReportSchedule.find(filter)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    return { data: schedules, total: schedules.length };
  }

  // Get a single schedule by ID
  async getById(id, user) {
    const schedule = await ReportSchedule.findById(id)
      .populate('createdBy', 'name email');

    if (!schedule) {
      throw new Error('Schedule not found');
    }

    // Check company access
    if (user.role !== 'super_admin' && schedule.companyId.toString() !== user.companyId.toString()) {
      throw new Error('Access denied. You can only access your own company schedules.');
    }

    return schedule;
  }

  // Create a new schedule
  async create(data, user) {
    const scheduleData = {
      ...data,
      companyId: user.companyId || data.companyId,
      createdBy: user._id,
    };

    // If super admin, allow specifying companyId
    if (user.role === 'super_admin' && data.companyId) {
      scheduleData.companyId = data.companyId;
    }

    // Validate schedule-specific fields
    this.validateScheduleFields(scheduleData);

    const schedule = await ReportSchedule.create(scheduleData);
    return await ReportSchedule.findById(schedule._id).populate('createdBy', 'name email');
  }

  // Update a schedule
  async update(id, data, user) {
    const schedule = await ReportSchedule.findById(id);

    if (!schedule) {
      throw new Error('Schedule not found');
    }

    // Check company access
    if (user.role !== 'super_admin' && schedule.companyId.toString() !== user.companyId.toString()) {
      throw new Error('Access denied. You can only update your own company schedules.');
    }

    // Validate schedule-specific fields
    this.validateScheduleFields(data);

    // Update allowed fields
    const allowedUpdates = ['email', 'name', 'schedules', 'time', 'timezone', 'daysOfWeek', 'daysOfMonth', 'reportTypes', 'isActive'];
    allowedUpdates.forEach(field => {
      if (data[field] !== undefined) {
        schedule[field] = data[field];
      }
    });

    await schedule.save();
    return await ReportSchedule.findById(schedule._id).populate('createdBy', 'name email');
  }

  // Toggle schedule active/inactive
  async toggle(id, user) {
    const schedule = await ReportSchedule.findById(id);

    if (!schedule) {
      throw new Error('Schedule not found');
    }

    // Check company access
    if (user.role !== 'super_admin' && schedule.companyId.toString() !== user.companyId.toString()) {
      throw new Error('Access denied. You can only toggle your own company schedules.');
    }

    schedule.isActive = !schedule.isActive;
    await schedule.save();
    return await ReportSchedule.findById(schedule._id).populate('createdBy', 'name email');
  }

  // Delete a schedule
  async delete(id, user) {
    const schedule = await ReportSchedule.findById(id);

    if (!schedule) {
      throw new Error('Schedule not found');
    }

    // Check company access
    if (user.role !== 'super_admin' && schedule.companyId.toString() !== user.companyId.toString()) {
      throw new Error('Access denied. You can only delete your own company schedules.');
    }

    await ReportSchedule.findByIdAndDelete(id);
    return { success: true, message: 'Schedule deleted successfully' };
  }

  // Validate schedule-specific fields
  validateScheduleFields(data) {
    if (!data.schedules || !Array.isArray(data.schedules) || data.schedules.length === 0) {
      throw new Error('At least one schedule frequency is required');
    }
    if (data.schedules.includes('weekly') && (!data.daysOfWeek || data.daysOfWeek.length === 0)) {
      throw new Error('At least one day of week is required for weekly schedule');
    }
    if (data.schedules.includes('monthly') && (!data.daysOfMonth || data.daysOfMonth.length === 0)) {
      throw new Error('At least one day of month is required for monthly schedule');
    }
    if (!data.reportTypes || !Array.isArray(data.reportTypes) || data.reportTypes.length === 0) {
      throw new Error('At least one report type is required');
    }
  }

  // Check if a schedule should be sent now based on current time and schedule config
  shouldSendNow(schedule, now) {
    try {
      // Convert current UTC time to the schedule's timezone
      const scheduleTime = new Date(now.toLocaleString('en-US', { timeZone: schedule.timezone || 'Asia/Kolkata' }));
      const currentHour = scheduleTime.getHours();
      const currentMinute = scheduleTime.getMinutes();
      const currentDay = scheduleTime.getDay(); // 0=Sunday
      const currentDate = scheduleTime.getDate(); // 1-31

      // Parse schedule time
      const [schedHour, schedMinute] = (schedule.time || '09:00').split(':').map(Number);

      // Check time match (within a 5-minute window)
      const timeMatch = currentHour === schedHour && Math.abs(currentMinute - schedMinute) < 5;

      if (!timeMatch) return false;

      // Determine schedule type match
      const schedules = schedule.schedules || [];
      let scheduleMatch = false;

      if (schedules.includes('daily')) {
        scheduleMatch = true;
      }

      if (schedules.includes('weekly') && schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
        if (schedule.daysOfWeek.includes(currentDay)) {
          scheduleMatch = true;
        }
      }

      if (schedules.includes('monthly') && schedule.daysOfMonth && schedule.daysOfMonth.length > 0) {
        // Handle months with fewer days than target dates
        const lastDayOfMonth = new Date(scheduleTime.getFullYear(), scheduleTime.getMonth() + 1, 0).getDate();
        const adjustedDates = schedule.daysOfMonth.map(d => Math.min(d, lastDayOfMonth));
        if (adjustedDates.includes(currentDate)) {
          scheduleMatch = true;
        }
      }

      if (!scheduleMatch) return false;

      // Check if already sent in this period (avoid duplicate sends)
      if (schedule.lastSentAt) {
        const lastSent = new Date(schedule.lastSentAt);
        const hoursSinceLastSent = (now - lastSent) / (1000 * 60 * 60);

        // If any schedule type is daily, minimum 23 hours between sends
        if (schedules.includes('daily') && hoursSinceLastSent < 23) return false;
        // If weekly only, minimum 167 hours
        if (schedules.length === 1 && schedules.includes('weekly') && hoursSinceLastSent < 167) return false;
        // If monthly only, minimum 719 hours
        if (schedules.length === 1 && schedules.includes('monthly') && hoursSinceLastSent < 719) return false;
        // For mixed schedules, use the shortest period (daily = 23h)
        if (!schedules.includes('daily') && hoursSinceLastSent < 23) return false;
      }

      return true;
    } catch (error) {
      logger.error('Error checking schedule timing:', error);
      return false;
    }
  }

  // Generate report data for a schedule (supports multiple report types)
  async generateReportData(companyId, reportTypes) {
    try {
      const company = await Company.findById(companyId);
      if (!company) {
        throw new Error('Company not found');
      }

      const types = Array.isArray(reportTypes) ? reportTypes : [reportTypes || 'overview'];
      const reportData = {
        companyName: company.name,
        reportTypes: types,
        generatedAt: new Date(),
      };

      // Always include overview data for the email header
      const overview = await DashboardService.prototype.getOverview.call(new DashboardService(), companyId);
      reportData.sims = overview.sims;
      reportData.recharges = overview.recharges;
      reportData.notifications = overview.notifications;

      // Add SIM details if requested
      if (types.includes('sims') || types.includes('overview')) {
        const simStats = await Sim.aggregate([
          { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
          { $group: { _id: '$operator', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]);
        reportData.operatorBreakdown = simStats;
      }

      // Add recharge details if requested
      if (types.includes('recharges')) {
        const currentMonth = new Date();
        currentMonth.setDate(1);
        currentMonth.setHours(0, 0, 0, 0);

        const rechargeDetails = await Recharge.find({
          companyId,
          status: 'completed',
          rechargeDate: { $gte: currentMonth },
        })
          .populate('simId', 'mobileNumber operator')
          .sort({ rechargeDate: -1 })
          .limit(10)
          .lean();

        reportData.rechargeDetails = rechargeDetails;
      }

      // Add call log details if requested
      if (types.includes('callLogs') || types.includes('overview')) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const callStats = await CallLog.aggregate([
          { $match: { companyId: new mongoose.Types.ObjectId(companyId), timestamp: { $gte: thirtyDaysAgo } } },
          { $group: { _id: '$callType', count: { $sum: 1 }, totalDuration: { $sum: '$duration' } } },
        ]);

        reportData.callStats = callStats.reduce((acc, stat) => {
          acc[stat._id] = { count: stat.count, totalDuration: stat.totalDuration };
          return acc;
        }, {});
      }

      return reportData;
    } catch (error) {
      logger.error('Error generating report data:', error);
      throw error;
    }
  }

  // Send a scheduled report email
  async sendScheduledReport(schedule) {
    try {
      const reportData = await this.generateReportData(schedule.companyId, schedule.reportTypes);

      const company = await Company.findById(schedule.companyId);
      const companyName = company ? company.name : 'Your Company';

      const reportTypeLabels = {
        overview: 'Overview',
        sims: 'SIM Report',
        recharges: 'Recharge Report',
        callLogs: 'Call Log Report',
      };

      const types = schedule.reportTypes || ['overview'];
      const reportTypeLabel = types.map(t => reportTypeLabels[t] || t).join(' + ');

      await emailService.sendScheduledReportEmail(
        schedule.email,
        schedule.name || schedule.email.split('@')[0],
        companyName,
        types,
        reportTypeLabel,
        reportData,
        schedule.scheduleDescription || 'Scheduled Report'
      );

      // Update last sent status
      schedule.lastSentAt = new Date();
      schedule.lastSendStatus = 'success';
      schedule.lastSendError = null;
      await schedule.save();

      logger.info(`Scheduled report sent successfully to ${schedule.email} (${types.join(', ')})`);
      return { success: true, message: `Report sent to ${schedule.email}` };
    } catch (error) {
      logger.error(`Failed to send scheduled report to ${schedule.email}:`, error);

      // Update last sent status with error
      schedule.lastSentAt = new Date();
      schedule.lastSendStatus = 'failed';
      schedule.lastSendError = error.message;
      await schedule.save();

      return { success: false, message: error.message };
    }
  }

  // Send a test report to the current user
  async sendTestReport(user) {
    try {
      const companyId = user.companyId;
      const reportData = await this.generateReportData(companyId, ['overview']);

      const company = await Company.findById(companyId);
      const companyName = company ? company.name : 'Your Company';

      await emailService.sendScheduledReportEmail(
        user.email,
        user.name || user.email.split('@')[0],
        companyName,
        ['overview'],
        'Test Report',
        reportData,
        'Test (Manual)'
      );

      return { success: true, message: `Test report sent to ${user.email}` };
    } catch (error) {
      logger.error('Failed to send test report:', error);
      throw error;
    }
  }
}

module.exports = new ReportScheduleService();