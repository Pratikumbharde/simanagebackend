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
    successUrl: process.env.PAYU_SUCCESS_URL || (process.env.FRONTEND_URL || 'http://localhost:5173') + '/payment/success',
    failureUrl: process.env.PAYU_FAILURE_URL || (process.env.FRONTEND_URL || 'http://localhost:5173') + '/payment/failure',
    bbps: {
      clientId: process.env.PAYU_BBPS_CLIENT_ID || '',
      clientSecret: process.env.PAYU_BBPS_CLIENT_SECRET || '',
      agentId: process.env.PAYU_BBPS_AGENT_ID || '1',
      isProduction: process.env.PAYU_IS_PRODUCTION === 'true',
    },
  },
};