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
  // Returns true if the schedule should fire, false otherwise
  shouldSendNow(schedule, now) {
    try {
      const scheduleId = schedule._id || 'unknown';
      const scheduleLabel = schedule.email || scheduleId;

      // ── 1. Reliable timezone conversion using Intl.DateTimeFormat ──
      const tz = schedule.timezone || 'Asia/Kolkata';

      // Map short weekday names to JS day numbers (0=Sun, 1=Mon, ..., 6=Sat)
      const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',     // "Sun", "Mon", etc. — reliable across all Node.js versions
        hour12: false,
      });

      const parts = formatter.formatToParts(now);
      const get = (type) => {
        const p = parts.find(p => p.type === type);
        return p ? p.value : '';
      };

      const currentHour = parseInt(get('hour'), 10);
      const currentMinute = parseInt(get('minute'), 10);
      const weekdayShort = get('weekday'); // e.g. "Mon", "Tue", "Wed"
      const currentDay = weekdayMap[weekdayShort] !== undefined ? weekdayMap[weekdayShort] : -1;
      const currentDate = parseInt(get('day'), 10);
      const currentMonth = parseInt(get('month'), 10);
      const currentYear = parseInt(get('year'), 10);

      // ── 2. Exact minute match (cron runs every minute) ──
      const [schedHour, schedMinute] = (schedule.time || '09:00').split(':').map(Number);

      const timeMatches = (currentHour === schedHour && currentMinute === schedMinute);

      logger.info(`[Schedule Check] ${scheduleLabel} | TZ: ${tz} | Current: ${currentHour}:${String(currentMinute).padStart(2, '0')} weekday=${weekdayShort}(${currentDay}) date=${currentDate} | Configured time: ${schedHour}:${String(schedMinute).padStart(2, '0')} | Types: ${(schedule.schedules || []).join(',')} | timeMatch=${timeMatches}`);

      // ── 3. Failed schedule: off-schedule retry path ──
      // If the schedule previously failed and current time does NOT match the scheduled time,
      // allow a retry after a 2-minute cooldown (so we don't spam every minute).
      // If the time DOES match, fall through to the normal time-match logic (step 4+)
      // which will allow the retry regardless of cooldown.
      if (schedule.lastSendStatus === 'failed' && schedule.lastSentAt && !timeMatches) {
        const minsSinceFailed = (now.getTime() - new Date(schedule.lastSentAt).getTime()) / (1000 * 60);
        if (minsSinceFailed < 2) {
          logger.info(`[Schedule Check] ${scheduleLabel} → SKIPPED: failed ${Math.round(minsSinceFailed)}min ago, not at scheduled time, 2min cooldown active`);
          return false;
        }
        // Off-schedule retry: enough time has passed since failure
        logger.info(`[Schedule Check] ${scheduleLabel} → OFF-SCHEDULE RETRY: failed ${Math.round(minsSinceFailed)}min ago, retrying now (not at scheduled time)`);
        return true;
      }

      if (!timeMatches) {
        logger.info(`[Schedule Check] ${scheduleLabel} → SKIPPED: time mismatch (now=${currentHour}:${String(currentMinute).padStart(2, '0')} vs scheduled=${schedHour}:${String(schedMinute).padStart(2, '0')})`);
        return false;
      }

      // ── 4. Schedule type match (daily / weekly / monthly) ──
      const schedules = schedule.schedules || [];
      let scheduleMatch = false;

      if (schedules.includes('daily')) {
        scheduleMatch = true;
      }

      if (schedules.includes('weekly') && schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
        if (schedule.daysOfWeek.includes(currentDay)) {
          scheduleMatch = true;
        } else {
          logger.info(`[Schedule Check] ${scheduleLabel} → weekly type but today (${weekdayShort}=${currentDay}) not in daysOfWeek=[${schedule.daysOfWeek.join(',')}]`);
        }
      }

      if (schedules.includes('monthly') && schedule.daysOfMonth && schedule.daysOfMonth.length > 0) {
        // Clamp day-of-month for months with fewer days (e.g. Feb 30 → Feb 28/29)
        const lastDayOfMonth = new Date(currentYear, currentMonth, 0).getDate(); // month is 1-based here
        const adjustedDates = schedule.daysOfMonth.map(d => Math.min(d, lastDayOfMonth));
        if (adjustedDates.includes(currentDate)) {
          scheduleMatch = true;
        } else {
          logger.info(`[Schedule Check] ${scheduleLabel} → monthly type but today (date=${currentDate}) not in daysOfMonth=[${schedule.daysOfMonth.join(',')}] (adjusted=${adjustedDates.join(',')})`);
        }
      }

      if (!scheduleMatch) {
        logger.info(`[Schedule Check] ${scheduleLabel} → SKIPPED: no schedule type matched (types=[${schedules.join(',')}], weekday=${weekdayShort}(${currentDay}), date=${currentDate})`);
        return false;
      }

      // ── 5. Deduplication for successful sends: prevent duplicate sends ──
      if (schedule.lastSendStatus === 'success' && schedule.lastSentAt) {
        const lastSent = new Date(schedule.lastSentAt);
        const hoursSinceLastSent = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);
        const minsSinceLastSent = Math.round(hoursSinceLastSent * 60);

        // Determine minimum cooldown based on schedule types
        let minCooldownHours = 23; // default: daily

        if (schedules.includes('daily')) {
          minCooldownHours = 23;
        } else if (schedules.includes('weekly') && schedules.includes('monthly')) {
          minCooldownHours = 167; // weekly takes precedence (shorter than monthly)
        } else if (schedules.length === 1 && schedules.includes('weekly')) {
          minCooldownHours = 167; // ~7 days
        } else if (schedules.length === 1 && schedules.includes('monthly')) {
          minCooldownHours = 719; // ~30 days
        }

        if (hoursSinceLastSent < minCooldownHours) {
          logger.info(`[Schedule Check] ${scheduleLabel} → SKIPPED: success cooldown (${minsSinceLastSent}min ago, need ${minCooldownHours * 60}min / ${minCooldownHours}h)`);
          return false;
        }
      }

      // ── 6. Time matches, schedule type matches, not on cooldown → SEND ──
      // If the last send failed, log that this is a retry at the scheduled time
      if (schedule.lastSendStatus === 'failed') {
        const minsSinceFailed = schedule.lastSentAt
          ? Math.round((now.getTime() - new Date(schedule.lastSentAt).getTime()) / (1000 * 60))
          : '?';
        logger.info(`[Schedule Check] ${scheduleLabel} → MATCH (retry of failed send ${minsSinceFailed}min ago): will send report now`);
      } else {
        logger.info(`[Schedule Check] ${scheduleLabel} → MATCH: will send report now`);
      }
      return true;
    } catch (error) {
      logger.error('Error checking schedule timing:', { error: error.message, scheduleId: schedule._id });
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

      logger.info(`[Report Data] Generating report for company "${company.name}" (${companyId}), types=[${types.join(',')}]`);

      // Always include overview data for the email header
      const overview = await DashboardService.getOverview(companyId);
      reportData.sims = overview.sims;
      reportData.recharges = overview.recharges;
      reportData.notifications = overview.notifications;
      logger.info(`[Report Data] Overview data loaded: sims=${JSON.stringify(overview.sims)}, recharges=${JSON.stringify(overview.recharges)}`);

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
    const scheduleLabel = schedule.email || schedule._id || 'unknown';
    const scheduleId = schedule._id;
    let emailSent = false;
    let emailMessageId = null;

    try {
      // Use populated companyId if available, otherwise fetch from DB
      let companyId = schedule.companyId;
      let companyName = 'Your Company';

      if (schedule.companyId && typeof schedule.companyId === 'object' && schedule.companyId._id) {
        // companyId is populated (from cron job query)
        companyName = schedule.companyId.name || companyName;
        companyId = schedule.companyId._id;
        logger.info(`[Report Send] ${scheduleLabel}: using populated company "${companyName}" (${companyId})`);
      } else {
        // companyId is just an ObjectId — fetch company
        const company = await Company.findById(schedule.companyId);
        if (company) {
          companyName = company.name;
          logger.info(`[Report Send] ${scheduleLabel}: fetched company "${companyName}" from DB (${company._id})`);
        } else {
          logger.warn(`[Report Send] ${scheduleLabel}: company not found for ID ${schedule.companyId}`);
        }
      }

      logger.info(`[Report Send] ${scheduleLabel}: generating report data for company "${companyName}", types=[${(schedule.reportTypes || []).join(',')}]`);
      const reportData = await this.generateReportData(companyId, schedule.reportTypes);
      logger.info(`[Report Send] ${scheduleLabel}: report data generated successfully (sims=${!!reportData.sims}, recharges=${!!reportData.recharges}, callStats=${!!reportData.callStats})`);

      const reportTypeLabels = {
        overview: 'Overview',
        sims: 'SIM Report',
        recharges: 'Recharge Report',
        callLogs: 'Call Log Report',
      };

      const types = schedule.reportTypes || ['overview'];
      const reportTypeLabel = types.map(t => reportTypeLabels[t] || t).join(' + ');

      logger.info(`[Report Send] ${scheduleLabel}: sending email to ${schedule.email}, subject="${reportTypeLabel} — ${companyName}"`);

      const emailResult = await emailService.sendScheduledReportEmail(
        schedule.email,
        schedule.name || schedule.email.split('@')[0],
        companyName,
        types,
        reportTypeLabel,
        reportData,
        schedule.scheduleDescription || 'Scheduled Report'
      );

      if (!emailResult.success) {
        // Email service returned failure
        const errorMsg = emailResult.error || 'Email send returned failure with no error message';
        logger.error(`[Report Send] ${scheduleLabel}: email service returned failure — ${errorMsg}`);

        // Use findByIdAndUpdate to avoid DocumentNotFoundError from stale Mongoose documents
        try {
          await ReportSchedule.findByIdAndUpdate(scheduleId, {
            lastSendStatus: 'failed',
            lastSendError: errorMsg.substring(0, 500),
          });
        } catch (dbErr) {
          logger.warn(`[Report Send] ${scheduleLabel}: could not update schedule status: ${dbErr.message}`);
        }

        return { success: false, message: errorMsg };
      }

      // Email sent successfully
      emailSent = true;
      emailMessageId = emailResult.messageId;
      logger.info(`[Report Send] ${scheduleLabel}: email sent successfully (messageId=${emailResult.messageId || 'N/A'})`);

      // Use findByIdAndUpdate to update status — avoids DocumentNotFoundError from stale Mongoose documents
      try {
        await ReportSchedule.findByIdAndUpdate(scheduleId, {
          lastSentAt: new Date(),
          lastSendStatus: 'success',
          lastSendError: null,
        });
        logger.info(`[Report Send] ${scheduleLabel}: SUCCESS — status saved`);
      } catch (dbErr) {
        // Schedule may have been deleted — email was still sent
        logger.warn(`[Report Send] ${scheduleLabel}: could not save success status (schedule may have been deleted): ${dbErr.message}`);
      }

      return { success: true, message: `Report sent to ${schedule.email}` };
    } catch (error) {
      logger.error(`[Report Send] ${scheduleLabel}: FAILED — ${error.message}`, { stack: error.stack });

      // Use findByIdAndUpdate to update error status — avoids DocumentNotFoundError
      try {
        await ReportSchedule.findByIdAndUpdate(scheduleId, {
          lastSendStatus: 'failed',
          lastSendError: error.message.substring(0, 500),
        });
      } catch (dbErr) {
        logger.warn(`[Report Send] ${scheduleLabel}: could not save failure status: ${dbErr.message}`);
      }

      return { success: false, message: error.message };
    }
  }

  // Send a test report to the current user
  async sendTestReport(user) {
    const label = `[Test Report] ${user.email}`;
    try {
      const companyId = user.companyId;
      logger.info(`${label}: starting test report for userId=${user._id}, companyId=${companyId}`);

      // Step 1: Generate report data
      logger.info(`${label}: generating report data...`);
      const reportData = await this.generateReportData(companyId, ['overview']);
      logger.info(`${label}: report data generated (sims=${!!reportData.sims}, recharges=${!!reportData.recharges}, callStats=${!!reportData.callStats})`);

      // Step 2: Get company name
      const company = await Company.findById(companyId);
      const companyName = company ? company.name : 'Your Company';
      logger.info(`${label}: company="${companyName}"`);

      // Step 3: Send email via SMTP
      logger.info(`${label}: calling emailService.sendScheduledReportEmail(to="${user.email}", name="${user.name || user.email.split('@')[0]}")`);
      const emailResult = await emailService.sendScheduledReportEmail(
        user.email,
        user.name || user.email.split('@')[0],
        companyName,
        ['overview'],
        'Test Report',
        reportData,
        'Test (Manual)'
      );

      // Step 4: Check result
      if (!emailResult.success) {
        logger.error(`${label}: email send FAILED — ${emailResult.error}`);
        throw new Error(`Email send failed: ${emailResult.error}`);
      }

      logger.info(`${label}: SUCCESS — test report sent (messageId=${emailResult.messageId || 'N/A'})`);
      return { success: true, message: `Test report sent to ${user.email}` };
    } catch (error) {
      logger.error(`${label}: FAILED — ${error.message}`, { stack: error.stack });
      throw error;
    }
  }
}

module.exports = new ReportScheduleService();