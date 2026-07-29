const notificationService = require('../../services/notification/notification.service');
const auditLogService = require('../../services/auditLog/auditLog.service');
const { successResponse, paginatedResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

class NotificationController {
  async getAll(req, res, next) {
    try {
      const result = await notificationService.getNotifications(req.query, req.user);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async getUserNotifications(req, res, next) {
    try {
      const result = await notificationService.getUserNotifications(req.user.id, req.query);
      return paginatedResponse(res, result.data, result.total, result.page, result.limit);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const notification = await notificationService.getNotificationById(req.params.id, req.user);
      return successResponse(res, notification);
    } catch (error) {
      next(error);
    }
  }

  async markAsRead(req, res, next) {
    try {
      const notification = await notificationService.markAsRead(req.params.id, req.user);

      // Audit log: NOTIFICATION_READ
      try {
        await auditLogService.logAction({
          action: 'NOTIFICATION_READ',
          module: 'NOTIFICATION',
          description: `Marked notification ${req.params.id} as read`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: req.params.id,
          entityType: 'NOTIFICATION',
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log NOTIFICATION_READ', { error: auditError.message });
      }

      return successResponse(res, notification, 'Notification marked as read');
    } catch (error) {
      next(error);
    }
  }

  async markAllAsRead(req, res, next) {
    try {
      const companyId = req.user.role !== 'super_admin' ? req.user.companyId : null;
      const result = await notificationService.markAllAsRead(req.user.id, companyId, req.user.role);

      // Audit log: NOTIFICATION_BULK_READ
      try {
        await auditLogService.logAction({
          action: 'NOTIFICATION_BULK_READ',
          module: 'NOTIFICATION',
          description: `Marked ${result.modifiedCount || 0} notifications as read`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          metadata: { count: result.modifiedCount || 0 },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log NOTIFICATION_BULK_READ', { error: auditError.message });
      }

      return successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }

  async getUnreadCount(req, res, next) {
    try {
      const companyId = req.user.role !== 'super_admin' ? req.user.companyId : null;
      const result = await notificationService.getUnreadCount(req.user.id, companyId, req.user.role);
      return successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      const result = await notificationService.deleteNotification(req.params.id, req.user);

      // Audit log: NOTIFICATION_DELETE
      try {
        await auditLogService.logAction({
          action: 'NOTIFICATION_DELETE',
          module: 'NOTIFICATION',
          description: `Deleted notification ${req.params.id}`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: req.params.id,
          entityType: 'NOTIFICATION',
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log NOTIFICATION_DELETE', { error: auditError.message });
      }

      return successResponse(res, result);
    } catch (error) {
      next(error)
    }
  }

  async clearRead(req, res, next) {
    try {
      const companyId = req.user.role !== 'super_admin' ? req.user.companyId : null;
      const result = await notificationService.clearReadNotifications(req.user.id, companyId, req.user.role);

      // Audit log: NOTIFICATION_DELETE (bulk clear)
      try {
        await auditLogService.logAction({
          action: 'NOTIFICATION_DELETE',
          module: 'NOTIFICATION',
          description: `Cleared ${result.deletedCount || 0} read notifications`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          metadata: { count: result.deletedCount || 0, bulk: true },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log NOTIFICATION_DELETE', { error: auditError.message });
      }

      return successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }

  async deleteAll(req, res, next) {
    try {
      const companyId = req.user.role !== 'super_admin' ? req.user.companyId : null;
      const result = await notificationService.deleteAllNotifications(req.user.id, companyId, req.user.role);

      // Audit log: NOTIFICATION_DELETE (delete all)
      try {
        await auditLogService.logAction({
          action: 'NOTIFICATION_DELETE',
          module: 'NOTIFICATION',
          description: `Deleted all notifications (${result.deletedCount || 0} total)`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          metadata: { count: result.deletedCount || 0, deleteAll: true },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log NOTIFICATION_DELETE', { error: auditError.message });
      }

      return successResponse(res, result, 'All notifications deleted');
    } catch (error) {
      next(error);
    }
  }

  async deleteSelected(req, res, next) {
    try {
      const { notificationIds } = req.body;

      if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please select at least one notification to delete',
        });
      }

      const companyId = req.user.role !== 'super_admin' ? req.user.companyId : null;
      const result = await notificationService.deleteSelectedNotifications(
        notificationIds,
        req.user.id,
        companyId,
        req.user.role
      );

      // Audit log: NOTIFICATION_DELETE (delete selected)
      try {
        await auditLogService.logAction({
          action: 'NOTIFICATION_DELETE',
          module: 'NOTIFICATION',
          description: `Deleted ${result.deletedCount || 0} selected notifications`,
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          metadata: { count: result.deletedCount || 0, notificationIds: notificationIds.slice(0, 10) },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log NOTIFICATION_DELETE', { error: auditError.message });
      }

      return successResponse(res, result, 'Selected notifications deleted');
    } catch (error) {
      next(error);
    }
  }

  async updatePreferences(req, res, next) {
    try {
      const user = await notificationService.updatePreferences(req.user.id, req.body);

      // Audit log: PREFERENCES_UPDATE
      try {
        await auditLogService.logAction({
          action: 'PREFERENCES_UPDATE',
          module: 'SETTINGS',
          description: 'Updated notification preferences',
          performedBy: req.user._id,
          role: req.user.role,
          companyId: req.user.companyId,
          entityId: req.user.id,
          entityType: 'USER',
          metadata: { preferences: Object.keys(req.body) },
          req,
        });
      } catch (auditError) {
        logger.error('[AUDIT LOG] Failed to log PREFERENCES_UPDATE', { error: auditError.message });
      }

      return successResponse(res, user, 'Preferences updated');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new NotificationController();