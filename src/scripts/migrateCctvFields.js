/**
 * Migration Script: Add CCTV Monitoring fields to existing Subscription plans
 *
 * This script adds:
 * - features.cctvMonitoring (Boolean, default: false)
 * - limits.maxCameras (Number, default: 5)
 * - limits.maxSnapshotDays (Number, default: 30)
 *
 * Also adds any other missing feature fields from the schema:
 * - features.smsNotifications (Boolean, default: false)
 * - features.advancedReports (Boolean, default: false)
 * - features.apiAccess (Boolean, default: false)
 * - features.prioritySupport (Boolean, default: false)
 *
 * Run: node src/scripts/migrateCctvFields.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');

async function migrate() {
  try {
    const dbUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!dbUri) {
      console.error('ERROR: MongoDB connection string not found in environment variables');
      console.error('Make sure MONGODB_URI or MONGO_URI is set in your .env file');
      process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(dbUri);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('subscriptions');

    // Check how many plans exist
    const totalPlans = await collection.countDocuments({});
    console.log(`Found ${totalPlans} subscription plan(s)`);

    if (totalPlans === 0) {
      console.log('No subscription plans found. Nothing to migrate.');
      process.exit(0);
    }

    // Show current state of plans
    const plans = await collection.find({}).toArray();
    console.log('\nCurrent plans:');
    plans.forEach(plan => {
      console.log(`  - ${plan.name}: features=${JSON.stringify(plan.features || {})}, limits=${JSON.stringify(plan.limits || {})}`);
    });

    // Define defaults for missing fields
    const featureDefaults = {
      cctvMonitoring: false,
      smsNotifications: false,
      advancedReports: false,
      apiAccess: false,
      prioritySupport: false,
    };

    const limitDefaults = {
      maxCameras: 5,
      maxSnapshotDays: 30,
    };

    let updatedCount = 0;

    for (const plan of plans) {
      const updates = {};
      const featureUpdates = {};
      const limitUpdates = {};
      let needsUpdate = false;

      // Check and add missing feature fields
      if (!plan.features) {
        updates.features = { ...featureDefaults };
        needsUpdate = true;
      } else {
        for (const [key, defaultValue] of Object.entries(featureDefaults)) {
          if (plan.features[key] === undefined || plan.features[key] === null) {
            featureUpdates[key] = defaultValue;
            needsUpdate = true;
          }
        }
        if (Object.keys(featureUpdates).length > 0) {
          updates.features = { ...plan.features, ...featureUpdates };
        }
      }

      // Check and add missing limit fields
      if (!plan.limits) {
        updates.limits = { maxSims: 10, maxUsers: 5, maxRecharges: 100, ...limitDefaults };
        needsUpdate = true;
      } else {
        for (const [key, defaultValue] of Object.entries(limitDefaults)) {
          if (plan.limits[key] === undefined || plan.limits[key] === null) {
            limitUpdates[key] = defaultValue;
            needsUpdate = true;
          }
        }
        if (Object.keys(limitUpdates).length > 0) {
          updates.limits = { ...plan.limits, ...limitUpdates };
        }
      }

      if (needsUpdate) {
        // Build MongoDB update query
        const updateQuery = {};
        if (updates.features) {
          updateQuery['features'] = updates.features;
        } else if (Object.keys(featureUpdates).length > 0) {
          // Use $set for individual feature fields
          for (const [key, value] of Object.entries(featureUpdates)) {
            updateQuery[`features.${key}`] = value;
          }
        }
        if (updates.limits) {
          updateQuery['limits'] = updates.limits;
        } else if (Object.keys(limitUpdates).length > 0) {
          // Use $set for individual limit fields
          for (const [key, value] of Object.entries(limitUpdates)) {
            updateQuery[`limits.${key}`] = value;
          }
        }

        const result = await collection.updateOne(
          { _id: plan._id },
          { $set: updateQuery }
        );

        if (result.modifiedCount > 0) {
          updatedCount++;
          console.log(`  ✓ Updated "${plan.name}" — added: ${Object.keys(featureUpdates).length > 0 ? `features.${Object.keys(featureUpdates).join(', features.')}` : ''}${Object.keys(limitUpdates).length > 0 ? `limits.${Object.keys(limitUpdates).join(', limits.')}` : ''}`);
        }
      } else {
        console.log(`  - "${plan.name}" — already up to date, no changes needed`);
      }
    }

    // Show updated state
    console.log('\nUpdated plans:');
    const updatedPlans = await collection.find({}).toArray();
    updatedPlans.forEach(plan => {
      console.log(`  - ${plan.name}: features=${JSON.stringify(plan.features)}, limits=${JSON.stringify(plan.limits)}`);
    });

    console.log(`\n✅ Migration complete! Updated ${updatedCount} of ${totalPlans} plan(s).`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed.');
  }
}

migrate();