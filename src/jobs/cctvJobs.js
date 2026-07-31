const logger = require('../utils/logger');
const Agent = require('../models/cctv/agent.model');
const Camera = require('../models/cctv/camera.model');
const CameraAlert = require('../models/cctv/cameraAlert.model');
const Company = require('../models/company/company.model');
const { emitToCompany } = require('../config/socket');
const notificationHelper = require('../utils/notificationHelper');

class CctvCronService {
  constructor(cronService) {
    this.cronService = cronService;
  }

  /**
   * Snapshot cleanup job - runs daily at 3 AM
   * Deletes snapshots older than the company's retention period
   */
  scheduleSnapshotCleanup() {
    this.cronService.schedule('cctv-snapshot-cleanup', '0 3 * * *', async () => {
      try {
        logger.info('[CCTV] Starting snapshot cleanup job');

        const companies = await Company.find({ isActive: true }).populate('subscriptionId');
        let totalDeleted = 0;
        let totalFailed = 0;

        for (const company of companies) {
          try {
            // Get retention days from subscription limits (default 30)
            const limits = company.subscriptionId?.limits || {};
            const retentionDays = limits.maxSnapshotDays || 30;

            const snapshotService = require('../services/cctv/snapshot.service');
            const result = await snapshotService.cleanupOldSnapshots(company._id, retentionDays);

            totalDeleted += result.deletedCount;
            totalFailed += result.failedCount;
          } catch (error) {
            logger.error(`[CCTV] Snapshot cleanup failed for company ${company._id}:`, error.message);
            totalFailed++;
          }
        }

        logger.info(`[CCTV] Snapshot cleanup completed: ${totalDeleted} deleted, ${totalFailed} failures`);
      } catch (error) {
        logger.error('[CCTV] Snapshot cleanup job failed:', error);
      }
    });
  }

  /**
   * Agent health check - runs every 5 minutes
   * Marks agents offline if no heartbeat for 10 minutes
   */
  scheduleAgentHealthCheck() {
    this.cronService.schedule('cctv-agent-health-check', '*/5 * * * *', async () => {
      try {
        logger.info('[CCTV] Starting agent health check job');

        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

        // Find agents that are marked active but haven't sent a heartbeat recently
        const offlineAgents = await Agent.find({
          status: 'active',
          isActive: true,
          lastHeartbeat: { $lt: tenMinutesAgo },
        });

        for (const agent of offlineAgents) {
          agent.status = 'inactive';
          await agent.save();

          // Create agent offline alert
          try {
            await CameraAlert.createAgentOfflineAlert(
              agent.companyId,
              agent._id,
              `Agent "${agent.name}" is offline - no heartbeat for 10 minutes`
            );
          } catch (alertError) {
            logger.error(`[CCTV] Failed to create offline alert for agent ${agent._id}:`, alertError.message);
          }

          // Notify company admins
          try {
            const company = await Company.findById(agent.companyId);
            if (company) {
              await notificationHelper.notifyAgentOffline(company, agent);
            }
          } catch (notifyError) {
            logger.error(`[CCTV] Failed to notify about agent ${agent._id} going offline:`, notifyError.message);
          }

          // Emit Socket.IO event
          try {
            emitToCompany(agent.companyId.toString(), 'agent:status', {
              agentId: agent._id,
              name: agent.name,
              status: 'offline',
              lastHeartbeat: agent.lastHeartbeat,
            });
          } catch (socketError) {
            // Socket.IO might not be initialized yet
          }
        }

        logger.info(`[CCTV] Agent health check completed: ${offlineAgents.length} agents marked offline`);
      } catch (error) {
        logger.error('[CCTV] Agent health check job failed:', error);
      }
    });
  }

  /**
   * Camera health check - runs every 10 minutes
   * Marks cameras offline if no snapshot for 2x their capture interval
   */
  scheduleCameraHealthCheck() {
    this.cronService.schedule('cctv-camera-health-check', '*/10 * * * *', async () => {
      try {
        logger.info('[CCTV] Starting camera health check job');

        // Find all active cameras that are currently marked online
        const onlineCameras = await Camera.find({
          status: 'online',
          isActive: true,
        });

        let offlineCount = 0;

        for (const camera of onlineCameras) {
          // Check if camera hasn't sent a snapshot for more than 2x its capture interval
          const maxOfflineMinutes = (camera.captureInterval || 30) * 2;
          const threshold = new Date(Date.now() - maxOfflineMinutes * 60 * 1000);

          if (camera.lastSnapshotAt && camera.lastSnapshotAt < threshold) {
            await camera.markOffline();
            offlineCount++;

            // Create camera offline alert
            try {
              await CameraAlert.createCameraOfflineAlert(
                camera.companyId,
                camera._id,
                camera.assignedAgentId,
                `Camera "${camera.name}" is offline - no snapshot for ${maxOfflineMinutes} minutes`
              );
            } catch (alertError) {
              logger.error(`[CCTV] Failed to create offline alert for camera ${camera._id}:`, alertError.message);
            }

            // Notify company admins
            try {
              const company = await Company.findById(camera.companyId);
              if (company) {
                await notificationHelper.notifyCameraOffline(company, camera);
              }
            } catch (notifyError) {
              logger.error(`[CCTV] Failed to notify about camera ${camera._id} going offline:`, notifyError.message);
            }

            // Emit Socket.IO event
            try {
              emitToCompany(camera.companyId.toString(), 'camera:status', {
                cameraId: camera._id,
                name: camera.name,
                previousStatus: 'online',
                newStatus: 'offline',
                timestamp: new Date().toISOString(),
              });
            } catch (socketError) {
              // Socket.IO might not be initialized yet
            }
          }
        }

        // Update company camera stats
        const companies = await Company.find({ isActive: true });
        const cameraService = require('../services/cctv/camera.service');
        for (const company of companies) {
          await cameraService.updateCompanyCameraStats(company._id);
        }

        logger.info(`[CCTV] Camera health check completed: ${offlineCount} cameras marked offline`);
      } catch (error) {
        logger.error('[CCTV] Camera health check job failed:', error);
      }
    });
  }

  /**
   * Camera alert cleanup - runs weekly on Sunday at 4 AM
   * Auto-resolves alerts older than 7 days
   */
  scheduleCameraAlertCleanup() {
    this.cronService.schedule('cctv-alert-cleanup', '0 4 * * 0', async () => {
      try {
        logger.info('[CCTV] Starting camera alert cleanup job');

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const result = await CameraAlert.updateMany(
          {
            status: { $in: ['active', 'acknowledged'] },
            createdAt: { $lt: sevenDaysAgo },
          },
          {
            status: 'resolved',
            resolvedAt: new Date(),
          }
        );

        logger.info(`[CCTV] Alert cleanup completed: ${result.modifiedCount} old alerts auto-resolved`);
      } catch (error) {
        logger.error('[CCTV] Camera alert cleanup job failed:', error);
      }
    });
  }

  /**
   * Initialize all CCTV cron jobs
   */
  initJobs() {
    this.scheduleSnapshotCleanup();
    this.scheduleAgentHealthCheck();
    this.scheduleCameraHealthCheck();
    this.scheduleCameraAlertCleanup();
    logger.info('[CCTV] All CCTV cron jobs initialized');
  }
}

module.exports = CctvCronService;