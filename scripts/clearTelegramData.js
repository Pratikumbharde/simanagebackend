/**
 * Script to clear stale Telegram data from SIMs
 * Run with: node scripts/clearTelegramData.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment');
  process.exit(1);
}

async function clearTelegramData() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const simsCollection = db.collection('sims');

    // Find SIMs with stale telegram data (chatId set but not verified)
    const staleSims = await simsCollection.find({
      telegramChatId: { $ne: null },
      telegramPhoneVerified: { $ne: true }
    }).toArray();

    console.log(`\n📊 Found ${staleSims.length} SIMs with stale Telegram data:`);

    staleSims.forEach(sim => {
      console.log(`   - ${sim.mobileNumber} (chatId: ${sim.telegramChatId})`);
    });

    if (staleSims.length === 0) {
      console.log('\n✅ No stale data found. Database is clean!');
      process.exit(0);
    }

    // Clear the stale data
    console.log('\n🧹 Clearing stale Telegram data...');

    const result = await simsCollection.updateMany(
      {
        telegramChatId: { $ne: null },
        telegramPhoneVerified: { $ne: true }
      },
      {
        $set: {
          telegramChatId: null,
          telegramEnabled: false,
          telegramPhoneVerified: false,
          telegramUsername: null,
          telegramUserId: null,
          telegramPhoneNumber: null
        }
      }
    );

    console.log(`\n✅ Updated ${result.modifiedCount} SIMs`);
    console.log('🎉 Done! You can now test the Telegram linking again.');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

clearTelegramData();