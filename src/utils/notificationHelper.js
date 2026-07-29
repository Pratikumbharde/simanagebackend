const Notification = require('../models/notification/notification.model');
const emailService = require('./emailService');
const logger = require('./logger');
const { isFeatureEnabled } = require('../middleware/subscription');

/**
 * Notification Helper
 * Provides utility functions to create and send notifications
 */
class NotificationHelper {
  /**
   * Create an in-app notification
   * @param {Object} data - Notification data
   * @returns {Promise<Notification>}
   */
  async createNotification(data) {
    try {
      const notification = await Notification.create({
        companyId: data.companyId,
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        priority: data.priority || 'medium',
        // [HIGHLIGHT FIX] Include metadata for frontend highlighting
        metadata: data.metadata || {},
        data: data.data || {},
        channels: data.channels || { email: false, sms: false, inApp: true },
      });

      logger.info('Notification created', {
        notificationId: notification._id,
        type: data.type,
        companyId: data.companyId,
        userId: data.userId,
      });

      return notification;
    } catch (error) {
      logger.error('Failed to create notification', { error: error.message, data });
      throw error;
    }
  }

  /**
   * Create notification with email
   * Checks if emailNotifications feature is enabled before sending
   * @param {Object} notificationData - Notification data
   * @param {Object} emailData - Email data { to, subject, html }
   * @returns {Promise<Notification>}
   */
  async createWithNotification(notificationData, emailData) {
    try {
      // Create in-app notification
      const notification = await this.createNotification({
        ...notificationData,
        channels: { email: true, sms: false, inApp: true },
      });

      // Check if emailNotifications feature is enabled for the company
      if (notificationData.companyId) {
        const featureCheck = await isFeatureEnabled(notificationData.companyId, 'emailNotifications');

        if (!featureCheck.enabled) {
          logger.info('Email notifications disabled for company', {
            companyId: notificationData.companyId,
            notificationId: notification._id,
            reason: featureCheck.reason
          });
          // Mark email as skipped (not sent due to plan limitation)
          await notification.markAsSent('email', false, featureCheck.reason || 'Email notifications not available in plan');
          return notification;
        }
      }

      // Send email if configured and feature is enabled
      if (emailService.isReady() && emailData) {
        const emailResult = await emailService.sendEmail(emailData);

        if (emailResult.success) {
          await notification.markAsSent('email', true);
          logger.info('Email notification sent', { notificationId: notification._id });
        } else {
          await notification.markAsSent('email', false, emailResult.error);
          logger.warn('Email notification failed', { notificationId: notification._id, error: emailResult.error });
        }
      }

      return notification;
    } catch (error) {
      logger.error('Failed to create notification with email', { error: error.message });
      throw error;
    }
  }

  /**
   * Helper method to send email if emailNotifications feature is enabled
   * @param {string} companyId - Company ID
   * @param {Function} emailFn - Email function to call
   * @param {Array} args - Arguments for the email function
   * @returns {Promise<{sent: boolean, reason?: string}>}
   */
  async sendEmailIfEnabled(companyId, emailFn, ...args) {
    try {
      // Check if emailNotifications feature is enabled
      const featureCheck = await isFeatureEnabled(companyId, 'emailNotifications');

      if (!featureCheck.enabled) {
        logger.info('Email skipped - feature not enabled', {
          companyId,
          reason: featureCheck.reason
        });
        return { sent: false, reason: featureCheck.reason || 'Email notifications not available in plan' };
      }

      // Send the email
      await emailFn(...args);
      return { sent: true };
    } catch (error) {
      logger.error('Failed to send email', { error: error.message, companyId });
      return { sent: false, reason: error.message };
    }
  }

  /**
   * Notify when a company is created
   * @param {Object} company - Company document
   * @param {Object} admin - Admin user document
   */
  async notifyCompanyCreated(company, admin) {
    const notificationData = {
      companyId: company._id,
      userId: admin ? admin._id : null,
      type: 'system',
      title: 'Company Registration Successful',
      message: `Company "${company.name}" has been successfully registered. Your subscription is valid until ${company.subscriptionEndDate ? new Date(company.subscriptionEndDate).toDateString() : 'N/A'}.`,
      priority: 'medium',
      // [HIGHLIGHT FIX] Add metadata for highlighting
      metadata: {
        companyName: company.name,
        expiryDate: company.subscriptionEndDate,
        planName: company.subscriptionId?.name,
      },
    };

    const emailData = admin ? {
      to: admin.email,
      subject: `Welcome to SIM Management - ${company.name}`,
      html: this._generateCompanyCreatedHtml(company, admin),
    } : {
      to: company.email,
      subject: `Welcome to SIM Management - ${company.name}`,
      html: this._generateCompanyCreatedHtml(company, null),
    };

    return this.createWithNotification(notificationData, emailData);
  }

  /**
   * Notify when an admin/user is created
   * @param {Object} user - New user document
   * @param {Object} company - Company document
   * @param {string} tempPassword - Temporary password (if applicable)
   */
  async notifyUserCreated(user, company, tempPassword = null) {
    const notificationData = {
      companyId: company._id,
      userId: user._id,
      type: 'system',
      title: 'Account Created',
      message: `Your account has been created for ${company.name}. You can now log in to access your dashboard.`,
      priority: 'medium',
      // [HIGHLIGHT FIX] Add metadata for highlighting
      metadata: {
        companyName: company.name,
        userName: user.name,
      },
    };

    // Send welcome email (if emailNotifications feature is enabled)
    await this.sendEmailIfEnabled(company._id, emailService.sendWelcomeEmail.bind(emailService), user, company, tempPassword);

    return this.createNotification(notificationData);
  }

  /**
   * Notify when a SIM is assigned to a user
   * @param {Object} sim - SIM document
   * @param {Object} user - User document (assigned to)
   * @param {Object} assignedBy - Admin who assigned
   * @param {Object} company - Company document
   */
  async notifySimAssigned(sim, user, assignedBy, company) {
    // Create notification for the assigned user
    const notificationData = {
      companyId: company._id,
      userId: user._id,
      type: 'info',
      title: 'SIM Card Assigned',
      message: `SIM card ${sim.mobileNumber} (${sim.operator}) has been assigned to you by ${assignedBy.name}.`,
      priority: 'medium',
      // [HIGHLIGHT FIX] Add metadata for highlighting
      metadata: {
        companyName: company.name,
        simNumber: sim.mobileNumber,
        userName: user.name,
      },
      data: { simId: sim._id },
    };

    // Send email to user (if emailNotifications feature is enabled)
    await this.sendEmailIfEnabled(company._id, emailService.sendSimAssignmentEmail.bind(emailService), user, sim, assignedBy);

    return this.createNotification(notificationData);
  }

  /**
   * Notify about recharge reminder
   * @param {Object} recharge - Recharge document
   * @param {Object} sim - SIM document
   * @param {Object} company - Company document
   * @param {number} daysLeft - Days until recharge
   */
  async notifyRechargeReminder(recharge, sim, company, daysLeft) {
    const notificationData = {
      companyId: company._id,
      type: 'recharge_due',
      title: `Recharge Reminder - ${sim.mobileNumber}`,
      message: `Your SIM ${sim.mobileNumber} (${sim.operator}) recharge is due in ${daysLeft} days. Next recharge date: ${new Date(recharge.nextRechargeDate).toDateString()}`,
      priority: daysLeft <= 1 ? 'critical' : daysLeft <= 3 ? 'high' : 'medium',
      // [HIGHLIGHT FIX] Add metadata for highlighting
      metadata: {
        companyName: company.name,
        simNumber: sim.mobileNumber,
        daysLeft: daysLeft,
        expiryDate: recharge.nextRechargeDate,
      },
      data: { simId: sim._id, rechargeId: recharge._id },
    };

    // Get company admin to send email
    const User = require('../models/auth/user.model');
    const admin = await User.findOne({ companyId: company._id, role: 'admin' });

    if (admin) {
      const emailData = {
        to: admin.email,
        subject: `Recharge Reminder - ${sim.mobileNumber} (${daysLeft} days left)`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="margin: 0;">⚡ Recharge Reminder</h1>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <h2>Hello ${admin.name},</h2>
              <p>This is a reminder that your SIM recharge is due soon.</p>
              <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 6px; margin: 15px 0;">
                <p style="margin: 0; font-size: 18px; font-weight: bold; color: #92400e;">${daysLeft} days remaining</p>
              </div>
              <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; margin: 15px 0;">
                <p style="margin: 0;"><strong>Contact Number:</strong> ${sim.mobileNumber}</p>
                <p style="margin: 10px 0 0 0;"><strong>Operator:</strong> ${sim.operator}</p>
                <p style="margin: 10px 0 0 0;"><strong>Next Recharge Date:</strong> ${new Date(recharge.nextRechargeDate).toDateString()}</p>
              </div>
              <p>Please recharge your SIM to avoid service interruption.</p>
              <p>Best regards,<br>SIM Management Team</p>
            </div>
          </div>
        `,
      };

      // Create notification for admin with email
      await this.createWithNotification(
        { ...notificationData, userId: admin._id },
        emailData
      );
    } else {
      // Fallback: just create company-wide notification
      await this.createNotification(notificationData);
    }
  }

  /**
   * Notify about inactive SIM
   * @param {Object} sim - SIM document
   * @param {Object} company - Company document
   * @param {number} inactiveDays - Days inactive
   */
  async notifyInactiveSim(sim, company, inactiveDays) {
    const notificationData = {
      companyId: company._id,
      type: 'inactive_sim',
      title: `Inactive SIM Alert - ${sim.mobileNumber}`,
      message: `SIM ${sim.mobileNumber} (${sim.operator}) has been inactive for ${inactiveDays} days. Please check the SIM status.`,
      priority: 'high',
      // [HIGHLIGHT FIX] Add metadata for highlighting
      metadata: {
        companyName: company.name,
        simNumber: sim.mobileNumber,
      },
      data: { simId: sim._id },
    };

    // Get company admin to send email
    const User = require('../models/auth/user.model');
    const admin = await User.findOne({ companyId: company._id, role: 'admin' });

    if (admin) {
      const emailData = {
        to: admin.email,
        subject: `Inactive SIM Alert - ${sim.mobileNumber}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #dc2626, #b91c1c); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="margin: 0;">Inactive SIM Alert</h1>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <h2>Hello ${admin.name},</h2>
              <p>A SIM card has been inactive for an extended period.</p>
              <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; border-radius: 6px; margin: 15px 0;">
                <p style="margin: 0; font-size: 18px; font-weight: bold; color: #991b1b;">Inactive for ${inactiveDays} days</p>
              </div>
              <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; margin: 15px 0;">
                <p style="margin: 0;"><strong>Contact Number:</strong> ${sim.mobileNumber}</p>
                <p style="margin: 10px 0 0 0;"><strong>Operator:</strong> ${sim.operator}</p>
                <p style="margin: 10px 0 0 0;"><strong>Last Active:</strong> ${sim.lastActiveDate ? new Date(sim.lastActiveDate).toDateString() : 'Unknown'}</p>
              </div>
              <p>Please check the SIM status and take necessary action.</p>
              <p>Best regards,<br>SIM Management Team</p>
            </div>
          </div>
        `,
      };

      // Create notification for admin with email
      await this.createWithNotification(
        { ...notificationData, userId: admin._id },
        emailData
      );
    } else {
      // Fallback: just create company-wide notification
      await this.createNotification(notificationData);
    }
  }

  /**
   * Notify about subscription expiry
   * @param {Object} company - Company document
   * @param {number} daysLeft - Days until expiry
   */
  async notifySubscriptionExpiry(company, daysLeft) {
    const notificationData = {
      companyId: company._id,
      type: 'subscription_expiry',
      title: 'Subscription Expiring Soon',
      message: `Your subscription will expire in ${daysLeft} days. Please renew to continue using all features.`,
      priority: daysLeft <= 3 ? 'critical' : 'high',
      // [HIGHLIGHT FIX] Add metadata for highlighting
      metadata: {
        companyName: company.name,
        planName: company.subscriptionId?.name,
        daysLeft: daysLeft,
        expiryDate: company.subscriptionEndDate,
      },
      data: { companyId: company._id },
    };

    const emailData = {
      to: company.email,
      subject: `Subscription Expiring Soon - ${daysLeft} days remaining`,
      html: this._generateSubscriptionExpiryHtml(company, daysLeft),
    };

    return this.createWithNotification(notificationData, emailData);
  }

  /**
   * Notify when SIM is unassigned from a user
   * @param {Object} sim - SIM document
   * @param {Object} user - User document (unassigned from)
   * @param {Object} unassignedBy - Admin who unassigned
   * @param {Object} company - Company document
   */
  async notifySimUnassigned(sim, user, unassignedBy, company) {
    // Create notification for the unassigned user
    const notificationData = {
      companyId: company._id,
      userId: user._id,
      type: 'info',
      title: 'SIM Card Unassigned',
      message: `SIM card ${sim.mobileNumber} (${sim.operator}) has been unassigned from you by ${unassignedBy.name}.`,
      priority: 'medium',
      metadata: {
        companyName: company.name,
        simNumber: sim.mobileNumber,
        userName: user.name,
      },
      data: { simId: sim._id },
    };

    // Send email to user (if emailNotifications feature is enabled)
    await this.sendEmailIfEnabled(company._id, emailService.sendSimUnassignmentEmail.bind(emailService), user, sim, unassignedBy);

    return this.createNotification(notificationData);
  }

  /**
   * Notify when subscription is renewed
   * @param {Object} company - Company document
   * @param {Date} newEndDate - New subscription end date
   * @param {string} planName - Subscription plan name
   */
  async notifySubscriptionRenewed(company, newEndDate, planName) {
    const notificationData = {
      companyId: company._id,
      type: 'system',
      title: 'Subscription Renewed',
      message: `Your subscription has been renewed successfully. Valid until ${new Date(newEndDate).toDateString()}.`,
      priority: 'medium',
      metadata: {
        companyName: company.name,
        planName: planName,
        expiryDate: newEndDate,
      },
      data: { companyId: company._id },
    };

    // Send email (if emailNotifications feature is enabled)
    await this.sendEmailIfEnabled(company._id, emailService.sendSubscriptionRenewalEmail.bind(emailService), company, newEndDate, planName);

    return this.createNotification(notificationData);
  }

  /**
   * Notify when trial is extended
   * @param {Object} company - Company document
   * @param {Date} newEndDate - New trial end date
   * @param {number} additionalDays - Days added to trial
   */
  async notifyTrialExtended(company, newEndDate, additionalDays) {
    const notificationData = {
      companyId: company._id,
      type: 'system',
      title: 'Trial Period Extended',
      message: `Your trial period has been extended by ${additionalDays} days. New expiry: ${new Date(newEndDate).toDateString()}.`,
      priority: 'medium',
      metadata: {
        companyName: company.name,
        additionalDays: additionalDays,
        expiryDate: newEndDate,
      },
      data: { companyId: company._id },
    };

    // Send email (if emailNotifications feature is enabled)
    await this.sendEmailIfEnabled(company._id, emailService.sendTrialExtensionEmail.bind(emailService), company, newEndDate, additionalDays);

    return this.createNotification(notificationData);
  }

  /**
   * Notify when trial is converted to paid plan
   * @param {Object} company - Company document
   * @param {Date} newEndDate - New subscription end date
   * @param {string} planName - New plan name
   */
  async notifyTrialConverted(company, newEndDate, planName) {
    const notificationData = {
      companyId: company._id,
      type: 'system',
      title: 'Subscription Activated',
      message: `Congratulations! Your subscription has been upgraded to ${planName}. Valid until ${new Date(newEndDate).toDateString()}.`,
      priority: 'high',
      metadata: {
        companyName: company.name,
        planName: planName,
        expiryDate: newEndDate,
      },
      data: { companyId: company._id },
    };

    // Send email (if emailNotifications feature is enabled)
    try {
      await this.sendEmailIfEnabled(company._id, emailService.sendTrialConvertedEmail.bind(emailService), company, newEndDate, planName);
    } catch (error) {
      console.error('Failed to send trial converted email:', error.message);
    }

    return this.createNotification(notificationData);
  }

  /**
   * Notify when password is reset by admin
   * @param {Object} user - User whose password was reset
   * @param {string} newPassword - The new password
   * @param {Object} resetBy - Admin who reset the password
   * @param {Object} company - Company document
   */
  async notifyPasswordResetByAdmin(user, newPassword, resetBy, company) {
    const notificationData = {
      companyId: company._id,
      userId: user._id,
      type: 'security',
      title: 'Password Reset',
      message: `Your password has been reset by ${resetBy.name}. Please log in with your new password.`,
      priority: 'high',
      metadata: {
        userName: user.name,
        resetBy: resetBy.name,
      },
    };

    // Send email with new password (if emailNotifications feature is enabled)
    await this.sendEmailIfEnabled(company._id, emailService.sendAdminPasswordResetEmail.bind(emailService), user, newPassword, resetBy);

    return this.createNotification(notificationData);
  }

  /**
   * Notify when user account is activated
   * @param {Object} user - User document
   * @param {Object} company - Company document
   * @param {Object} activatedBy - Admin who activated
   */
  async notifyUserActivated(user, company, activatedBy) {
    const notificationData = {
      companyId: company._id,
      userId: user._id,
      type: 'system',
      title: 'Account Reactivated',
      message: `Your account has been reactivated by ${activatedBy.name}. You can now log in.`,
      priority: 'medium',
      metadata: {
        userName: user.name,
        activatedBy: activatedBy.name,
      },
    };

    // Send email (if emailNotifications feature is enabled)
    await this.sendEmailIfEnabled(company._id, emailService.sendUserActivationEmail.bind(emailService), user, company, activatedBy);

    return this.createNotification(notificationData);
  }

  /**
   * Notify when user account is deactivated
   * @param {Object} user - User document
   * @param {Object} company - Company document
   * @param {Object} deactivatedBy - Admin who deactivated
   */
  async notifyUserDeactivated(user, company, deactivatedBy) {
    const notificationData = {
      companyId: company._id,
      userId: user._id,
      type: 'system',
      title: 'Account Deactivated',
      message: `Your account has been deactivated by ${deactivatedBy.name}. Contact your administrator for assistance.`,
      priority: 'high',
      metadata: {
        userName: user.name,
        deactivatedBy: deactivatedBy.name,
      },
    };

    // Send email (if emailNotifications feature is enabled)
    await this.sendEmailIfEnabled(company._id, emailService.sendUserDeactivationEmail.bind(emailService), user, company, deactivatedBy);

    return this.createNotification(notificationData);
  }

  /**
   * Send WiFi alert email
   * @param {Object} user - User to notify
   * @param {Object} wifiNetwork - WiFi network document
   * @param {Object} alert - Alert document
   * @param {string} alertType - Type of alert (low_speed, wifi_off, wifi_disconnected, device_offline)
   * @param {Object} device - Device document (optional, for device-specific alerts)
   */
  async sendWifiAlertEmail(user, wifiNetwork, alert, alertType = 'low_speed', device = null) {
    const emailData = {
      to: user.email,
      subject: this._getWifiAlertSubject(wifiNetwork, alertType, device),
      html: this._generateWifiAlertHtml(user, wifiNetwork, alert, alertType, device),
    };

    // Create in-app notification as well
    const notificationData = {
      companyId: wifiNetwork.companyId,
      userId: user._id,
      type: 'wifi_alert',
      title: this._getWifiAlertTitle(wifiNetwork, alertType, device),
      message: alert.message,
      priority: 'high',
      metadata: {
        wifiName: wifiNetwork.wifiName,
        avgSpeed: alert.avgSpeed,
        threshold: wifiNetwork.alertThreshold,
        alertType: alertType,
        deviceName: device?.deviceName,
        deviceId: device?.deviceId,
      },
      data: { wifiId: wifiNetwork._id, alertId: alert._id, deviceId: device?._id },
    };

    return this.createWithNotification(notificationData, emailData);
  }

  /**
   * Get alert subject based on alert type
   */
  _getWifiAlertSubject(wifiNetwork, alertType, device) {
    const subjects = {
      low_speed: `WiFi Speed Alert - ${wifiNetwork.wifiName}`,
      wifi_off: `WiFi Offline Alert - ${wifiNetwork.wifiName}`,
      wifi_disconnected: `WiFi Disconnected Alert - ${device?.deviceName || 'Device'}`,
      device_offline: `Device Offline Alert - ${device?.deviceName || 'Device'}`,
    };
    return subjects[alertType] || `WiFi Alert - ${wifiNetwork.wifiName}`;
  }

  /**
   * Get alert title for in-app notification
   */
  _getWifiAlertTitle(wifiNetwork, alertType, device) {
    const titles = {
      low_speed: `WiFi Speed Alert - ${wifiNetwork.wifiName}`,
      wifi_off: `WiFi Offline - ${wifiNetwork.wifiName}`,
      wifi_disconnected: `WiFi Disconnected - ${device?.deviceName || 'Device'}`,
      device_offline: `Device Offline - ${device?.deviceName || 'Device'}`,
    };
    return titles[alertType] || `WiFi Alert - ${wifiNetwork.wifiName}`;
  }

  /**
   * Generate WiFi alert HTML email
   * @param {Object} user - User document
   * @param {Object} wifiNetwork - WiFi network document
   * @param {Object} alert - Alert document
   * @param {string} alertType - Type of alert
   * @param {Object} device - Device document (optional)
   * @returns {string} HTML email content
   */
  _generateWifiAlertHtml(user, wifiNetwork, alert, alertType = 'low_speed', device = null) {
    const alertTime = new Date(alert.createdAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    // Choose email template based on alert type
    switch (alertType) {
      case 'wifi_off':
        return this._generateWifiOffHtml(user, wifiNetwork, alert, alertTime);
      case 'wifi_disconnected':
        return this._generateWifiDisconnectedHtml(user, wifiNetwork, alert, device, alertTime);
      case 'device_offline':
        return this._generateDeviceOfflineHtml(user, wifiNetwork, alert, device, alertTime);
      case 'low_speed':
      default:
        return this._generateLowSpeedHtml(user, wifiNetwork, alert, alertTime);
    }
  }

  /**
   * Generate low speed alert HTML
   */
  _generateLowSpeedHtml(user, wifiNetwork, alert, alertTime) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f3f4f6;">
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 40px 30px; text-align: center;">
           
            <h1 style="margin: 0; font-size: 28px; font-weight: 600;">WiFi Speed Alert</h1>
          </div>

          <!-- WiFi Name Banner -->
          <div style="background: #1f2937; color: white; padding: 20px 30px; text-align: center;">
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 5px;">Network Name</div>
            <div style="font-size: 24px; font-weight: 600;">${wifiNetwork.wifiName}</div>
            ${wifiNetwork.ssid ? `<div style="font-size: 14px; color: #d1d5db; margin-top: 5px;">SSID: ${wifiNetwork.ssid}</div>` : ''}
          </div>

          <!-- Content -->
          <div style="padding: 40px 30px;">
            <h2 style="margin: 0 0 10px 0; font-size: 20px; color: #111827;">Hello ${user.name},</h2>
            <p style="margin: 0 0 30px 0; color: #6b7280; font-size: 16px;">
              A WiFi speed alert has been triggered. Your network speed has dropped below the configured threshold.
            </p>

            <!-- Speed Comparison -->
            <div style="background: #fef2f2; border: 2px solid #fecaca; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
              <div style="display: table; width: 100%;">
                <div style="display: table-row;">
                  <div style="display: table-cell; width: 50%; text-align: center; padding: 15px;">
                    <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Current Speed</div>
                    <div style="font-size: 36px; font-weight: 700; color: #dc2626; margin: 10px 0;">${alert.avgSpeed.toFixed(2)}</div>
                    <div style="font-size: 14px; color: #dc2626;">Mbps</div>
                  </div>
                  <div style="display: table-cell; width: 50%; text-align: center; padding: 15px; border-left: 1px solid #fecaca;">
                    <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Threshold</div>
                    <div style="font-size: 36px; font-weight: 700; color: #059669; margin: 10px 0;">${wifiNetwork.alertThreshold}</div>
                    <div style="font-size: 14px; color: #059669;">Mbps</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Network Details -->
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
              <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #374151;">Network Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">WiFi Name:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${wifiNetwork.wifiName}</td>
                </tr>
                ${wifiNetwork.ssid ? `<tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">SSID:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${wifiNetwork.ssid}</td>
                </tr>` : ''}
                ${wifiNetwork.bssid ? `<tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">BSSID:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right; font-family: monospace;">${wifiNetwork.bssid}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Expected Speed:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${wifiNetwork.expectedSpeed} Mbps</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Alert Time:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${alertTime}</td>
                </tr>
              </table>
            </div>

            <!-- Action Required -->
            <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px;">
              <div style="font-size: 14px; font-weight: 600; color: #92400e; margin-bottom: 8px;">Action Required</div>
              <p style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.6;">
                Please check your network connection and take necessary steps to resolve the issue.
                If this issue persists, consider contacting your internet service provider.
              </p>
            </div>
          </div>

          <!-- Footer -->
          <div style="background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">
              This is an automated alert from <strong>SIM Management</strong>
            </p>
            <p style="margin: 0; color: #9ca3af; font-size: 12px;">
              © ${new Date().getFullYear()} SIM Management. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate WiFi OFF alert HTML
   */
  _generateWifiOffHtml(user, wifiNetwork, alert, alertTime) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f3f4f6;">
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); padding: 40px 30px; text-align: center;">
  
            <h1 style="margin: 0; font-size: 28px; font-weight: 600; color: white;">WiFi Network Offline</h1>
          </div>

          <!-- WiFi Name Banner -->
          <div style="background: #1f2937; color: white; padding: 20px 30px; text-align: center;">
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 5px;">Network Name</div>
            <div style="font-size: 24px; font-weight: 600;">${wifiNetwork.wifiName}</div>
            ${wifiNetwork.ssid ? `<div style="font-size: 14px; color: #d1d5db; margin-top: 5px;">SSID: ${wifiNetwork.ssid}</div>` : ''}
          </div>

          <!-- Content -->
          <div style="padding: 40px 30px;">
            <h2 style="margin: 0 0 10px 0; font-size: 20px; color: #111827;">Hello ${user.name},</h2>
            <p style="margin: 0 0 30px 0; color: #6b7280; font-size: 16px;">
              Your WiFi network appears to be offline. No speed data has been received from any connected devices.
            </p>

            <!-- Alert Box -->
            <div style="background: #f3e8ff; border: 2px solid #c4b5fd; border-radius: 12px; padding: 25px; margin-bottom: 25px; text-align: center;">
              <div style="font-size: 14px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Status</div>
              <div style="font-size: 32px; font-weight: 700; color: #7c3aed; margin: 10px 0;">OFFLINE</div>
              <div style="font-size: 14px; color: #7c3aed;">No data received for 10+ minutes</div>
            </div>

            <!-- Network Details -->
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
              <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #374151;">Network Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">WiFi Name:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${wifiNetwork.wifiName}</td>
                </tr>
                ${wifiNetwork.ssid ? `<tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">SSID:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${wifiNetwork.ssid}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Alert Time:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${alertTime}</td>
                </tr>
              </table>
            </div>

            <!-- Possible Causes -->
            <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px;">
              <div style="font-size: 14px; font-weight: 600; color: #92400e; margin-bottom: 8px;">Possible Causes</div>
              <ul style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.8; padding-left: 20px;">
                <li>WiFi router/modem is turned off or disconnected</li>
                <li>Power outage affecting the network equipment</li>
                <li>Router is experiencing issues and needs restart</li>
                <li>ISP (Internet Service Provider) outage</li>
              </ul>
            </div>
          </div>

          <!-- Footer -->
          <div style="background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">
              This is an automated alert from <strong>SIM Management</strong>
            </p>
            <p style="margin: 0; color: #9ca3af; font-size: 12px;">
              © ${new Date().getFullYear()} SIM Management. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate WiFi Disconnected alert HTML
   */
  _generateWifiDisconnectedHtml(user, wifiNetwork, alert, device, alertTime) {
    const deviceName = device?.deviceName || device?.deviceId || 'Unknown Device';
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f3f4f6;">
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%); padding: 40px 30px; text-align: center;">
            
            <h1 style="margin: 0; font-size: 28px; font-weight: 600; color: white;">Device Disconnected from WiFi</h1>
          </div>

          <!-- Device Info Banner -->
          <div style="background: #1f2937; color: white; padding: 20px 30px; text-align: center;">
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 5px;">Device</div>
            <div style="font-size: 24px; font-weight: 600;">${deviceName}</div>
            <div style="font-size: 14px; color: #d1d5db; margin-top: 5px;">was connected to ${wifiNetwork.wifiName}</div>
          </div>

          <!-- Content -->
          <div style="padding: 40px 30px;">
            <h2 style="margin: 0 0 10px 0; font-size: 20px; color: #111827;">Hello ${user.name},</h2>
            <p style="margin: 0 0 30px 0; color: #6b7280; font-size: 16px;">
              A device has disconnected from the WiFi network. This could indicate the user has left the WiFi coverage area or manually disconnected.
            </p>

            <!-- Alert Box -->
            <div style="background: #fff7ed; border: 2px solid #fed7aa; border-radius: 12px; padding: 25px; margin-bottom: 25px; text-align: center;">
              <div style="font-size: 14px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Connection Status</div>
              <div style="font-size: 32px; font-weight: 700; color: #ea580c; margin: 10px 0;">DISCONNECTED</div>
              <div style="font-size: 14px; color: #ea580c;">No data for 10+ minutes</div>
            </div>

            <!-- Details -->
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
              <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #374151;">Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Device Name:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${deviceName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">WiFi Network:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${wifiNetwork.wifiName}</td>
                </tr>
                ${wifiNetwork.ssid ? `<tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">SSID:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${wifiNetwork.ssid}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Alert Time:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${alertTime}</td>
                </tr>
              </table>
            </div>

            <!-- Possible Causes -->
            <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px;">
              <div style="font-size: 14px; font-weight: 600; color: #92400e; margin-bottom: 8px;">Possible Causes</div>
              <ul style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.8; padding-left: 20px;">
                <li>User moved out of WiFi coverage area</li>
                <li>WiFi was manually disabled on the device</li>
                <li>Device WiFi antenna is turned off</li>
                <li>Device is in airplane mode</li>
              </ul>
            </div>
          </div>

          <!-- Footer -->
          <div style="background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">
              This is an automated alert from <strong>SIM Management</strong>
            </p>
            <p style="margin: 0; color: #9ca3af; font-size: 12px;">
              © ${new Date().getFullYear()} SIM Management. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate Device Offline alert HTML
   */
  _generateDeviceOfflineHtml(user, wifiNetwork, alert, device, alertTime) {
    const deviceName = device?.deviceName || device?.deviceId || 'Unknown Device';
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f3f4f6;">
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 40px 30px; text-align: center;">
            
            <h1 style="margin: 0; font-size: 28px; font-weight: 600; color: white;">Device Offline Alert</h1>
          </div>

          <!-- Device Info Banner -->
          <div style="background: #1f2937; color: white; padding: 20px 30px; text-align: center;">
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 5px;">Device</div>
            <div style="font-size: 24px; font-weight: 600;">${deviceName}</div>
            <div style="font-size: 14px; color: #d1d5db; margin-top: 5px;">is currently offline</div>
          </div>

          <!-- Content -->
          <div style="padding: 40px 30px;">
            <h2 style="margin: 0 0 10px 0; font-size: 20px; color: #111827;">Hello ${user.name},</h2>
            <p style="margin: 0 0 30px 0; color: #6b7280; font-size: 16px;">
              A monitoring device has gone offline. This could indicate the mobile device is switched off, has no battery, or has lost network connectivity.
            </p>

            <!-- Alert Box -->
            <div style="background: #fef2f2; border: 2px solid #fecaca; border-radius: 12px; padding: 25px; margin-bottom: 25px; text-align: center;">
              <div style="font-size: 14px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Device Status</div>
              <div style="font-size: 32px; font-weight: 700; color: #dc2626; margin: 10px 0;">OFFLINE</div>
              <div style="font-size: 14px; color: #dc2626;">No communication for 15+ minutes</div>
            </div>

            <!-- Details -->
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
              <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #374151;">Device Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Device Name:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${deviceName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Assigned WiFi:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${wifiNetwork.wifiName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Last Seen:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${device?.lastMetricAt ? new Date(device.lastMetricAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Unknown'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Alert Time:</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${alertTime}</td>
                </tr>
              </table>
            </div>

            <!-- Possible Causes -->
            <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px;">
              <div style="font-size: 14px; font-weight: 600; color: #92400e; margin-bottom: 8px;">Possible Causes</div>
              <ul style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.8; padding-left: 20px;">
                <li>Mobile device battery has drained</li>
                <li>Device is powered off intentionally</li>
                <li>No cellular/mobile network coverage</li>
                <li>App is not running or was force-stopped</li>
                <li>Device is in a location with poor connectivity</li>
              </ul>
            </div>
          </div>

          <!-- Footer -->
          <div style="background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">
              This is an automated alert from <strong>SIM Management</strong>
            </p>
            <p style="margin: 0; color: #9ca3af; font-size: 12px;">
              © ${new Date().getFullYear()} SIM Management. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Helper methods for generating HTML
  _generateCompanyCreatedHtml(company, admin) {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #16a34a, #15803d); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="margin: 0;">Welcome to SIM Management!</h1>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
          <h2>Congratulations!</h2>
          <p>Your company <strong>${company.name}</strong> has been successfully registered.</p>
          <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; margin: 15px 0;">
            <p style="margin: 0;"><strong>Company Email:</strong> ${company.email}</p>
            <p style="margin: 10px 0 0 0;"><strong>Subscription Ends:</strong> ${company.subscriptionEndDate ? new Date(company.subscriptionEndDate).toDateString() : 'N/A'}</p>
          </div>
          ${admin ? `<p>You can now log in with your email: <strong>${admin.email}</strong></p>` : ''}
          <p>Best regards,<br>SIM Management Team</p>
        </div>
      </div>
    `;
  }

  _generateSubscriptionExpiryHtml(company, daysLeft) {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #dc2626, #b91c1c); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="margin: 0;">Subscription Expiry Notice</h1>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
          <h2>Dear ${company.name},</h2>
          <p>Your subscription will expire soon.</p>
          <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
            <p style="font-size: 24px; font-weight: bold; color: #dc2626; margin: 0;">${daysLeft} days remaining</p>
            <p style="margin: 10px 0 0 0;">Expiry Date: ${company.subscriptionEndDate ? new Date(company.subscriptionEndDate).toDateString() : 'N/A'}</p>
          </div>
          <p>Please renew your subscription to continue using all features.</p>
          <p>Best regards,<br>SIM Management Team</p>
        </div>
      </div>
    `;
  }
}

module.exports = new NotificationHelper();