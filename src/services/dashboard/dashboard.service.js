const Sim = require('../../models/sim/sim.model');
const Recharge = require('../../models/recharge/recharge.model');
const CallLog = require('../../models/callLog/callLog.model');
const Company = require('../../models/company/company.model');
const User = require('../../models/auth/user.model');
const Subscription = require('../../models/subscription/subscription.model');
const Notification = require('../../models/notification/notification.model');
const mongoose = require('mongoose');

class DashboardService {
  async getOverview(companyId) {
    // Get SIM stats
    // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
    const simStats = await Sim.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    // [HARD DELETE] Removed isActive: true filter
    const totalSims = await Sim.countDocuments({ companyId });
    const activeSims = simStats.find((s) => s._id === 'active')?.count || 0;
    const inactiveSims = simStats.find((s) => s._id === 'inactive')?.count || 0;

    // Get recharge stats
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const rechargeStats = await Recharge.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          status: 'completed',
          rechargeDate: { $gte: currentMonth },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    // Get upcoming recharges
    const upcomingRecharges = await Recharge.find({
      companyId,
      nextRechargeDate: {
        $gte: new Date(),
        $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      status: 'completed',
    })
      .populate('simId', 'mobileNumber operator')
      .limit(5)
      .sort({ nextRechargeDate: 1 });

    // Get overdue recharges
    const overdueRecharges = await Recharge.find({
      companyId,
      nextRechargeDate: { $lt: new Date() },
      status: 'completed',
    })
      .populate('simId', 'mobileNumber operator')
      .limit(5)
      .sort({ nextRechargeDate: 1 });

    // Get unread notifications
    const unreadNotifications = await Notification.countDocuments({
      companyId,
      isRead: false,
    });

    return {
      sims: {
        total: totalSims,
        active: activeSims,
        inactive: inactiveSims,
      },
      recharges: {
        monthlyTotal: rechargeStats[0]?.totalAmount || 0,
        monthlyCount: rechargeStats[0]?.count || 0,
        upcoming: upcomingRecharges,
        overdue: overdueRecharges.length,
      },
      notifications: {
        unread: unreadNotifications,
      },
    };
  }

  async getSimStats(companyId) {
    // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
    const statusStats = await Sim.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const operatorStats = await Sim.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
      { $group: { _id: '$operator', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // [HARD DELETE] Removed isActive: true filter
    const recentSims = await Sim.find({ companyId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('mobileNumber operator status createdAt');

    return {
      byStatus: statusStats,
      byOperator: operatorStats,
      recent: recentSims,
    };
  }

  async getRechargeStats(companyId, period = 'month') {
    let startDate = new Date();
    let groupBy = { $dateToString: { format: '%Y-%m-%d', date: '$rechargeDate' } };

    if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
      groupBy = { $dateToString: { format: '%Y-%m-%d', date: '$rechargeDate' } };
    } else if (period === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
      groupBy = { $dateToString: { format: '%Y-%m-%d', date: '$rechargeDate' } };
    } else if (period === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
      groupBy = { $dateToString: { format: '%Y-%m', date: '$rechargeDate' } };
    }

    const dailyStats = await Recharge.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          status: 'completed',
          rechargeDate: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: groupBy,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const operatorStats = await Recharge.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          status: 'completed',
          rechargeDate: { $gte: startDate },
        },
      },
      {
        $lookup: {
          from: 'sims',
          localField: 'simId',
          foreignField: '_id',
          as: 'sim',
        },
      },
      { $unwind: '$sim' },
      {
        $group: {
          _id: '$sim.operator',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    return {
      timeline: dailyStats,
      byOperator: operatorStats,
    };
  }

  async getCallStats(companyId, period = 'month') {
    let startDate = new Date();

    if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else if (period === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    const callStats = await CallLog.getStats(companyId, startDate, new Date());
    const dailyStats = await CallLog.getDailyCounts(companyId, 30);
    const topContacts = await CallLog.getTopContacts(companyId, 5);

    return {
      ...callStats,
      daily: dailyStats,
      topContacts,
    };
  }

  async getMonthlyReport(companyId, month, year) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
    const simStats = await Sim.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
      {
        $group: {
          _id: '$operator',
          count: { $sum: 1 },
        },
      },
    ]);

    const rechargeStats = await Recharge.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          status: 'completed',
          rechargeDate: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
          avgAmount: { $avg: '$amount' },
        },
      },
    ]);

    const callStats = await CallLog.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          timestamp: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: '$callType',
          count: { $sum: 1 },
          totalDuration: { $sum: '$duration' },
        },
      },
    ]);

    return {
      month,
      year,
      sims: simStats,
      recharges: rechargeStats[0] || { totalAmount: 0, count: 0, avgAmount: 0 },
      calls: callStats,
    };
  }

  async getSuperAdminOverview() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // Platform Statistics
    const totalCompanies = await Company.countDocuments();
    // [HARD DELETE] Company isActive represents subscription status, not soft delete - KEEP
    const activeCompanies = await Company.countDocuments({ isActive: true });
    const inactiveCompanies = await Company.countDocuments({ isActive: false });
    const expiredSubscriptions = await Company.countDocuments({
      subscriptionEndDate: { $lt: now },
      isActive: true,
    });

    // User Statistics - [HARD DELETE] Removed isActive filter - users are now hard deleted
    const totalAdmins = await User.countDocuments({ role: 'admin' });
    const totalUsers = await User.countDocuments({ role: 'user' });
    const superAdminCount = await User.countDocuments({ role: 'super_admin' });

    // SIM Statistics - [HARD DELETE] Removed isActive filter - SIMs are hard deleted
    const totalSims = await Sim.countDocuments();
    const activeSims = await Sim.countDocuments({ status: 'active' });
    const inactiveSims = await Sim.countDocuments({ status: 'inactive' });

    // Revenue Statistics
    const monthlyRevenue = await Recharge.aggregate([
      {
        $match: {
          status: 'completed',
          rechargeDate: { $gte: startOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    const lastMonthRevenue = await Recharge.aggregate([
      {
        $match: {
          status: 'completed',
          rechargeDate: { $gte: startOfLastMonth, $lte: endOfLastMonth },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    const yearlyRevenue = await Recharge.aggregate([
      {
        $match: {
          status: 'completed',
          rechargeDate: { $gte: startOfYear },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    // Subscription Statistics
    const subscriptionStats = await Subscription.aggregate([
      {
        $lookup: {
          from: 'companies',
          localField: '_id',
          foreignField: 'subscriptionId',
          as: 'companies',
        },
      },
      {
        $project: {
          name: '$name',
          price: '$price',
          billingCycle: '$billingCycle',
          companyCount: { $size: '$companies' },
        },
      },
    ]);

    // Companies Expiring Soon (next 7 days)
    // [HARD DELETE] Company isActive is subscription status - KEEP filter for active subscriptions only
    const expiringCompanies = await Company.find({
      isActive: true,
      subscriptionEndDate: {
        $gte: now,
        $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    })
      .populate('subscriptionId', 'name price')
      .select('name email subscriptionEndDate')
      .sort({ subscriptionEndDate: 1 })
      .limit(10);

    // Recently Expired Companies
    const recentlyExpired = await Company.find({
      subscriptionEndDate: { $lt: now, $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
    })
      .populate('subscriptionId', 'name price')
      .select('name email subscriptionEndDate')
      .sort({ subscriptionEndDate: -1 })
      .limit(5);

    // Recent Companies (last 30 days)
    const recentCompanies = await Company.find()
      .populate('subscriptionId', 'name price')
      .populate('createdBy', 'name email')
      .select('name email isActive createdAt subscriptionEndDate createdBy')
      .sort({ createdAt: -1 })
      .limit(10);

    // Monthly Revenue Trend (last 12 months)
    const monthlyTrend = await Recharge.aggregate([
      {
        $match: {
          status: 'completed',
          rechargeDate: { $gte: new Date(now.getFullYear() - 1, now.getMonth(), 1) },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$rechargeDate' } },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Company Statistics by Plan
    const companiesByPlan = await Company.aggregate([
      {
        $lookup: {
          from: 'subscriptions',
          localField: 'subscriptionId',
          foreignField: '_id',
          as: 'subscription',
        },
      },
      { $unwind: '$subscription' },
      {
        $group: {
          _id: '$subscription.name',
          count: { $sum: 1 },
          totalSims: { $sum: '$stats.totalSims' },
        },
      },
    ]);

    return {
      platform: {
        totalCompanies,
        activeCompanies,
        inactiveCompanies,
        expiredSubscriptions,
      },
      users: {
        superAdmins: superAdminCount,
        admins: totalAdmins,
        users: totalUsers,
        total: superAdminCount + totalAdmins + totalUsers,
      },
      sims: {
        total: totalSims,
        active: activeSims,
        inactive: inactiveSims,
      },
      revenue: {
        monthly: monthlyRevenue[0]?.total || 0,
        monthlyCount: monthlyRevenue[0]?.count || 0,
        lastMonth: lastMonthRevenue[0]?.total || 0,
        yearly: yearlyRevenue[0]?.total || 0,
        yearlyCount: yearlyRevenue[0]?.count || 0,
      },
      subscriptions: {
        plans: subscriptionStats,
        expiringSoon: expiringCompanies,
        recentlyExpired,
      },
      recentCompanies,
      monthlyTrend,
      companiesByPlan,
    };
  }
}

module.exports = new DashboardService();