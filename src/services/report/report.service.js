const Sim = require('../../models/sim/sim.model');
const Recharge = require('../../models/recharge/recharge.model');
const CallLog = require('../../models/callLog/callLog.model');
const Company = require('../../models/company/company.model');
const User = require('../../models/auth/user.model');
const xlsx = require('xlsx');
const mongoose = require('mongoose');

class ReportService {
  // SIM Report
  async generateSimReport(query, user) {
    const { startDate, endDate, status, operator, format = 'json', page = 1, limit = 10 } = query;
    const isExport = format === 'excel' || format === 'csv' || query.download === 'true';

    const filter = {};

    // Data isolation
    if (user.role !== 'super_admin') {
      filter.companyId = new mongoose.Types.ObjectId(user.companyId);
    } else if (query.companyId) {
      filter.companyId = new mongoose.Types.ObjectId(query.companyId);
    }

    if (status) filter.status = status;
    if (operator) filter.operator = operator;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    // Get total count for pagination
    const total = await Sim.countDocuments(filter);

    // Build query with optional pagination
    let simsQuery = Sim.find(filter)
      .populate('companyId', 'name')
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 });

    // Only apply pagination if not exporting
    if (!isExport) {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      simsQuery = simsQuery.skip(skip).limit(parseInt(limit));
    }

    const sims = await simsQuery.lean();

    // Calculate summary (based on all data, not just paginated)
    const summary = {
      total,
      byStatus: {},
      byOperator: {},
      whatsappEnabled: 0,
      telegramEnabled: 0,
    };

    // For summary, we need stats from all records (not just current page)
    const allSims = isExport ? sims : await Sim.find(filter).lean();
    allSims.forEach(sim => {
      summary.byStatus[sim.status] = (summary.byStatus[sim.status] || 0) + 1;
      summary.byOperator[sim.operator] = (summary.byOperator[sim.operator] || 0) + 1;
      if (sim.whatsappEnabled) summary.whatsappEnabled++;
      if (sim.telegramEnabled) summary.telegramEnabled++;
    });

    return { data: sims, summary, total, page: parseInt(page), limit: parseInt(limit) };
  }

  // Recharge Report
  async generateRechargeReport(query, user) {
    const { startDate, endDate, simId, format = 'json', page = 1, limit = 10 } = query;
    const isExport = format === 'excel' || format === 'csv' || query.download === 'true';

    const filter = { status: 'completed' };

    // Data isolation
    if (user.role !== 'super_admin') {
      filter.companyId = new mongoose.Types.ObjectId(user.companyId);
    } else if (query.companyId) {
      filter.companyId = new mongoose.Types.ObjectId(query.companyId);
    }

    if (simId) filter.simId = new mongoose.Types.ObjectId(simId);

    if (startDate || endDate) {
      filter.rechargeDate = {};
      if (startDate) filter.rechargeDate.$gte = new Date(startDate);
      if (endDate) filter.rechargeDate.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    // Get total count for pagination
    const total = await Recharge.countDocuments(filter);

    // Build query with optional pagination
    let rechargesQuery = Recharge.find(filter)
      .populate('simId', 'mobileNumber operator')
      .populate('companyId', 'name')
      .populate('createdBy', 'name')
      .sort({ rechargeDate: -1 });

    // Only apply pagination if not exporting
    if (!isExport) {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      rechargesQuery = rechargesQuery.skip(skip).limit(parseInt(limit));
    }

    const recharges = await rechargesQuery.lean();

    // Calculate summary (based on all data)
    const summary = {
      total,
      totalAmount: 0,
      avgAmount: 0,
      byPaymentMethod: {},
      byOperator: {},
    };

    // For summary stats, get all records
    const allRecharges = isExport ? recharges : await Recharge.find(filter).lean();
    summary.totalAmount = allRecharges.reduce((sum, r) => sum + (r.amount || 0), 0);
    summary.avgAmount = allRecharges.length > 0 ? summary.totalAmount / allRecharges.length : 0;

    allRecharges.forEach(r => {
      const method = r.paymentMethod || 'other';
      summary.byPaymentMethod[method] = (summary.byPaymentMethod[method] || 0) + 1;
    });

    return { data: recharges, summary, total, page: parseInt(page), limit: parseInt(limit) };
  }

  // Call Log Report
  async generateCallLogReport(query, user) {
    const { startDate, endDate, simId, callType, uniqueOnly, format = 'json', page = 1, limit = 10 } = query;
    const isExport = format === 'excel' || format === 'csv' || query.download === 'true';
    const showUniqueOnly = uniqueOnly === 'true' || uniqueOnly === true;

    const filter = {};

    // Data isolation
    if (user.role !== 'super_admin') {
      filter.companyId = new mongoose.Types.ObjectId(user.companyId);
    } else if (query.companyId) {
      filter.companyId = new mongoose.Types.ObjectId(query.companyId);
    }

    if (simId) filter.simId = new mongoose.Types.ObjectId(simId);
    if (callType) filter.callType = callType;

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    // Calculate summary using aggregation for accuracy (no 10k limit bias)
    const statsAgg = await CallLog.aggregate([
      { $match: filter },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        totalDuration: { $sum: '$duration' },
        uniqueNumbers: { $addToSet: '$phoneNumber' },
      }},
    ]);

    const byTypeAgg = await CallLog.aggregate([
      { $match: filter },
      { $group: { _id: '$callType', count: { $sum: 1 } } },
    ]);

    const stats = statsAgg[0] || { total: 0, totalDuration: 0, uniqueNumbers: [] };
    const byType = {};
    byTypeAgg.forEach(item => { byType[item._id] = item.count; });

    const summary = {
      total: stats.total,
      totalDuration: stats.totalDuration || 0,
      avgDuration: stats.total > 0 ? (stats.totalDuration || 0) / stats.total : 0,
      byType,
      uniqueNumbers: stats.uniqueNumbers ? stats.uniqueNumbers.length : 0,
    };

    // Unique numbers mode: return one record per phone number (most recent call)
    if (showUniqueOnly) {
      const allCallLogs = await CallLog.find(filter)
        .populate('simId', 'mobileNumber operator')
        .sort({ timestamp: -1 })
        .limit(10000)
        .lean();

      const uniqueMap = new Map();
      allCallLogs.forEach(c => {
        const key = c.phoneNumber;
        if (!uniqueMap.has(key) || new Date(c.timestamp) > new Date(uniqueMap.get(key).timestamp)) {
          uniqueMap.set(key, c);
        }
      });

      const uniqueResults = Array.from(uniqueMap.values())
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      const totalUnique = uniqueResults.length;

      let paginatedResults;
      if (isExport) {
        paginatedResults = uniqueResults;
      } else {
        const skip = (parseInt(page) - 1) * parseInt(limit);
        paginatedResults = uniqueResults.slice(skip, skip + parseInt(limit));
      }

      return { data: paginatedResults, summary, total: totalUnique, page: parseInt(page), limit: parseInt(limit) };
    }

    // Get total count for pagination
    const total = await CallLog.countDocuments(filter);

    // Build query with optional pagination
    let callLogsQuery = CallLog.find(filter)
      .populate('simId', 'mobileNumber operator')
      .sort({ timestamp: -1 });

    if (!isExport) {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      callLogsQuery = callLogsQuery.skip(skip).limit(parseInt(limit));
    } else {
      callLogsQuery = callLogsQuery.limit(10000);
    }

    const callLogs = await callLogsQuery.lean();

    return { data: callLogs, summary, total, page: parseInt(page), limit: parseInt(limit) };
  }

  // Company Report (Super Admin)
  async generateCompanyReport(query) {
    const { startDate, endDate, isActive, format = 'json', page = 1, limit = 10 } = query;
    const isExport = format === 'excel' || format === 'csv' || query.download === 'true';

    const filter = {};

    if (isActive !== undefined) filter.isActive = isActive === 'true';

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }
    // Get total count for pagination
    const total = await Company.countDocuments(filter);

    // Build query with optional pagination
    let companiesQuery = Company.find(filter)
      .populate('subscriptionId', 'name price')
      .sort({ createdAt: -1 });

    // Only apply pagination if not exporting
    if (!isExport) {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      companiesQuery = companiesQuery.skip(skip).limit(parseInt(limit));
    }

    const companies = await companiesQuery.lean();

    // Get additional stats for each company
    const companyStats = await Promise.all(
      companies.map(async (company) => {
        // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
        const simCount = await Sim.countDocuments({ companyId: company._id });
        const rechargeTotal = await Recharge.aggregate([
          { $match: { companyId: company._id, status: 'completed' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);

        return {
          ...company,
          stats: {
            totalSims: simCount,
            totalRechargeAmount: rechargeTotal[0]?.total || 0,
          },
        };
      })
    );

    // Calculate summary (based on all data)
    const allCompanies = isExport ? companies : await Company.find(filter).lean();
    const summary = {
      total,
      active: allCompanies.filter(c => c.isActive).length,
      inactive: allCompanies.filter(c => !c.isActive).length,
      totalSims: 0,
      totalRevenue: 0,
    };

    // Calculate total SIMs and revenue from all companies
    const allCompanyStats = await Promise.all(
      allCompanies.map(async (company) => {
        // [HARD DELETE] Removed isActive: true filter - SIMs are now hard deleted
        const simCount = await Sim.countDocuments({ companyId: company._id });
        const rechargeTotal = await Recharge.aggregate([
          { $match: { companyId: company._id, status: 'completed' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);
        return { totalSims: simCount, totalRevenue: rechargeTotal[0]?.total || 0 };
      })
    );

    summary.totalSims = allCompanyStats.reduce((sum, c) => sum + c.totalSims, 0);
    summary.totalRevenue = allCompanyStats.reduce((sum, c) => sum + c.totalRevenue, 0);

    return { data: companyStats, summary, total, page: parseInt(page), limit: parseInt(limit) };
  }

  // Export to Excel
  async exportToExcel(data, reportType) {
    const workbook = xlsx.utils.book_new();

    // Add data sheet
    const dataSheet = this.createDataSheet(data.data, reportType);
    xlsx.utils.book_append_sheet(workbook, dataSheet, 'Data');

    // Add summary sheet
    const summarySheet = this.createSummarySheet(data.summary, reportType);
    xlsx.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    return workbook;
  }

  createDataSheet(data, reportType) {
    let headers = [];
    let rows = [];

    switch (reportType) {
      case 'sims':
        headers = ['Contact Number', 'Operator', 'Circle', 'Status', 'WhatsApp', 'Telegram', 'Assigned To', 'Created'];
        rows = data.map(item => [
          item.mobileNumber,
          item.operator,
          item.circle || '',
          item.status,
          item.whatsappEnabled ? 'Yes' : 'No',
          item.telegramEnabled ? 'Yes' : 'No',
          item.assignedTo?.name || 'Unassigned',
          new Date(item.createdAt).toLocaleDateString(),
        ]);
        break;

      case 'recharges':
        headers = ['Contact Number', 'Operator', 'Amount', 'Validity', 'Plan', 'Payment Method', 'Date', 'Next Recharge'];
        rows = data.map(item => [
          item.simId?.mobileNumber || 'N/A',
          item.simId?.operator || 'N/A',
          item.amount,
          `${item.validity} days`,
          item.plan?.name || 'N/A',
          item.paymentMethod,
          new Date(item.rechargeDate).toLocaleDateString(),
          new Date(item.nextRechargeDate).toLocaleDateString(),
        ]);
        break;

      case 'callLogs':
        headers = ['Phone Number', 'Call Type', 'Duration (s)', 'SIM', 'Contact Name', 'Date'];
        rows = data.map(item => [
          item.phoneNumber,
          item.callType.charAt(0).toUpperCase() + item.callType.slice(1),
          item.callType === 'missed' ? 0 : item.duration,
          item.simId?.mobileNumber || 'N/A',
          item.contactName || '',
          new Date(item.timestamp).toLocaleString(),
        ]);
        break;

      case 'companies':
        headers = ['Company Name', 'Email', 'Status', 'Subscription', 'SIMs', 'Revenue', 'Created'];
        rows = data.map(item => [
          item.name,
          item.email,
          item.isActive ? 'Active' : 'Inactive',
          item.subscriptionId?.name || 'N/A',
          item.stats?.totalSims || 0,
          item.stats?.totalRechargeAmount || 0,
          new Date(item.createdAt).toLocaleDateString(),
        ]);
        break;
    }

    const sheetData = [headers, ...rows];
    return xlsx.utils.aoa_to_sheet(sheetData);
  }

  createSummarySheet(summary, reportType) {
    const rows = [['Summary Report'], [''], ['Metric', 'Value']];

    Object.entries(summary).forEach(([key, value]) => {
      if (typeof value === 'object') {
        rows.push([key.replace(/([A-Z])/g, ' $1').trim(), '']);
        Object.entries(value).forEach(([k, v]) => {
          rows.push([`  ${k}`, v]);
        });
      } else {
        rows.push([key.replace(/([A-Z])/g, ' $1').trim(), value]);
      }
    });

    return xlsx.utils.aoa_to_sheet(rows);
  }

  // Export to CSV
  async exportToCsv(data, reportType) {
    const headers = this.getHeaders(reportType);
    const rows = data.map(item => this.formatRow(item, reportType));

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  getHeaders(reportType) {
    const headerMap = {
      sims: ['Contact Number', 'Operator', 'Circle', 'Status', 'WhatsApp', 'Telegram', 'Assigned To', 'Created'],
      recharges: ['Contact Number', 'Operator', 'Amount', 'Validity', 'Plan', 'Payment Method', 'Date', 'Next Recharge'],
      callLogs: ['Phone Number', 'Call Type', 'Duration', 'SIM', 'Contact Name', 'Date'],
      companies: ['Company Name', 'Email', 'Status', 'Subscription', 'SIMs', 'Revenue', 'Created'],
    };
    return headerMap[reportType] || [];
  }

  formatRow(item, reportType) {
    switch (reportType) {
      case 'sims':
        return [
          item.mobileNumber,

          item.operator,
          item.circle || '',
          item.status,
          item.whatsappEnabled ? 'Yes' : 'No',
          item.telegramEnabled ? 'Yes' : 'No',
          item.assignedTo?.name || 'Unassigned',
          new Date(item.createdAt).toLocaleDateString(),
        ];
      case 'recharges':
        return [
          item.simId?.mobileNumber || 'N/A',
          item.simId?.operator || 'N/A',
          item.amount,
          `${item.validity} days`,
          item.plan?.name || 'N/A',
          item.paymentMethod,
          new Date(item.rechargeDate).toLocaleDateString(),
          new Date(item.nextRechargeDate).toLocaleDateString(),
        ];
      case 'callLogs':
        return [
          item.phoneNumber,
          item.callType.charAt(0).toUpperCase() + item.callType.slice(1),
          item.callType === 'missed' ? 0 : item.duration,
          item.simId?.mobileNumber || 'N/A',
          item.contactName || '',
          new Date(item.timestamp).toLocaleString(),
        ];
      case 'companies':
        return [
          item.name,
          item.email,
          item.isActive ? 'Active' : 'Inactive',
          item.subscriptionId?.name || 'N/A',
          item.stats?.totalSims || 0,
          item.stats?.totalRechargeAmount || 0,
          new Date(item.createdAt).toLocaleDateString(),
        ];
      default:
        return [];
    }
  }
}

module.exports = new ReportService();