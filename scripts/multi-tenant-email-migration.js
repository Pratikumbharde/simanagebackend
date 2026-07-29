/**
 * Multi-Tenant Email Migration Script
 *
 * This script migrates the User collection from global unique email
 * to compound unique index (email + companyId)
 *
 * Run this script ONCE after deploying the multi-tenant fix:
 * node scripts/multi-tenant-email-migration.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function migrate() {
  console.log('🔄 Starting Multi-Tenant Email Migration...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sim-management';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');

    // Step 1: Get existing indexes
    console.log('📋 Step 1: Checking existing indexes...');
    const existingIndexes = await usersCollection.indexes();
    console.log('Existing indexes:', existingIndexes.map(i => i.name).join(', '));

    // Step 2: Drop the old global unique email index
    console.log('\n📋 Step 2: Dropping old email_1 index...');
    try {
      await usersCollection.dropIndex('email_1');
      console.log('✅ Successfully dropped email_1 index');
    } catch (error) {
      if (error.code === 27 || error.message.includes('index not found')) {
        console.log('ℹ️  email_1 index does not exist (already removed or never created)');
      } else {
        throw error;
      }
    }

    // Step 3: Drop any existing compound index if it exists
    console.log('\n📋 Step 3: Checking for existing compound index...');
    try {
      await usersCollection.dropIndex('email_1_companyId_1');
      console.log('✅ Dropped existing compound index');
    } catch (error) {
      if (error.code === 27 || error.message.includes('index not found')) {
        console.log('ℹ️  No existing compound index to drop');
      } else {
        throw error;
      }
    }

    // Step 4: Create new compound unique index
    console.log('\n📋 Step 4: Creating new compound unique index (email + companyId)...');
    await usersCollection.createIndex(
      { email: 1, companyId: 1 },
      {
        unique: true,
        name: 'email_1_companyId_1',
        partialFilterExpression: { companyId: { $ne: null } }
      }
    );
    console.log('✅ Created compound index: email_1_companyId_1');

    // Step 5: Create separate unique index for users without companyId (super_admin, mobile users)
    console.log('\n📋 Step 5: Creating unique index for users without companyId...');
    await usersCollection.createIndex(
      { email: 1 },
      {
        unique: true,
        name: 'email_1_no_company',
        partialFilterExpression: { companyId: null }
      }
    );
    console.log('✅ Created index: email_1_no_company');

    // Step 6: Verify final indexes
    console.log('\n📋 Step 6: Verifying final indexes...');
    const finalIndexes = await usersCollection.indexes();
    console.log('\nFinal User indexes:');
    finalIndexes.forEach(index => {
      console.log(`  - ${index.name}: ${JSON.stringify(index.key)} ${index.unique ? '(UNIQUE)' : ''}`);
    });

    // Step 7: Check for potential duplicates
    console.log('\n📋 Step 7: Checking for duplicate emails within companies...');
    const duplicates = await usersCollection.aggregate([
      {
        $match: {
          companyId: { $ne: null }
        }
      },
      {
        $group: {
          _id: { email: '$email', companyId: '$companyId' },
          count: { $sum: 1 },
          ids: { $push: '$_id' }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]).toArray();

    if (duplicates.length > 0) {
      console.log('⚠️  WARNING: Found duplicate emails within companies:');
      duplicates.forEach(dup => {
        console.log(`  - Email: ${dup._id.email}, Company: ${dup._id.companyId}, Count: ${dup.count}`);
      });
      console.log('\nPlease resolve these duplicates manually before the application can work properly.');
    } else {
      console.log('✅ No duplicate emails found within companies');
    }

    console.log('\n✅ Migration completed successfully!\n');
    console.log('📌 Summary:');
    console.log('   - Removed global unique constraint on email');
    console.log('   - Added compound unique index: email + companyId');
    console.log('   - Added unique index for users without companyId');
    console.log('   - Same email can now be used in different companies');
    console.log('');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run migration
migrate();