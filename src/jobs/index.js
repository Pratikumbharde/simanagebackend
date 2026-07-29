const cron = require('node-cron');
const rechargeService = require('../services/recharge/recharge.service');
const notificationService = require('../services/notification/notification.service');
const notificationHelper = require('../utils/notificationHelper');
const Sim = require('../models/sim/sim.model');
const Company = require('../models/company/company.model');
const User = require('../models/auth/user.model');
const logger = require('../utils/logger');

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

  // Scheduled report delivery - runs every minute to check for schedules that need to fire
  scheduleReportDelivery() {
    this.schedule('report-delivery', '* * * * *', async () => {
      try {
        const ReportSchedule = require('../models/reportSchedule/reportSchedule.model');
        const reportScheduleService = require('../services/reportSchedule/reportSchedule.service');

        const now = new Date();

        // Find all active schedules
        const schedules = await ReportSchedule.find({ isActive: true }).populate('companyId', 'name isActive');

        let sentCount = 0;
        let skipCount = 0;
        let errorCount = 0;

        for (const schedule of schedules) {
          try {
            // Skip if company is not active
            if (!schedule.companyId || !schedule.companyId.isActive) {
              skipCount++;
              continue;
            }

            // Check if this schedule should fire now
            const shouldSend = reportScheduleService.shouldSendNow(schedule, now);
            if (!shouldSend) {
              skipCount++;
              continue;
            }

            // Send the report
            await reportScheduleService.sendScheduledReport(schedule);
            sentCount++;
          } catch (error) {
            errorCount++;
            logger.error(`Failed to send scheduled report to ${schedule.email}:`, error.message);
            // Continue with next schedule even if one fails
          }
        }

        if (sentCount > 0 || errorCount > 0) {
          logger.info(`Report delivery job completed: ${sentCount} sent, ${skipCount} skipped, ${errorCount} errors`);
        }
      } catch (error) {
        logger.error('Report delivery job failed:', error);
      }
    });
  }
}

module.exports = new CronService();