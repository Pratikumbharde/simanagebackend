const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const dns = require('dns');


dns.setServers(["8.8.8.8","8.8.4.4"]);
require('dotenv').config();




// Import database connection
const connectDB = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth/auth.routes');
const companyRoutes = require('./routes/company/company.routes');
const subscriptionRoutes = require('./routes/subscription/subscription.routes');
const simRoutes = require('./routes/sim/sim.routes');
const rechargeRoutes = require('./routes/recharge/recharge.routes');
const callLogRoutes = require('./routes/callLog/callLog.routes');
const notificationRoutes = require('./routes/notification/notification.routes');
const dashboardRoutes = require('./routes/dashboard/dashboard.routes');
const statusRoutes = require('./routes/status/status.routes');
const paymentRoutes = require('./routes/payment/payment.routes');
const reportRoutes = require('./routes/report/report.routes');
const userRoutes = require('./routes/user/user.routes');
const auditLogRoutes = require('./routes/auditLog/auditLog.routes');
const whatsappRoutes = require('./routes/whatsapp/whatsapp.routes');
const telegramRoutes = require('./routes/telegram/telegram.routes');
const smsRoutes = require('./routes/sms/sms.routes');
const wifiRoutes = require('./routes/wifi/wifi.routes');
const deviceRoutes = require('./routes/device/device.routes'); // [SIM-BASED WIFI ACCESS CONTROL]
const landingContentRoutes = require('./routes/landingContent/landingContent.routes');
const pageContentRoutes = require('./routes/pageContent/pageContent.routes');
const callAutomationRoutes = require('./routes/callAutomation/callAutomation.routes'); // [CALL AUTOMATION]
const leadRoutes = require('./routes/lead/lead.routes');
const reportScheduleRoutes = require('./routes/reportSchedule/reportSchedule.routes');
const payuRoutes = require('./routes/payu/payu.routes'); // [PAYU PAYMENT GATEWAY]
const rechargePlanRoutes = require('./routes/rechargePlan/rechargePlan.routes'); // [RECHARGE PLANS]
const { seed: seedRechargePlans } = require('./seeders/rechargePlans.seeder'); // [RECHARGE PLANS]

// CCTV Monitoring routes
const officeRoutes = require('./routes/cctv/office.routes');
const cameraRoutes = require('./routes/cctv/camera.routes');
const agentRoutes = require('./routes/cctv/agent.routes');
const snapshotRoutes = require('./routes/cctv/snapshot.routes');
const alertRoutes = require('./routes/cctv/cameraAlert.routes');
const cctvDashboardRoutes = require('./routes/cctv/dashboard.routes');

// Import middleware
const errorHandler = require('./middleware/errorHandler');

// Import services
const cronService = require('./jobs');
const pageContentService = require('./services/pageContent.service');
const Sim = require('./models/sim/sim.model');

// Create Express app
const app = express();

// Create HTTP server (needed for Socket.IO)
const http = require('http');
const server = http.createServer(app);

// Initialize Socket.IO
const { initializeSocket } = require('./config/socket');
initializeSocket(server);

// Connect to database
connectDB().then(async () => {
  // Migrate deprecated SIM statuses to 'inactive'
  try {
    const result = await Sim.updateMany(
      { status: { $in: ['suspended', 'lost'] } },
      { $set: { status: 'inactive' } }
    );
    if (result.modifiedCount > 0) {
      console.log(`[Migration] ${result.modifiedCount} SIM(s) migrated from suspended/lost → inactive`);
    }
  } catch (err) {
    console.error('[Migration] Failed to migrate SIM statuses:', err.message);
  }

  // Initialize cron jobs after database connection
  cronService.initJobs();
  // Initialize default legal pages
  await pageContentService.initializeDefaultPages();
  // Seed default recharge plans (idempotent — skips existing)
  try {
    await seedRechargePlans();
  } catch (err) {
    console.error('[Seeder] Failed to seed recharge plans:', err.message);
  }
});

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: false, // Prevent COOP header from blocking cross-origin API access
  crossOriginEmbedderPolicy: false, // Prevent COEP header from blocking cross-origin resource loading
}));
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'https://simtrackr.b100x.in',
      'https://sim-management-rho.vercel.app',
      'http://localhost:3001',
      'http://localhost:3000',
      'http://localhost:5000',
      'http://localhost:8081',
      'http://localhost:19000',
      'http://localhost:19001',
      'http://localhost:19002',
      'http://localhost:19006',
      process.env.FRONTEND_URL,
    ].filter(Boolean);

    // Allow all origins in development
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow any origin for now (you can restrict this in production)
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Cache-Control', 'Pragma', 'Origin'],
  exposedHeaders: ['Content-Length', 'Content-Range', 'Content-Disposition', 'X-Total-Count'],
  optionsSuccessStatus: 200,
}));

// Fallback CORS middleware — ensures CORS headers are present even on error responses
// and in case a reverse proxy strips headers from the cors package's response.
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && !res.getHeader('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Cache-Control, Pragma, Origin');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  // Handle preflight OPTIONS requests that may not have been caught by the cors middleware
  if (req.method === 'OPTIONS' && !res.headersSent) {
    return res.status(200).end();
  }
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Static files for uploads (primary: backend/uploads/, fallback: backend/src/uploads/ for legacy files)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // legacy path — branding logos etc.

// CCTV Agent download — serve installer from uploads/agents or camera-agent/dist
const agentFileName = 'CCTV Agent Setup 1.0.0.exe';
const agentDownloadDir = path.join(__dirname, '..', 'uploads', 'agents');
const agentDistDir = path.join(__dirname, '..', '..', 'camera-agent', 'dist');

app.use('/downloads/agents', (req, res, next) => {
  const fs = require('fs');
  const decodedPath = decodeURIComponent(req.path);
  const uploadsPath = path.join(agentDownloadDir, decodedPath);
  if (fs.existsSync(uploadsPath)) {
    return res.sendFile(uploadsPath);
  }
  const distPath = path.join(agentDistDir, decodedPath);
  if (fs.existsSync(distPath)) {
    return res.sendFile(distPath);
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/sims', simRoutes);
app.use('/api/recharges', rechargeRoutes);
app.use('/api/call-logs', callLogRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/wifi', wifiRoutes);
app.use('/api/device', deviceRoutes); // [SIM-BASED WIFI ACCESS CONTROL]
app.use('/api/landing-content', landingContentRoutes);
app.use('/api/pages', pageContentRoutes);
app.use('/api/call-automation', callAutomationRoutes); // [CALL AUTOMATION]
app.use('/api/leads', leadRoutes);
app.use('/api/report-schedules', reportScheduleRoutes);
app.use('/api/payu', payuRoutes); // [PAYU PAYMENT GATEWAY]
app.use('/api/recharge-plans', rechargePlanRoutes); // [RECHARGE PLANS]

// CCTV Monitoring routes
app.use('/api/cctv/offices', officeRoutes);
app.use('/api/cctv/cameras', cameraRoutes);
app.use('/api/cctv/agents', agentRoutes);
app.use('/api/cctv/snapshots', snapshotRoutes);
app.use('/api/cctv/alerts', alertRoutes);
app.use('/api/cctv/dashboard', cctvDashboardRoutes);

// CCTV Agent download info endpoint
app.get('/api/cctv/agent/download', (req, res) => {
  const fs = require('fs');
  const uploadsPath = path.join(agentDownloadDir, agentFileName);
  const distPath = path.join(agentDistDir, agentFileName);

  let filePath = null;
  if (fs.existsSync(uploadsPath)) {
    filePath = uploadsPath;
  } else if (fs.existsSync(distPath)) {
    filePath = distPath;
  }

  if (filePath) {
    const stats = fs.statSync(filePath);
    res.json({
      success: true,
      data: {
        name: agentFileName,
        version: '1.0.0',
        size: stats.size,
        downloadUrl: `${req.protocol}://${req.get('host')}/downloads/agents/${encodeURIComponent(agentFileName)}`,
      },
    });
  } else {
    res.json({
      success: true,
      data: {
        name: agentFileName,
        version: '1.0.0',
        size: null,
        downloadUrl: null,
      },
    });
  }
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Error handling middleware
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║                                                   ║
  ║   SIM Management SaaS API                        ║
  ║   Server running on port ${PORT}                    ║
  ║   Environment: ${process.env.NODE_ENV || 'development'}                       ║
  ║   Socket.IO: Enabled                              ║
  ║                                                   ║
  ╚═══════════════════════════════════════════════════╝
  `);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

module.exports = { app, server };