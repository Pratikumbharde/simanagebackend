const mongoose = require('mongoose');
const { Schema } = mongoose;

const LandingContentSchema = new Schema({
  // Branding
  branding: {
    siteName: { type: String, default: 'SIM Manager' },
    logoUrl: { type: String, default: '' },
    logoDarkUrl: { type: String, default: '' }, // For dark backgrounds
    faviconUrl: { type: String, default: '' },
  },

  // Hero Section
  hero: {
    badge: { type: String, default: 'Trusted by 500+ Companies' },
    title: { type: String, default: 'Manage All Your' },
    highlight: { type: String, default: 'SIM Cards' },
    suffix: { type: String, default: 'in One Place' },
    subtitle: { type: String, default: 'Track recharges, sync call logs, monitor messaging apps, and manage your entire SIM inventory with our powerful cloud platform.' },
    cta1Text: { type: String, default: 'Start Free Trial' },
    cta1Link: { type: String, default: '/register' },
    cta2Text: { type: String, default: 'Watch Demo' },
    cta2Link: { type: String, default: '#demo' },
    trustBadges: [{
      icon: { type: String, default: 'FiShield' },
      text: { type: String, default: '' }
    }]
  },

  // Stats Section
  stats: [{
    value: { type: String, default: '' },
    label: { type: String, default: '' }
  }],

  // Features Section
  features: {
    title: { type: String, default: 'Everything You Need to Manage SIMs' },
    subtitle: { type: String, default: 'Powerful features designed to simplify SIM management for businesses of all sizes.' },
    items: [{
      icon: { type: String, default: 'FiSmartphone' },
      title: { type: String, default: '' },
      description: { type: String, default: '' }
    }]
  },

  // How It Works Section
  howItWorks: {
    title: { type: String, default: 'How It Works' },
    subtitle: { type: String, default: 'Get started in minutes with our simple 4-step process.' },
    steps: [{
      step: { type: Number, default: 1 },
      title: { type: String, default: '' },
      description: { type: String, default: '' }
    }]
  },

  // Testimonials Section
  testimonials: {
    title: { type: String, default: 'Loved by Businesses' },
    subtitle: { type: String, default: 'See what our customers have to say about SIM Manager.' },
    items: [{
      name: { type: String, default: '' },
      role: { type: String, default: '' },
      company: { type: String, default: '' },
      content: { type: String, default: '' },
      rating: { type: Number, default: 5, min: 1, max: 5 },
      photo: { type: String, default: null }
    }]
  },

  // Integrations Section
  integrations: {
    title: { type: String, default: 'Track Messaging Apps' },
    subtitle: { type: String, default: 'Monitor WhatsApp and Telegram status for your managed SIMs.' },
    whatsapp: {
      title: { type: String, default: 'WhatsApp' },
      description: { type: String, default: 'Track which SIMs have WhatsApp active, monitor last active time, and get alerts when status changes.' },
      features: [{ type: String, default: '' }]
    },
    telegram: {
      title: { type: String, default: 'Telegram' },
      description: { type: String, default: 'Monitor Telegram activation status across all your SIMs and keep track of messaging activity.' },
      features: [{ type: String, default: '' }]
    }
  },

  // FAQ Section
  faq: {
    title: { type: String, default: 'Frequently Asked Questions' },
    subtitle: { type: String, default: 'Got questions? We\'ve got answers.' },
    items: [{
      question: { type: String, default: '' },
      answer: { type: String, default: '' },
      order: { type: Number, default: 0 }
    }]
  },

  // CTA Section
  cta: {
    headline: { type: String, default: 'Ready to Simplify SIM Management?' },
    subtitle: { type: String, default: 'Join 500+ companies already using SIM Manager. Start your free trial today.' },
    button1Text: { type: String, default: 'Start Free Trial' },
    button1Link: { type: String, default: '/register' },
    button2Text: { type: String, default: 'Sign In' },
    button2Link: { type: String, default: '/login' }
  },

  // Footer Section
  footer: {
    brandDescription: { type: String, default: 'The complete SIM management solution for modern businesses.' },
    socialLinks: [{
      platform: { type: String, default: '' },
      url: { type: String, default: '' }
    }],
    productLinks: [{
      text: { type: String, default: '' },
      url: { type: String, default: '' }
    }],
    contact: {
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
    },
    copyright: { type: String, default: '© 2026 SIM Manager. All rights reserved.' }
  },

  // Metadata
  isActive: { type: Boolean, default: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

// Ensure only one active landing content
LandingContentSchema.pre('save', async function(next) {
  if (this.isActive) {
    await mongoose.model('LandingContent').updateMany(
      { _id: { $ne: this._id } },
      { isActive: false }
    );
  }
  next();
});

// Static method to get active content
LandingContentSchema.statics.getActiveContent = function() {
  return this.findOne({ isActive: true });
};

// Static method to get default content
LandingContentSchema.statics.getDefaultContent = function() {
  return {
    hero: {
      badge: 'Trusted by 500+ Companies',
      title: 'Manage All Your',
      highlight: 'SIM Cards',
      suffix: 'in One Place',
      subtitle: 'Track recharges, sync call logs, monitor messaging apps, and manage your entire SIM inventory with our powerful cloud platform.',
      cta1Text: 'Start Free Trial',
      cta1Link: '/register',
      cta2Text: 'Watch Demo',
      cta2Link: '#demo',
      trustBadges: [
        { icon: 'FiShield', text: '256-bit SSL' },
        { icon: 'FiCheck', text: '14-day Free Trial' },
        { icon: 'FiCreditCard', text: 'No Credit Card Required' }
      ]
    },
    stats: [
      { value: '500+', label: 'Companies Trust Us' },
      { value: '50K+', label: 'SIMs Managed' },
      { value: '1M+', label: 'Call Logs Synced' },
      { value: '99.9%', label: 'Uptime Guarantee' }
    ],
    features: {
      title: 'Everything You Need to Manage SIMs',
      subtitle: 'Powerful features designed to simplify SIM management for businesses of all sizes.',
      items: [
        { icon: 'FiSmartphone', title: 'SIM Management', description: 'Manage all your SIM cards in one place. Track operators, circles, status, and assignments effortlessly.' },
        { icon: 'FiCreditCard', title: 'Recharge Tracking', description: 'Never miss a recharge. Get reminders before expiry and track all recharge history with detailed analytics.' },
        { icon: 'FiBell', title: 'Smart Notifications', description: 'Automated alerts for recharge due dates, inactive SIMs, and subscription expiry. Stay informed always.' },
        { icon: 'FiBarChart2', title: 'Call Log Analytics', description: 'Sync call logs from mobile devices and analyze call patterns, durations, and contact frequency.' },
        { icon: 'FiUsers', title: 'Multi-User Access', description: 'Role-based access control. Admins manage everything, users sync call logs via mobile app.' },
        { icon: 'FiShield', title: 'Secure & Reliable', description: 'Enterprise-grade security with JWT authentication, encrypted data, and role-based permissions.' }
      ]
    },
    howItWorks: {
      title: 'How It Works',
      subtitle: 'Get started in minutes with our simple 4-step process.',
      steps: [
        { step: 1, title: 'Sign Up', description: 'Create your free account in seconds' },
        { step: 2, title: 'Add SIMs', description: 'Import or manually add your SIM cards' },
        { step: 3, title: 'Install App', description: 'Download mobile app for call log sync' },
        { step: 4, title: 'Track & Manage', description: 'Monitor everything from dashboard' }
      ]
    },
    testimonials: {
      title: 'Loved by Businesses',
      subtitle: 'See what our customers have to say about SIM Manager.',
      items: [
        { name: 'Rajesh Kumar', role: 'Operations Manager', company: 'TechConnect Solutions', content: 'SIM Manager has transformed how we manage our company SIMs. The recharge reminders alone have saved us thousands in missed recharges.', rating: 5 },
        { name: 'Priya Sharma', role: 'IT Administrator', company: 'Global Communications', content: 'The call log sync feature is brilliant. We can now track all company calls in one dashboard. Highly recommended!', rating: 5 },
        { name: 'Amit Patel', role: 'Business Owner', company: 'Smart Telecom', content: 'Finally, a simple yet powerful SIM management solution. The mobile app makes call log syncing effortless.', rating: 5 }
      ]
    },
    integrations: {
      title: 'Track Messaging Apps',
      subtitle: 'Monitor WhatsApp and Telegram status for your managed SIMs.',
      whatsapp: {
        title: 'WhatsApp',
        description: 'Track which SIMs have WhatsApp active, monitor last active time, and get alerts when status changes.',
        features: ['Status tracking', 'Last active monitoring', 'Bulk status updates']
      },
      telegram: {
        title: 'Telegram',
        description: 'Monitor Telegram activation status across all your SIMs and keep track of messaging activity.',
        features: ['Status tracking', 'Last active monitoring', 'Bulk status updates']
      }
    },
    faq: {
      title: 'Frequently Asked Questions',
      subtitle: 'Got questions? We\'ve got answers.',
      items: [
        { question: 'What is SIM Management SaaS?', answer: 'SIM Management SaaS is a cloud-based platform that helps businesses manage their SIM cards, track recharges, sync call logs, and monitor messaging app statuses all in one place.', order: 1 },
        { question: 'How does the mobile app work?', answer: 'Our mobile app (Android) automatically syncs call logs from registered devices to your dashboard. Simply install the app, verify your number via OTP, and grant call log permission.', order: 2 },
        { question: 'Is my data secure?', answer: 'Absolutely, We use industry-standard encryption, JWT authentication, and role-based access control. Your data is stored securely in the cloud with regular backups.', order: 3 },
        { question: 'Can I track WhatsApp/Telegram status?', answer: 'Yes! Professional and Enterprise plans include WhatsApp and Telegram status tracking for your managed SIMs.', order: 4 },
        { question: 'What payment methods do you accept?', answer: 'We accept all major payment methods including Credit/Debit Cards, UPI, Net Banking, and Wallets through Razorpay.', order: 5 },
        { question: 'Is there a free trial?', answer: 'Yes! All plans come with a 14-day free trial. No credit card required to start.', order: 6 }
      ]
    },
    cta: {
      headline: 'Ready to Simplify SIM Management?',
      subtitle: 'Join 500+ companies already using SIM Manager. Start your free trial today.',
      button1Text: 'Start Free Trial',
      button1Link: '/register',
      button2Text: 'Sign In',
      button2Link: '/login'
    },
    footer: {
      brandDescription: 'The complete SIM management solution for modern businesses.',
      socialLinks: [
        { platform: 'twitter', url: '#' },
        { platform: 'linkedin', url: '#' },
        { platform: 'facebook', url: '#' }
      ],
      productLinks: [
        { text: 'Features', url: '#features' },
        { text: 'Pricing', url: '#pricing' },
        { text: 'Integrations', url: '#integrations' },
        { text: 'Mobile App', url: '#' }
      ],
      contact: {
        phone: '+91 9876543210',
        email: 'contact@simtrackr.com',
      },
      copyright: '© 2026 SIM Manager. All rights reserved.'
    }
  };
};

module.exports = mongoose.model('LandingContent', LandingContentSchema);