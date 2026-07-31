const cron = require('node-cron');
const rechargeService = require('../services/recharge/recharge.service');
const notificationService = require('../services/notification/notification.service');
const notificationHelper = require('../utils/notificationHelper');
const Sim = require('../models/sim/sim.model');
const Company = require('../models/company/company.model');
const User = require('../models/auth/user.model');
const logger = require('../utils/logger');
const CctvCronService = require('./cctvJobs');

class CronService {
  constructor() {
    this.jobs = new Map();
  }

  // Schedule a new job
  schedule(name, expression, callback) {
    if (this.jobs.has(name)) {
      logger.warn(`Job ${name} already exists, replacing...`);
      this.stop(name);
    }

    const job = cron.schedule(expression, callback, {
      scheduled: true,
      timezone: 'Asia/Kolkata',
    });

    this.jobs.set(name, job);
    logger.info(`Job ${name} scheduled: ${expression}`);

    return job;
  }

  // Stop a job
  stop(name) {
    const job = this.jobs.get(name);
    if (job) {
      job.stop();
      this.jobs.delete(name);
      logger.info(`Job ${name} stopped`);
    }
  }

  // Start a stopped job
  start(name) {
    const job = this.jobs.get(name);
    if (job) {
      job.start();
      logger.info(`Job ${name} started`);
    }
  }

  // List all jobs
  list() {
    return Array.from(this.jobs.keys());
  }

  // Initialize all jobs
  initJobs() {
    logger.info('Initializing cron jobs...');

    this.scheduleRechargeReminders();
    this.scheduleInactiveSimAlerts();
    this.scheduleSubscriptionExpiryCheck();
    this.scheduleDataCleanup();
    this.scheduleWhatsAppInactiveCheck();
    this.scheduleTelegramInactiveCheck();
    this.scheduleWifiAlertCheck();
    this.scheduleWifiMetricsCleanup();
    this.scheduleReportDelivery();
    this.scheduleStalePaymentCleanup();

    // Initialize CCTV cron jobs
    const cctvCron = new CctvCronService(this);
    cctvCron.initJobs();

    logger.info('All cron jobs initialized');
  }

  // Recharge reminder job - runs daily at 9 AM
  scheduleRechargeReminders() {
    this.schedule('recharge-reminder', '0 9 * * *', async () => {
      try {
        logger.info('Starting recharge reminder job');

        const companies = await Company.find({ isActive: true });

        for (const company of companies) {
          const upcomingRecharges = await rechargeService.getUpcomingRecharges(
            company._id,
            company.settings?.rechargeReminderDays || 3
          );

          for (const recharge of upcomingRecharges) {
            // Populate SIM and company for notification
            const sim = await Sim.findById(recharge.simId).populate('companyId');
            if (!sim || !sim.companyId) continue;

            const daysLeft = Math.ceil(
              (recharge.nextRechargeDate - new Date()) / (1000 * 60 * 60 * 24)
            );

            // Send notification using notification helper (sends both in-app and email)
            await notificationHelper.notifyRechargeReminder(recharge, sim, sim.companyId, daysLeft);
          }
        }

        logger.info('Recharge reminder job completed');
      } catch (error) {
        logger.error('Recharge reminder job failed:', error);
      }
    });
  }

  // Inactive SIM alert job - runs daily at 10 AM
  scheduleInactiveSimAlerts() {
    this.schedule('inactive-sim-alert', '0 10 * * *', async () => {
      try {
        logger.info('Starting inactive SIM alert job');

        const companies = await Company.find({ isActive: true });

        for (const company of companies) {
          const inactiveDays = company.settings?.inactiveSimDays || 7;
          const inactiveSims = await Sim.findInactive(company._id, inactiveDays);

          for (const sim of inactiveSims) {
            // Populate company for notification
            const simWithCompany = await Sim.findById(sim._id).populate('companyId');
            if (!simWithCompany || !simWithCompany.companyId) continue;

            // Send notification using notification helper (sends both in-app and email)
            await notificationHelper.notifyInactiveSim(simWithCompany, simWithCompany.companyId, inactiveDays);
          }
        }

        logger.info('Inactive SIM alert job completed');
      } catch (error) {
        logger.error('Inactive SIM alert job failed:', error);
      }
    });
  }

  // Subscription expiry check - runs daily at 8 AM
  scheduleSubscriptionExpiryCheck() {
    this.schedule('subscription-expiry-check', '0 8 * * *', async () => {
      try {
        logger.info('Starting subscription expiry check job');

        // Find companies with subscription expiring in 7, 3, 1 days
        const reminderDays = [7, 3, 1];

        for (const days of reminderDays) {
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() + days);

          const companies = await Company.find({
            isActive: true,
            subscriptionEndDate: {
              $gte: new Date(targetDate.setHours(0, 0, 0, 0)),
              $lt: new Date(targetDate.setHours(23, 59, 59, 999)),
            },
          }).populate('subscriptionId');

          for (const company of companies) {
            // Send notification using notification helper (sends both in-app and email)
            await notificationHelper.notifySubscriptionExpiry(company, days);

            // Also notify company admin via email
            const admin = await User.findOne({
              companyId: company._id,
              role: 'admin'
            });

            if (admin) {
              // Create additional notification for admin
              await notificationHelper.createNotification({
                companyId: company._id,
                userId: admin._id,
                type: 'subscription_expiry',
                title: 'Subscription Expiring Soon',
                message: `Your subscription will expire in ${days} days. Please renew to continue using all features.`,
                priority: days <= 3 ? 'critical' : 'high',
                metadata: {
                  companyName: company.name,
                  planName: company.subscriptionId?.name,
                  daysLeft: days,
                  expiryDate: company.subscriptionEndDate,
                },
              });
            }
          }
        }

        // Deactivate expired subscriptions
        const expiredCompanies = await Company.find({
          subscriptionEndDate: { $lt: new Date() },
          isActive: true,
        });

        for (const company of expiredCompanies) {
          company.isActive = false;
          await company.save();
          logger.info(`Company ${company.name} deactivated due to expired subscription`);
        }

        logger.info('Subscription expiry check job completed');
      } catch (error) {
        logger.error('Subscription expiry check job failed:', error);
      }
    });
  }

  // Data cleanup job - runs weekly on Sunday at 2 AM
  scheduleDataCleanup() {
    this.schedule('data-cleanup', '0 2 * * 0', async () => {
      try {
        logger.info('Starting data cleanup job');

        const Notification = require('../models/notification/notification.model');
        const CallLog = require('../models/callLog/callLog.model');

        // Delete read notifications older than 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const notificationResult = await Notification.deleteMany({
          isRead: true,
          createdAt: { $lt: thirtyDaysAgo },
        });

        logger.info(`Cleaned up ${notificationResult.deletedCount} old notifications`);
        logger.info('Data cleanup job completed');
      } catch (error) {
        logger.error('Data cleanup job failed:', error);
      }
    });
  }

  // WhatsApp inactive message check - runs every 5 minutes
  // Marks SIMs as inactive if no reply received within 1 hour
  scheduleWhatsAppInactiveCheck() {
    this.schedule('whatsapp-inactive-check', '*/5 * * * *', async () => {
      try {
        logger.info('Starting WhatsApp inactive check job');

        const whatsAppService = require('../services/whatsapp/whatsapp.service');
        const result = await whatsAppService.processInactiveMessages();

        logger.info(`WhatsApp inactive check completed: ${result.processed} messages processed, ${result.simsUpdated} SIMs marked inactive`);
      } catch (error) {
        logger.error('WhatsApp inactive check job failed:', error);
      }
    });
  }

  // Telegram inactive message check - runs every 5 minutes
  // Marks SIMs as inactive if no reply received within 1 hour
  scheduleTelegramInactiveCheck() {
    this.schedule('telegram-inactive-check', '*/5 * * * *', async () => {
      try {
        logger.info('Starting Telegram inactive check job');

        const telegramService = require('../services/telegram/telegram.service');
        const result = await telegramService.processInactiveMessages();

        logger.info(`Telegram inactive check completed: ${result.processed} messages processed, ${result.simsUpdated} SIMs marked inactive`);
      } catch (error) {
        logger.error('Telegram inactive check job failed:', error);
      }
    });
  }

  // WiFi alert check - runs every 20 minutes
  // Checks WiFi speeds against thresholds and creates/resolves alerts
  scheduleWifiAlertCheck() {
    this.schedule('wifi-alert-check', '*/20 * * * *', async () => {
      try {
        logger.info('Starting WiFi alert check job');

        const wifiService = require('../services/wifi/wifi.service');
        await wifiService.checkAndCreateAlerts();

        logger.info('WiFi alert check job completed');
      } catch (error) {
        logger.error('WiFi alert check job failed:', error);
      }
    });
  }

  // WiFi metrics cleanup - runs weekly on Sunday at 3 AM
  // Cleans old metrics data (older than 30 days)
  scheduleWifiMetricsCleanup() {
    this.schedule('wifi-metrics-cleanup', '0 3 * * 0', async () => {
      try {
        logger.info('Starting WiFi metrics cleanup job');

        const wifiService = require('../services/wifi/wifi.service');
        const result = await wifiService.cleanOldMetrics(30);

        logger.info(`WiFi metrics cleanup completed: ${result.deletedCount} old metrics removed`);
      } catch (error) {
        logger.error('WiFi metrics cleanup job failed:', error);
      }
    });
  }

  // Stale PayU payment cleanup - runs every 30 minutes
  // Cancels pending payments that haven't been confirmed within 30 minutes
  scheduleStalePaymentCleanup() {
    this.schedule('stale-payment-cleanup', '*/30 * * * *', async () => {
      try {
        logger.info('Starting stale PayU payment cleanup job');

        const payuService = require('../services/payu/payu.service');
        const result = await payuService.cleanupStalePayments(30);

        logger.info(`Stale payment cleanup completed: ${result.cleaned} payments cleaned up`);
      } catch (error) {
        logger.error('Stale payment cleanup job failed:', error);
      }
    });
  }

  // Scheduled report delivery - runs every minute to check for schedules that need to fire
  scheduleReportDelivery() {
    this.schedule('report-delivery', '* * * * *', async () => {
      try {
        const ReportSchedule = require('../models/reportSchedule/reportSchedule.model');
        const reportScheduleService = require('../services/reportSchedule/reportSchedule.service');

        const now = new Date();
        logger.info(`[Report Delivery] Cron tick at ${now.toISOString()}`);

        // Use .lean() for the initial query — plain JS objects, no Mongoose document caching issues
        // Then re-fetch a fresh document only for schedules that need to send
        const schedules = await ReportSchedule.find({ isActive: true }).populate('companyId', 'name isActive').lean();

        if (schedules.length === 0) {
          logger.info('[Report Delivery] No active schedules found — skipping');
          return;
        }

        logger.info(`[Report Delivery] Found ${schedules.length} active schedule(s), evaluating each...`);

        let sentCount = 0;
        let skipInactiveCount = 0;
        let skipNotDueCount = 0;
        let errorCount = 0;

        for (const schedule of schedules) {
          const label = schedule.email || schedule._id;
          try {
            // Skip if company is not active or not found
            if (!schedule.companyId || !schedule.companyId.isActive) {
              skipInactiveCount++;
              logger.info(`[Report Delivery] ${label}: SKIPPED — company inactive or not found (companyId=${schedule.companyId})`);
              continue;
            }

            logger.info(`[Report Delivery] ${label}: evaluating (time=${schedule.time}, types=[${(schedule.schedules || []).join(',')}], lastSent=${schedule.lastSentAt || 'never'}, lastStatus=${schedule.lastSendStatus || 'none'})`);

            // Check if this schedule should fire now (using the lean object for evaluation)
            const shouldSend = reportScheduleService.shouldSendNow(schedule, now);
            if (!shouldSend) {
              skipNotDueCount++;
              continue;
            }

            // Re-fetch a fresh Mongoose document for sending — avoids stale document issues
            const freshSchedule = await ReportSchedule.findById(schedule._id);
            if (!freshSchedule) {
              logger.warn(`[Report Delivery] ${label}: schedule was deleted, skipping`);
              skipNotDueCount++;
              continue;
            }

            // Populate companyId on the fresh document for sendScheduledReport
            await freshSchedule.populate('companyId', 'name isActive');

            // Send the report
            logger.info(`[Report Delivery] ${label}: sending report...`);
            const result = await reportScheduleService.sendScheduledReport(freshSchedule);
            if (result.success) {
              sentCount++;
              logger.info(`[Report Delivery] ${label}: ✓ report sent successfully`);
            } else {
              errorCount++;
              logger.error(`[Report Delivery] ${label}: ✗ send failed — ${result.message}`);
            }
          } catch (error) {
            errorCount++;
            logger.error(`[Report Delivery] ${label}: ✗ unhandled error — ${error.message}`, { stack: error.stack });
          }
        }

        logger.info(`[Report Delivery] Job complete: ${sentCount} sent, ${skipNotDueCount} not-due, ${skipInactiveCount} inactive-company, ${errorCount} errors (total: ${schedules.length} schedules)`);
      } catch (error) {
        logger.error('[Report Delivery] Cron job failed:', error);
      }
    });
  }
}

module.exports = new CronService();