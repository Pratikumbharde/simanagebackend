const Notification = require('../../models/notification/notification.model');
const Company = require('../../models/company/company.model');
const User = require('../../models/auth/user.model');
const Sim = require('../../models/sim/sim.model');
const Recharge = require('../../models/recharge/recharge.model');
const emailService = require('../../utils/emailService');
const notificationHelper = require('../../utils/notificationHelper');
const { NotFoundError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class NotificationService {
  async getNotifications(query, user) {
    const { page = 1, limit = 20, type, isRead, priority } = query;

    const filter = {};

    // Data isolation: Each user sees only their own notifications
    if (user.role === 'super_admin') {
      // Super admin sees only their own personal notifications
      // or system-wide notifications (where userId is null and type is 'system')
      filter.$or = [
        { userId: user._id },
        { userId: null, type: 'system' }
      ];
    } else {
      // Company users see notifications for their company
      filter.companyId = user.companyId;
    }

    if (type) filter.type = type;
    if (isRead !== undefined) filter.isRead = isRead === 'true';
    if (priority) filter.priority = priority;

    const skip = (page - 1) * limit;

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(filter);

    logger.info('Fetched notifications', { userId: user._id, count: notifications.length, total });

    return { data: notifications, total, page: parseInt(page), limit: parseInt(limit) };
  }

  async getUserNotifications(userId, query) {
    const { page = 1, limit = 20, isRead } = query;

    const filter = { userId };
    if (isRead !== undefined) filter.isRead = isRead === 'true';

    const skip = (page - 1) * limit;

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(filter);

    return { data: notifications, total, page: parseInt(page), limit: parseInt(limit) };
  }

  async getNotificationById(notificationId, user) {
    const filter = { _id: notificationId };

    // Apply user isolation
    if (user.role === 'super_admin') {
      // Super admin can only see their own notifications
      filter.$or = [
        { userId: user._id },
        { userId: null, type: 'system' }
      ];
    } else {
      // Company users can only see their company's notifications
      filter.companyId = user.companyId;
    }

    const notification = await Notification.findOne(filter);

    if (!notification) {
      throw new NotFoundError('Notification');
    }

    return notification;
  }

  async markAsRead(notificationId, user) {
    const filter = { _id: notificationId };

    // Apply user isolation
    if (user.role === 'super_admin') {
      filter.$or = [
        { userId: user._id },
        { userId: null, type: 'system' }
      ];
    } else {
      filter.companyId = user.companyId;
    }

    const notification = await Notification.findOneAndUpdate(
      filter,
      { isRead: true, readAt: new Date(), status: 'read' },
      { new: true }
    );

    if (!notification) {
      throw new NotFoundError('Notification');
    }

    return notification;
  }

  async markAllAsRead(userId, companyId, userRole) {
    let filter;

    if (userRole === 'super_admin') {
      // Super admin marks their own notifications as read
      filter = { userId: userId, isRead: false };
    } else {
      // Company users mark all company notifications as read
      filter = { companyId: companyId, isRead: false };
    }

    await Notification.updateMany(filter, {
      isRead: true,
      readAt: new Date(),
      status: 'read',
    });

    return { message: 'All notifications marked as read' };
  }

  async getUnreadCount(userId, companyId, userRole) {
    let filter;

    if (userRole === 'super_admin') {
      // Super admin sees their own unread notifications
      filter = {
        $or: [
          { userId: userId, isRead: false },
          { userId: null, type: 'system', isRead: false }
        ]
      };
    } else {
      // Company users see their company's unread notifications
      filter = { companyId: companyId, isRead: false };
    }

    const count = await Notification.countDocuments(filter);
    return { unreadCount: count };
  }

  async createNotification(data) {
    const notification = new Notification(data);
    await notification.save();
    return notification;
  }

  async sendRechargeReminder(recharge) {
    const sim = await Sim.findById(recharge.simId).populate('companyId');
    if (!sim) return null;

    const daysLeft = Math.ceil(
      (recharge.nextRechargeDate - new Date()) / (1000 * 60 * 60 * 24)
    );

    // Create notification
    const notification = await Notification.createRechargeReminder(
      sim.companyId,
      sim,
      recharge,
      daysLeft
    );

    // Send email if enabled
    if (sim.companyId.settings?.notificationsEnabled) {
      const admin = await User.findOne({ companyId: sim.companyId._id, role: 'admin' });
      if (admin) {
        await emailService.sendRechargeReminder(admin, sim, recharge);
        notification.markAsSent('email', true);
      }
    }

    return notification;
  }

  async sendInactiveSimAlert(sim) {
    const simWithCompany = await Sim.findById(sim._id).populate('companyId');
    if (!simWithCompany) return null;

    // Create notification
    const notification = await Notification.createInactiveSimAlert(
      simWithCompany.companyId,
      simWithCompany
    );

    // Send email if enabled
    if (simWithCompany.companyId.settings?.notificationsEnabled) {
      const admin = await User.findOne({
        companyId: simWithCompany.companyId._id,
        role: 'admin',
      });
      if (admin) {
        await emailService.sendEmail({
          to: admin.email,
          subject: `Inactive SIM Alert - ${simWithCompany.mobileNumber}`,
          html: `
            <h2>Inactive SIM Alert</h2>
            <p>Dear ${admin.name},</p>
            <p>SIM <strong>${simWithCompany.mobileNumber}</strong> (${simWithCompany.operator}) has been inactive for ${simWithCompany.companyId.settings.inactiveSimDays} days.</p>
            <p>Please check the SIM status and take necessary action.</p>
            <br>
            <p>Best regards,<br>SIM Management Team</p>
          `,
        });
        notification.markAsSent('email', true);
      }
    }

    return notification;
  }

  async sendSubscriptionExpiryNotice(company, daysLeft) {
    // Create notification
    const notification = await Notification.createSubscriptionExpiry(company, daysLeft);

    // Send email
    await emailService.sendSubscriptionExpiryNotice(company, daysLeft);
    notification.markAsSent('email', true);

    return notification;
  }

  async deleteNotification(notificationId, user) {
    const filter = { _id: notificationId };

    // Apply user isolation
    if (user.role === 'super_admin') {
      filter.$or = [
        { userId: user._id },
        { userId: null, type: 'system' }
      ];
    } else {
      filter.companyId = user.companyId;
    }

    await Notification.findOneAndDelete(filter);
    return { message: 'Notification deleted' };
  }

  async clearReadNotifications(userId, companyId, userRole) {
    let filter;

    if (userRole === 'super_admin') {
      // Super admin clears their own read notifications
      filter = { userId: userId, isRead: true };
    } else {
      // Company users clear their company's read notifications
      filter = {
        companyId,
        isRead: true,
        createdAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // 7 days old
      };
    }

    await Notification.deleteMany(filter);

    return { message: 'Read notifications cleared' };
  }

  async deleteAllNotifications(userId, companyId, userRole) {
    let filter;

    if (userRole === 'super_admin') {
      // Super admin deletes their own notifications
      filter = { userId: userId };
    } else {
      // Company users delete all their company's notifications
      filter = { companyId: companyId };
    }

    const result = await Notification.deleteMany(filter);

    return { message: 'All notifications deleted', deletedCount: result.deletedCount };
  }

  async deleteSelectedNotifications(notificationIds, userId, companyId, userRole) {
    let filter = { _id: { $in: notificationIds } };

    if (userRole === 'super_admin') {
      // Super admin can only delete their own notifications
      filter.userId = userId;
    } else {
      // Company users can only delete their company's notifications
      filter.companyId = companyId;
    }

    const result = await Notification.deleteMany(filter);

    return { message: 'Selected notifications deleted', deletedCount: result.deletedCount };
  }

  async updatePreferences(userId, preferences) {
    const user = await User.findByIdAndUpdate(
      userId,
      { preferences: { ...preferences } },
      { new: true }
    ).select('-password');

    return user;
  }
}

module.exports = new NotificationService();