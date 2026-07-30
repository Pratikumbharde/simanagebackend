/**
 * One-time script to reset all report schedules that are stuck in "failed" state.
 * Clears lastSentAt, lastSendStatus, and lastSendError so they can be retried.
 *
 * Usage: node reset-schedules.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function reset() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set in .env');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected.');

  // Show current state of all schedules before reset
  const beforeSchedules = await mongoose.connection.db.collection('reportschedules').find({}).toArray();
  console.log(`\n=== BEFORE RESET: ${beforeSchedules.length} total schedules ===`);
  for (const s of beforeSchedules) {
    console.log(`  ${s.email} | active: ${s.isActive} | time: ${s.time} | types: ${(s.schedules || []).join(',')} | lastStatus: ${s.lastSendStatus || 'none'} | lastSentAt: ${s.lastSentAt || 'never'} | lastError: ${s.lastSendError || 'none'}`);
  }

  // Reset all failed schedules
  const result = await mongoose.connection.db.collection('reportschedules').updateMany(
    { lastSendStatus: 'failed' },
    { $set: { lastSentAt: null, lastSendStatus: null, lastSendError: null } }
  );

  console.log(`\n✅ Reset ${result.modifiedCount} schedule(s) — cleared failed state for retry.`);

  // Show state after reset
  const afterSchedules = await mongoose.connection.db.collection('reportschedules').find({}).toArray();
  console.log(`\n=== AFTER RESET: ${afterSchedules.length} total schedules ===`);
  for (const s of afterSchedules) {
    console.log(`  ${s.email} | active: ${s.isActive} | time: ${s.time} | types: ${(s.schedules || []).join(',')} | lastStatus: ${s.lastSendStatus || 'none'} | lastSentAt: ${s.lastSentAt || 'never'}`);
  }

  await mongoose.disconnect();
  console.log('\nDone. Disconnected from MongoDB.');
  process.exit(0);
}

reset().catch(e => { console.error('Error:', e.message); process.exit(1); });