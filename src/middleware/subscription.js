const Company = require('../models/company/company.model');
const { SubscriptionLimitError } = require('../utils/errors');

const checkSubscriptionLimit = (feature) => {
  return async (req, res, next) => {
    try {
      if (req.user.role === 'super_admin') {
        return next();
      }

      const company = await Company.findById(req.user.companyId).populate('subscriptionId');

      if (!company || !company.isActive) {
        return res.status(403).json({
          success: false,
          message: 'Company account is inactive or not found',
        });
      }

      // Check subscription expiry
      if (company.subscriptionEndDate && new Date() > company.subscriptionEndDate) {
        return res.status(403).json({
          success: false,
          message: 'Subscription has expired. Please renew to continue.',
        });
      }

      const subscription = company.subscriptionId;
      if (!subscription) {
        return res.status(403).json({
          success: false,
          message: 'No subscription found',
        });
      }

      // Check feature limits
      const limits = subscription.limits;

      switch (feature) {
        case 'sims':
          if (limits.maxSims !== -1) {
            const Sim = require('../models/sim/sim.model');
            const simCount = await Sim.countDocuments({ companyId: req.user.companyId });
            if (simCount >= limits.maxSims) {
              throw new SubscriptionLimitError('SIMs', limits.maxSims);
            }
          }
          break;

        case 'users':
          if (limits.maxUsers !== -1) {
            const User = require('../models/auth/user.model');
            // Exclude admin from user count - admins don't count toward limit
            const userCount = await User.countDocuments({ companyId: req.user.companyId, role: { $ne: 'admin' } });
            if (userCount >= limits.maxUsers) {
              throw new SubscriptionLimitError('Users', limits.maxUsers);
            }
          }
          break;

        case 'callLogSync':
          if (!limits.callLogSync) {
            return res.status(403).json({
              success: false,
              message: 'Call log sync feature not available in your plan',
            });
          }
          break;

        case 'whatsappStatus':
          if (!limits.whatsappStatus) {
            return res.status(403).json({
              success: false,
              message: 'WhatsApp status feature not available in your plan',
            });
          }
          break;

        case 'reports':
          if (!limits.reports) {
            return res.status(403).json({
              success: false,
              message: 'Reports feature not available in your plan',
            });
          }
          break;
      }

      req.subscription = subscription;
      req.company = company;
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Check if a subscription feature is enabled
 * Used for features like excelExport, advancedReports, emailNotifications, etc.
 * @param {string} feature - Feature name (e.g., 'excelExport', 'advancedReports', 'emailNotifications')
 */
const checkSubscriptionFeature = (feature) => {
  return async (req, res, next) => {
    try {
      // Super admin bypasses all feature checks
      if (req.user.role === 'super_admin') {
        return next();
      }

      const company = await Company.findById(req.user.companyId).populate('subscriptionId');

      if (!company || !company.isActive) {
        return res.status(403).json({
          success: false,
          message: 'Company account is inactive or not found',
        });
      }

      // Check subscription expiry
      if (company.subscriptionEndDate && new Date() > company.subscriptionEndDate) {
        return res.status(403).json({
          success: false,
          message: 'Subscription has expired. Please renew to continue.',
        });
      }

      const subscription = company.subscriptionId;
      if (!subscription) {
        return res.status(403).json({
          success: false,
          message: 'No subscription found',
        });
      }

      // Check if feature is enabled in subscription features
      const features = subscription.features || {};

      // Feature name mapping for better error messages
      const featureNames = {
        excelExport: 'Excel Export',
        advancedReports: 'Advanced Reports',
        emailNotifications: 'Email Notifications',
        smsNotifications: 'SMS Notifications',
        apiAccess: 'API Access',
        prioritySupport: 'Priority Support',
        callLogSync: 'Call Log Sync',
        whatsappStatus: 'WhatsApp Status',
        telegramStatus: 'Telegram Status',
        wifiMonitor: 'WiFi Monitor',
        callAutomation: 'Call Automation',
        smsLogs: 'SMS Logs',
      };

      if (!features[feature]) {
        return res.status(403).json({
          success: false,
          message: `${featureNames[feature] || feature} feature is not available in your current plan. Please upgrade to access this feature.`,
          code: 'FEATURE_NOT_AVAILABLE',
          feature: feature,
        });
      }

      req.subscription = subscription;
      req.company = company;
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Helper function to check if a feature is enabled for a company
 * Used by services that don't have access to req object (e.g., notification helper)
 * @param {string} companyId - Company ID
 * @param {string} feature - Feature name
 * @returns {Promise<{enabled: boolean, subscription: Object|null}>}
 */
const isFeatureEnabled = async (companyId, feature) => {
  try {
    const company = await Company.findById(companyId).populate('subscriptionId');

    if (!company || !company.isActive) {
      return { enabled: false, subscription: null, reason: 'Company inactive or not found' };
    }

    // Check subscription expiry
    if (company.subscriptionEndDate && new Date() > company.subscriptionEndDate) {
      return { enabled: false, subscription: null, reason: 'Subscription expired' };
    }

    const subscription = company.subscriptionId;
    if (!subscription) {
      return { enabled: false, subscription: null, reason: 'No subscription found' };
    }

    const features = subscription.features || {};
    const isEnabled = !!features[feature];

    return {
      enabled: isEnabled,
      subscription,
      reason: isEnabled ? null : `Feature '${feature}' not available in plan`
    };
  } catch (error) {
    console.error('Error checking feature:', error);
    return { enabled: false, subscription: null, reason: error.message };
  }
};

module.exports = {
  checkSubscriptionLimit,
  checkSubscriptionFeature,
  isFeatureEnabled,
};