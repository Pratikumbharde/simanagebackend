/**
 * Recharge Plan Seeder
 *
 * Seeds the database with popular recharge plans for major Indian operators.
 * Run with: node -e "require('./src/seeders/rechargePlans.seeder').seed()"
 *
 * These plans serve as a local fallback when PayU BBPS is not available.
 */

const mongoose = require('mongoose');
const RechargePlan = require('../models/rechargePlan/rechargePlan.model');

const PLANS = [
  // ===== Jio Plans =====
  { operator: 'Jio', circle: 'all', amount: 149, validity: 24, planType: 'popular', plan: { name: '₹149 Plan', data: '1GB/day', calls: 'Unlimited', sms: '100/day', description: '1GB/day data + Unlimited calls + 100 SMS/day for 24 days' }, sortOrder: 1 },
  { operator: 'Jio', circle: 'all', amount: 199, validity: 23, planType: 'data', plan: { name: '₹199 Plan', data: '1.5GB/day', calls: 'Unlimited', sms: '100/day', description: '1.5GB/day data + Unlimited calls + 100 SMS/day for 23 days' }, sortOrder: 2 },
  { operator: 'Jio', circle: 'all', amount: 249, validity: 23, planType: 'data', plan: { name: '₹249 Plan', data: '2GB/day', calls: 'Unlimited', sms: '100/day', description: '2GB/day data + Unlimited calls + 100 SMS/day for 23 days' }, sortOrder: 3 },
  { operator: 'Jio', circle: 'all', amount: 299, validity: 28, planType: 'popular', plan: { name: '₹299 Plan', data: '2GB/day', calls: 'Unlimited', sms: '100/day', description: '2GB/day data + Unlimited calls + 100 SMS/day for 28 days' }, sortOrder: 4 },
  { operator: 'Jio', circle: 'all', amount: 449, validity: 56, planType: 'combo', plan: { name: '₹449 Plan', data: '2GB/day', calls: 'Unlimited', sms: '100/day', description: '2GB/day data + Unlimited calls + 100 SMS/day for 56 days' }, sortOrder: 5 },
  { operator: 'Jio', circle: 'all', amount: 599, validity: 56, planType: 'data', plan: { name: '₹599 Plan', data: '1.5GB/day', calls: 'Unlimited', sms: '100/day', description: '1.5GB/day data + Unlimited calls + 100 SMS/day for 56 days' }, sortOrder: 6 },
  { operator: 'Jio', circle: 'all', amount: 799, validity: 84, planType: 'combo', plan: { name: '₹799 Plan', data: '2GB/day', calls: 'Unlimited', sms: '100/day', description: '2GB/day data + Unlimited calls + 100 SMS/day for 84 days' }, sortOrder: 7 },
  { operator: 'Jio', circle: 'all', amount: 999, validity: 84, planType: 'data', plan: { name: '₹999 Plan', data: '3GB/day', calls: 'Unlimited', sms: '100/day', description: '3GB/day data + Unlimited calls + 100 SMS/day for 84 days' }, sortOrder: 8 },
  { operator: 'Jio', circle: 'all', amount: 2599, validity: 365, planType: 'annual', plan: { name: '₹2599 Annual Plan', data: '2GB/day', calls: 'Unlimited', sms: '100/day', description: '2GB/day data + Unlimited calls + 100 SMS/day for 365 days' }, sortOrder: 9 },
  { operator: 'Jio', circle: 'all', amount: 2999, validity: 365, planType: 'annual', plan: { name: '₹2999 Annual Plan', data: '2.5GB/day', calls: 'Unlimited', sms: '100/day', description: '2.5GB/day data + Unlimited calls + 100 SMS/day for 365 days' }, sortOrder: 10 },

  // ===== Airtel Plans =====
  { operator: 'Airtel', circle: 'all', amount: 149, validity: 24, planType: 'popular', plan: { name: '₹149 Plan', data: '1GB/day', calls: 'Unlimited', sms: '100/day', description: '1GB/day data + Unlimited calls + 100 SMS/day for 24 days' }, sortOrder: 1 },
  { operator: 'Airtel', circle: 'all', amount: 179, validity: 24, planType: 'data', plan: { name: '₹179 Plan', data: '1GB/day', calls: 'Unlimited', sms: '100/day', description: '1GB/day data + Unlimited calls + 100 SMS/day for 24 days' }, sortOrder: 2 },
  { operator: 'Airtel', circle: 'all', amount: 265, validity: 28, planType: 'popular', plan: { name: '₹265 Plan', data: '1GB/day', calls: 'Unlimited', sms: '100/day', description: '1GB/day data + Unlimited calls + 100 SMS/day for 28 days' }, sortOrder: 3 },
  { operator: 'Airtel', circle: 'all', amount: 299, validity: 28, planType: 'data', plan: { name: '₹299 Plan', data: '1.5GB/day', calls: 'Unlimited', sms: '100/day', description: '1.5GB/day data + Unlimited calls + 100 SMS/day for 28 days' }, sortOrder: 4 },
  { operator: 'Airtel', circle: 'all', amount: 449, validity: 56, planType: 'combo', plan: { name: '₹449 Plan', data: '2GB/day', calls: 'Unlimited', sms: '100/day', description: '2GB/day data + Unlimited calls + 100 SMS/day for 56 days' }, sortOrder: 5 },
  { operator: 'Airtel', circle: 'all', amount: 509, validity: 56, planType: 'data', plan: { name: '₹509 Plan', data: '1.5GB/day', calls: 'Unlimited', sms: '100/day', description: '1.5GB/day data + Unlimited calls + 100 SMS/day for 56 days' }, sortOrder: 6 },
  { operator: 'Airtel', circle: 'all', amount: 749, validity: 84, planType: 'combo', plan: { name: '₹749 Plan', data: '1.5GB/day', calls: 'Unlimited', sms: '100/day', description: '1.5GB/day data + Unlimited calls + 100 SMS/day for 84 days' }, sortOrder: 7 },
  { operator: 'Airtel', circle: 'all', amount: 839, validity: 84, planType: 'data', plan: { name: '₹839 Plan', data: '2GB/day', calls: 'Unlimited', sms: '100/day', description: '2GB/day data + Unlimited calls + 100 SMS/day for 84 days' }, sortOrder: 8 },
  { operator: 'Airtel', circle: 'all', amount: 2899, validity: 365, planType: 'annual', plan: { name: '₹2899 Annual Plan', data: '2GB/day', calls: 'Unlimited', sms: '100/day', description: '2GB/day data + Unlimited calls + 100 SMS/day for 365 days' }, sortOrder: 9 },

  // ===== Vi (Vodafone Idea) Plans =====
  { operator: 'Vi', circle: 'all', amount: 149, validity: 21, planType: 'popular', plan: { name: '₹149 Plan', data: '1GB/day', calls: 'Unlimited', sms: '100/day', description: '1GB/day data + Unlimited calls + 100 SMS/day for 21 days' }, sortOrder: 1 },
  { operator: 'Vi', circle: 'all', amount: 199, validity: 24, planType: 'data', plan: { name: '₹199 Plan', data: '1GB/day', calls: 'Unlimited', sms: '100/day', description: '1GB/day data + Unlimited calls + 100 SMS/day for 24 days' }, sortOrder: 2 },
  { operator: 'Vi', circle: 'all', amount: 299, validity: 28, planType: 'popular', plan: { name: '₹299 Plan', data: '1.5GB/day', calls: 'Unlimited', sms: '100/day', description: '1.5GB/day data + Unlimited calls + 100 SMS/day for 28 days' }, sortOrder: 3 },
  { operator: 'Vi', circle: 'all', amount: 399, validity: 28, planType: 'data', plan: { name: '₹399 Plan', data: '2.5GB/day', calls: 'Unlimited', sms: '100/day', description: '2.5GB/day data + Unlimited calls + 100 SMS/day for 28 days' }, sortOrder: 4 },
  { operator: 'Vi', circle: 'all', amount: 499, validity: 56, planType: 'combo', plan: { name: '₹499 Plan', data: '1.5GB/day', calls: 'Unlimited', sms: '100/day', description: '1.5GB/day data + Unlimited calls + 100 SMS/day for 56 days' }, sortOrder: 5 },
  { operator: 'Vi', circle: 'all', amount: 719, validity: 84, planType: 'combo', plan: { name: '₹719 Plan', data: '1.5GB/day', calls: 'Unlimited', sms: '100/day', description: '1.5GB/day data + Unlimited calls + 100 SMS/day for 84 days' }, sortOrder: 6 },
  { operator: 'Vi', circle: 'all', amount: 2899, validity: 365, planType: 'annual', plan: { name: '₹2899 Annual Plan', data: '1.5GB/day', calls: 'Unlimited', sms: '100/day', description: '1.5GB/day data + Unlimited calls + 100 SMS/day for 365 days' }, sortOrder: 7 },

  // ===== BSNL Plans =====
  { operator: 'BSNL', circle: 'all', amount: 147, validity: 21, planType: 'popular', plan: { name: '₹147 Plan', data: '1GB/day', calls: 'Unlimited', sms: '100/day', description: '1GB/day data + Unlimited calls + 100 SMS/day for 21 days' }, sortOrder: 1 },
  { operator: 'BSNL', circle: 'all', amount: 197, validity: 18, planType: 'data', plan: { name: '₹197 Plan', data: '2GB/day', calls: 'Unlimited', sms: '100/day', description: '2GB/day data + Unlimited calls + 100 SMS/day for 18 days' }, sortOrder: 2 },
  { operator: 'BSNL', circle: 'all', amount: 247, validity: 30, planType: 'popular', plan: { name: '₹247 Plan', data: '1GB/day', calls: 'Unlimited', sms: '100/day', description: '1GB/day data + Unlimited calls + 100 SMS/day for 30 days' }, sortOrder: 3 },
  { operator: 'BSNL', circle: 'all', amount: 397, validity: 30, planType: 'data', plan: { name: '₹397 Plan', data: '2GB/day', calls: 'Unlimited', sms: '100/day', description: '2GB/day data + Unlimited calls + 100 SMS/day for 30 days' }, sortOrder: 4 },
  { operator: 'BSNL', circle: 'all', amount: 599, validity: 90, planType: 'combo', plan: { name: '₹599 Plan', data: '1GB/day', calls: 'Unlimited', sms: '100/day', description: '1GB/day data + Unlimited calls + 100 SMS/day for 90 days' }, sortOrder: 5 },
  { operator: 'BSNL', circle: 'all', amount: 1999, validity: 365, planType: 'annual', plan: { name: '₹1999 Annual Plan', data: '1.5GB/day', calls: 'Unlimited', sms: '100/day', description: '1.5GB/day data + Unlimited calls + 100 SMS/day for 365 days' }, sortOrder: 6 },
];

async function seed() {
  let created = 0;
  let skipped = 0;

  for (const planData of PLANS) {
    const existing = await RechargePlan.findOne({
      operator: { $regex: new RegExp(`^${planData.operator}$`, 'i') },
      amount: planData.amount,
      circle: planData.circle || 'all',
      planType: planData.planType,
    });

    if (existing) {
      skipped++;
      continue;
    }

    await RechargePlan.create(planData);
    created++;
  }

  console.log(`[RechargePlan Seeder] Done: ${created} created, ${skipped} skipped, ${PLANS.length} total`);
  return { created, skipped, total: PLANS.length };
}

module.exports = { seed, PLANS };