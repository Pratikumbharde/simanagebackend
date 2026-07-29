const mongoose = require('mongoose');

// [GLOBAL UNIQUE EMAIL] Drop old compound indexes on startup
const dropOldIndexes = async () => {
  try {
    const db = mongoose.connection.db;
    const collection = db.collection('users');

    // Get existing indexes
    const indexes = await collection.indexes();
    console.log('[INDEX] Current indexes:', indexes.map(i => i.name));

    // Drop old compound index if exists
    try {
      await collection.dropIndex('email_1_companyId_1');
      console.log('[INDEX] Dropped old compound index: email_1_companyId_1');
    } catch (e) {
      if (e.code !== 27) { // Ignore "index not found" error
        console.log('[INDEX] Compound index not found or already dropped');
      }
    }

    // Drop old partial email index if exists
    try {
      await collection.dropIndex('email_1');
      console.log('[INDEX] Dropped old partial index: email_1');
    } catch (e) {
      if (e.code !== 27) {
        console.log('[INDEX] Old email index not found or already dropped');
      }
    }

    console.log('[INDEX] Index cleanup complete. Mongoose will create new unique index on email.');
  } catch (error) {
    console.error('[INDEX] Error during index cleanup:', error.message);
  }
};

const connectDB = async (retries = 3) => {
  const connectionOptions = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000, // Increased from 5000
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[DB] Connecting to MongoDB (attempt ${attempt}/${retries})...`);

      const conn = await mongoose.connect(process.env.MONGODB_URI, connectionOptions);

      console.log(`[DB] MongoDB Connected: ${conn.connection.host}`);

      // [GLOBAL UNIQUE EMAIL] Drop old indexes after connection
      await dropOldIndexes();

      // Handle connection events
      mongoose.connection.on('error', (err) => {
        console.error('[DB] MongoDB connection error:', err.message);
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('[DB] MongoDB disconnected. Attempting to reconnect...');
      });

      mongoose.connection.on('reconnected', () => {
        console.log('[DB] MongoDB reconnected');
      });

      return conn;
    } catch (error) {
      console.error(`[DB] Connection attempt ${attempt} failed:`, error.message);

      // Provide helpful error messages
      if (error.message.includes('IP whitelist') || error.message.includes('whitelist')) {
        console.error('[DB] ERROR: Your IP is not whitelisted in MongoDB Atlas.');
        console.error('[DB] FIX: Go to MongoDB Atlas → Network Access → Add your current IP');
      } else if (error.message.includes('ETIMEOUT') || error.message.includes('ETIMEDOUT')) {
        console.error('[DB] ERROR: Connection timed out. This could be due to:');
        console.error('[DB]   1. Your IP is not whitelisted in MongoDB Atlas');
        console.error('[DB]   2. Network connectivity issues');
        console.error('[DB]   3. MongoDB Atlas cluster is paused (free tier)');
      } else if (error.message.includes('authentication') || error.message.includes('auth')) {
        console.error('[DB] ERROR: Authentication failed. Check your MongoDB username and password.');
      }

      if (attempt < retries) {
        console.log(`[DB] Retrying in 3 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  // All retries failed
  console.error('[DB] All connection attempts failed. Please check:');
  console.error('[DB]   1. Your internet connection');
  console.error('[DB]   2. MongoDB Atlas IP whitelist (Network Access)');
  console.error('[DB]   3. MongoDB Atlas cluster status (is it paused?)');
  console.error('[DB]   4. MONGODB_URI in your .env file');
  console.error('[DB]   5. MongoDB Atlas username/password');
  process.exit(1);
};

module.exports = connectDB;