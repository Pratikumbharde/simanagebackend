require('./src/models/company/company.model');
const AuditLog = require('./src/models/auditLog/auditLog.model');
const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sim-management');

    // Check all AUTH actions currently in the DB
    const pipeline = [
      { $match: { module: 'AUTH' } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ];
    const results = await AuditLog.aggregate(pipeline);
    console.log('All AUTH actions in DB:');
    results.forEach(r => console.log('  ' + r._id + ': ' + r.count));

    // Check most recent logs
    const recent = await AuditLog.find({ module: 'AUTH' })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('action createdAt role companyId');
    console.log('\nMost recent 5 AUTH logs:');
    recent.forEach(r => {
      console.log('  ' + r.action + ' | ' + r.createdAt.toISOString() + ' | role: ' + r.role + ' | companyId: ' + r.companyId);
    });

    await mongoose.disconnect();
  } catch(e) {
    console.error(e.message);
    process.exit(1);
  }
}
check();