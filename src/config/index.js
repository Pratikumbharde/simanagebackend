module.exports = {
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM,
  },
  app: {
    frontendUrl: process.env.FRONTEND_URL,
    backendUrl: process.env.BACKEND_URL,
    port: parseInt(process.env.PORT) || 5000,
    env: process.env.NODE_ENV || 'development',
  },
  pagination: {
    defaultPage: 1,
    defaultLimit: 10,
    maxLimit: 100,
  },
  subscription: {
    trialDays: 14,
    reminderDays: [7, 3, 1],
  },
  recharge: {
    reminderDaysBefore: 3,
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },
  payu: {
    key: process.env.PAYU_MERCHANT_KEY || '',
    salt: process.env.PAYU_MERCHANT_SALT || '',
    isProduction: process.env.PAYU_IS_PRODUCTION === 'true',
    testUrl: 'https://test.payu.in/_payment',
    prodUrl: 'https://secure.payu.in/_payment',
    verifyApiUrl: process.env.PAYU_IS_PRODUCTION === 'true'
      ? 'https://info.payu.in/merchant/postservice.php?form=2'
      : 'https://test.payu.in/merchant/postservice.php?form=2',
    // These URLs are where PayU sends POST requests after payment.
    // They MUST point to the backend API, not the frontend.
    // The backend controller then redirects the browser to the frontend.
    successUrl: process.env.PAYU_SUCCESS_URL || (process.env.BACKEND_URL || 'http://localhost:5000') + '/api/payu/success',
    failureUrl: process.env.PAYU_FAILURE_URL || (process.env.BACKEND_URL || 'http://localhost:5000') + '/api/payu/failure',
    cancelUrl: process.env.PAYU_CANCEL_URL || (process.env.BACKEND_URL || 'http://localhost:5000') + '/api/payu/cancel',
    // Frontend URLs for browser redirect after backend processing
    frontendSuccessUrl: (process.env.FRONTEND_URL || 'http://localhost:5173') + '/payment/success',
    frontendFailureUrl: (process.env.FRONTEND_URL || 'http://localhost:5173') + '/payment/failure',
    bbps: {
      clientId: process.env.PAYU_BBPS_CLIENT_ID || '',
      clientSecret: process.env.PAYU_BBPS_CLIENT_SECRET || '',
      agentId: process.env.PAYU_BBPS_AGENT_ID || '1',
      isProduction: process.env.PAYU_IS_PRODUCTION === 'true',
    },
  },
  cctv: {
    // Images stored on filesystem in backend/uploads/ (served via Express static)
    // cloudinaryFolder is no longer used for CCTV snapshots
    snapshotMaxSizeMB: parseInt(process.env.SNAPSHOT_MAX_SIZE_MB) || 10,
    defaultSnapshotRetentionDays: parseInt(process.env.DEFAULT_SNAPSHOT_RETENTION_DAYS) || 30,
    agentTokenExpiryDays: parseInt(process.env.AGENT_TOKEN_EXPIRY_DAYS) || 365,
    heartbeatIntervalSeconds: parseInt(process.env.HEARTBEAT_INTERVAL_SECONDS) || 60,
    cameraHealthCheckIntervalMinutes: parseInt(process.env.CAMERA_HEALTH_CHECK_INTERVAL_MINUTES) || 10,
    agentHealthCheckIntervalMinutes: parseInt(process.env.AGENT_HEALTH_CHECK_INTERVAL_MINUTES) || 5,
    snapshotCleanupCron: process.env.SNAPSHOT_CLEANUP_CRON || '0 3 * * *',
    alertCleanupCron: process.env.ALERT_CLEANUP_CRON || '0 4 * * 0',
    defaultCaptureInterval: parseInt(process.env.DEFAULT_CAPTURE_INTERVAL) || 30,
    defaultImageQuality: parseInt(process.env.DEFAULT_IMAGE_QUALITY) || 80,
    defaultResolution: process.env.DEFAULT_RESOLUTION || 'original',
  },
};