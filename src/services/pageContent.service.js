const PageContent = require('../models/pageContent.model')

class PageContentService {
  /**
   * Get page content by slug (public)
   */
  async getPageBySlug(slug) {
    const page = await PageContent.findOne({ slug })
    return page
  }

  /**
   * Get all pages (for admin)
   */
  async getAllPages() {
    const pages = await PageContent.find({})
      .select('slug title metaDescription updatedAt')
      .sort({ slug: 1 })
    return pages
  }

  /**
   * Get full page details by slug (for editing)
   */
  async getPageDetailsBySlug(slug) {
    const page = await PageContent.findOne({ slug })
    return page
  }

  /**
   * Create or update page content
   */
  async upsertPage(slug, data) {
    const page = await PageContent.findOneAndUpdate(
      { slug },
      {
        $set: {
          title: data.title,
          content: data.content,
          metaDescription: data.metaDescription || '',
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    )
    return page
  }

  /**
   * Initialize default pages if they don't exist
   */
  async initializeDefaultPages() {
    const defaultPages = [
      {
        slug: 'privacy-policy',
        title: 'Privacy Policy',
        content: `<h1>Privacy Policy</h1>
<p><strong>Last updated:</strong> ${new Date().toLocaleDateString()}</p>

<h2>1. Introduction</h2>
<p>Welcome to SIM Trackr. We respect your privacy and are committed to protecting your personal data. This privacy policy will inform you about how we look after your personal data when you visit our website and tell you about your privacy rights and how the law protects you.</p>

<h2>2. Data We Collect</h2>
<p>We may collect, use, store and transfer different kinds of personal data about you, which we have grouped together as follows:</p>
<ul>
<li><strong>Identity Data:</strong> includes first name, last name, username or similar identifier.</li>
<li><strong>Contact Data:</strong> includes Email ID, telephone numbers.</li>
<li><strong>Technical Data:</strong> includes internet protocol (IP) address, browser type and version, time zone setting and location.</li>
<li><strong>Usage Data:</strong> includes information about how you use our website and services.</li>
</ul>

<h2>3. How We Use Your Data</h2>
<p>We will only use your personal data when the law allows us to. Most commonly, we will use your personal data in the following circumstances:</p>
<ul>
<li>To provide and maintain our service</li>
<li>To notify you about changes to our service</li>
<li>To provide customer support</li>
<li>To gather analysis or valuable information so that we can improve our service</li>
<li>To monitor the usage of our service</li>
</ul>

<h2>4. Data Security</h2>
<p>We have put in place appropriate security measures to prevent your personal data from being accidentally lost, used or accessed in an unauthorized way, altered or disclosed.</p>

<h2>5. Contact Us</h2>
<p>If you have any questions about this privacy policy or our data practices, please contact us at <a href="mailto:support@simtrackr.com">support@simtrackr.com</a></p>`,
        metaDescription: 'Privacy Policy for SIM Trackr - Learn how we collect, use, and protect your personal data.',
      },
      {
        slug: 'terms-of-service',
        title: 'Terms of Service',
        content: `<h1>Terms of Service</h1>
<p><strong>Last updated:</strong> ${new Date().toLocaleDateString()}</p>

<h2>1. Agreement to Terms</h2>
<p>By accessing or using SIM Trackr, you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using or accessing this site.</p>

<h2>2. Use License</h2>
<p>Permission is granted to temporarily use SIM Trackr for personal or commercial business use subject to the following restrictions:</p>
<ul>
<li>You must have an active subscription to use the service</li>
<li>You may not modify or copy the software</li>
<li>You may not use the service for any illegal purpose</li>
<li>You are responsible for maintaining the confidentiality of your account</li>
</ul>

<h2>3. Subscription and Payments</h2>
<p>Our service operates on a subscription basis. By subscribing, you agree to:</p>
<ul>
<li>Pay the applicable subscription fees</li>
<li>Provide accurate billing information</li>
<li>Notify us of any changes to your billing information</li>
</ul>
<p>Subscription fees are non-refundable except as expressly stated in these terms.</p>

<h2>4. User Responsibilities</h2>
<p>You are responsible for:</p>
<ul>
<li>Maintaining the security of your account credentials</li>
<li>All activities that occur under your account</li>
<li>Ensuring your use complies with all applicable laws</li>
</ul>

<h2>5. Termination</h2>
<p>We may terminate or suspend your access to the service immediately, without prior notice or liability, for any reason, including breach of these Terms.</p>

<h2>6. Limitation of Liability</h2>
<p>In no event shall SIM Trackr be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses.</p>

<h2>7. Changes to Terms</h2>
<p>We reserve the right to modify these terms at any time. We will notify users of any material changes by posting the new Terms on this page.</p>

<h2>8. Contact Us</h2>
<p>If you have any questions about these Terms, please contact us at <a href="mailto:support@simtrackr.com">support@simtrackr.com</a></p>`,
        metaDescription: 'Terms of Service for SIM Trackr - Read our terms and conditions for using our SIM management services.',
      },
    ]

    for (const pageData of defaultPages) {
      const existing = await PageContent.findOne({ slug: pageData.slug })
      if (!existing) {
        await PageContent.create(pageData)
      }
    }
  }
}

module.exports = new PageContentService()