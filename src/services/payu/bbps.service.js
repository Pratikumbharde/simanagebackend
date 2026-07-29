/**
 * PayU BBPS (Bharat Bill Payment System) Service
 *
 * Integrates with PayU's BBPS APIs for mobile recharge:
 * - OAuth token management with caching
 * - Get operator and circle from mobile number
 * - Fetch prepaid recharge plans by operator/circle
 * - Fetch custom/personalized plans for a mobile number
 * - List all operators and circles
 *
 * Also falls back to local RechargePlan model when BBPS is unavailable.
 *
 * API Reference: https://docs.payu.in/reference/bbps-prepaid-apis
 */

const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');
const RechargePlan = require('../../models/rechargePlan/rechargePlan.model');

// Token cache — avoids requesting a new token on every call
let tokenCache = {
  token: null,
  expiresAt: 0, // Unix timestamp in ms
};

class BBPSService {
  /**
   * Get the BBPS base URL based on environment
   */
  getBaseUrl() {
    return config.payu.bbps?.isProduction
      ? 'https://bbps.payu.in'
      : 'https://bbps-sb.payu.in';
  }

  /**
   * Get OAuth access token for BBPS APIs
   * Caches the token and reuses it until it's about to expire.
   *
   * @param {string} scope - OAuth scope (e.g. 'read_plans', 'read_operator_circle')
   * @returns {Promise<string>} Bearer access token
   */
  async getAccessToken(scope = 'read_plans') {
    // Return cached token if still valid (with 60s safety margin)
    if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) {
      return tokenCache.token;
    }

    const bbpsConfig = config.payu.bbps;
    if (!bbpsConfig || !bbpsConfig.clientId || !bbpsConfig.clientSecret) {
      throw new Error('PayU BBPS credentials not configured. Set PAYU_BBP_S_CLIENT_ID and PAYU_BBP_S_CLIENT_SECRET in .env');
    }

    const tokenUrl = bbpsConfig.isProduction
      ? 'https://accounts.payu.in/oauth/token'
      : 'https://uat-accounts.payu.in/oauth/token';

    try {
      const response = await axios.post(
        tokenUrl,
        new URLSearchParams({
          client_id: bbpsConfig.clientId,
          client_secret: bbpsConfig.clientSecret,
          scope: scope,
          grant_type: 'password',
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30000,
        }
      );

      const { access_token, expires_in } = response.data;
      if (!access_token) {
        throw new Error('No access_token in BBPS token response');
      }

      // Cache the token
      tokenCache = {
        token: access_token,
        expiresAt: Date.now() + (expires_in || 7200) * 1000,
      };

      logger.info('[BBPS] Access token obtained', { scope, expiresIn: expires_in });
      return access_token;
    } catch (error) {
      logger.error('[BBPS] Failed to get access token', {
        scope,
        error: error.response?.data || error.message,
      });
      throw new Error(`Failed to get BBPS access token: ${error.message}`);
    }
  }

  /**
   * Make an authenticated GET request to BBPS API
   */
  async bbpsGet(endpoint, params = {}, scope = 'read_plans') {
    const token = await this.getAccessToken(scope);
    const url = `${this.getBaseUrl()}${endpoint}`;

    const response = await axios.get(url, {
      params,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 30000,
    });

    return response.data;
  }

  /**
   * Make an authenticated POST request to BBPS API
   */
  async bbpsPost(endpoint, body = {}, scope = 'read_plans') {
    const token = await this.getAccessToken(scope);
    const url = `${this.getBaseUrl()}${endpoint}`;

    const response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 30000,
    });

    return response.data;
  }

  // ============================================================
  // OPERATOR & CIRCLE DETECTION
  // ============================================================

  /**
   * Get operator and circle info from a mobile number
   * BBPS API: GET /payu-nbc/v2/nbc/getOperatorAndCircleInfo
   *
   * @param {string} mobileNumber - 10-digit mobile number
   * @param {string} agentId - BBPS agent ID (defaults to config)
   * @returns {Promise<{operatorName, operatorId, circleName, circleId, plansInfo: []}>}
   */
  async getOperatorAndCircle(mobileNumber, agentId) {
    const bbpsConfig = config.payu.bbps;
    agentId = agentId || bbpsConfig?.agentId || '1';

    try {
      const result = await this.bbpsGet(
        '/payu-nbc/v2/nbc/getOperatorAndCircleInfo',
        {
          agentId,
          mobileNumber,
        },
        'read_operator_circle'
      );

      if (result.status === 'SUCCESS' && result.payload) {
        logger.info('[BBPS] Operator/circle detected', {
          mobileNumber,
          operator: result.payload.operatorName,
        });
        return {
          success: true,
          operatorName: result.payload.operatorName,
          operatorId: result.payload.operatorId,
          circleName: result.payload.circleName || result.payload.circlesInfo?.[0]?.circleName,
          circleId: result.payload.circleId || result.payload.circlesInfo?.[0]?.circleRefID,
          plansInfo: result.payload.plansInfo || [],
        };
      }

      logger.warn('[BBPS] Operator/circle detection failed', {
        mobileNumber,
        code: result.code,
        message: result.payload?.message,
      });
      return { success: false, error: result.payload?.message || 'Unknown error' };
    } catch (error) {
      logger.error('[BBPS] getOperatorAndCircle error', {
        mobileNumber,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // RECHARGE PLANS
  // ============================================================

  /**
   * Get prepaid recharge plans for an operator and circle
   * BBPS API: GET /payu-nbc/v2/nbc/getRechargePlans
   *
   * @param {string} operatorId - Operator ID from getOperatorAndCircle or getOperators
   * @param {string|number} circleId - Circle ID from getOperatorAndCircle or getCircles
   * @param {string} agentId - BBPS agent ID
   * @returns {Promise<{success, plans: [], operatorName?, operatorId?}>}
   */
  async getRechargePlans(operatorId, circleId, agentId) {
    const bbpsConfig = config.payu.bbps;
    agentId = agentId || bbpsConfig?.agentId || '1';

    try {
      const result = await this.bbpsGet(
        '/payu-nbc/v2/nbc/getRechargePlans',
        {
          agentId,
          operatorId,
          circleId,
        },
        'read_plans'
      );

      if (result.status === 'SUCCESS' && result.payload) {
        // Payload can be an array of operators or a single operator object
        const payload = Array.isArray(result.payload) ? result.payload : [result.payload];
        const plans = [];

        for (const operator of payload) {
          if (operator.circleWisePlanLists) {
            for (const circle of operator.circleWisePlanLists) {
              if (circle.plansInfo) {
                for (const plan of circle.plansInfo) {
                  plans.push({
                    planName: plan.planName || '',
                    amount: parseFloat(plan.price) || 0,
                    validity: this.parseValidity(plan.validity),
                    validityDescription: plan.validityDescription || '',
                    talkTime: plan.talkTime || '',
                    data: this.extractDataFromDescription(plan.packageDescription || plan.validityDescription || ''),
                    calls: this.extractCallsFromDescription(plan.packageDescription || plan.validityDescription || ''),
                    sms: this.extractSmsFromDescription(plan.packageDescription || plan.validityDescription || ''),
                    description: plan.packageDescription || plan.validityDescription || '',
                    planType: this.normalizePlanType(plan.planType),
                    operatorName: operator.operatorName,
                    operatorId: operator.operatorId,
                    circleName: circle.circleName,
                    circleId: circle.circleId,
                  });
                }
              }
            }
          } else if (operator.plansInfo) {
            for (const plan of operator.plansInfo) {
              plans.push({
                planName: plan.planName || '',
                amount: parseFloat(plan.price) || 0,
                validity: this.parseValidity(plan.validity),
                validityDescription: plan.validityDescription || '',
                talkTime: plan.talkTime || '',
                data: this.extractDataFromDescription(plan.packageDescription || plan.validityDescription || ''),
                calls: this.extractCallsFromDescription(plan.packageDescription || plan.validityDescription || ''),
                sms: this.extractSmsFromDescription(plan.packageDescription || plan.validityDescription || ''),
                description: plan.packageDescription || plan.validityDescription || '',
                planType: this.normalizePlanType(plan.planType),
                operatorName: operator.operatorName,
                operatorId: operator.operatorId,
              });
            }
          }
        }

        logger.info('[BBPS] Plans fetched', { operatorId, circleId, count: plans.length });
        return { success: true, plans, operatorName: payload[0]?.operatorName, operatorId: payload[0]?.operatorId };
      }

      logger.warn('[BBPS] Plans fetch failed', { operatorId, circleId, code: result.code });
      return { success: false, error: result.payload?.message || 'Failed to fetch plans', plans: [] };
    } catch (error) {
      logger.error('[BBPS] getRechargePlans error', { operatorId, circleId, error: error.message });
      return { success: false, error: error.message, plans: [] };
    }
  }

  /**
   * Get custom/personalized recharge plans for a mobile number
   * BBPS API: GET /payu-nbc/v2/nbc/getCustomizedRechargePlans
   *
   * @param {string} mobileNumber - 10-digit mobile number
   * @param {string} operatorId - Operator ID
   * @param {string|number} circleId - Circle ID
   * @param {string} agentId - BBPS agent ID
   * @returns {Promise<{success, plans: []}>}
   */
  async getCustomPlans(mobileNumber, operatorId, circleId, agentId) {
    const bbpsConfig = config.payu.bbps;
    agentId = agentId || bbpsConfig?.agentId || '1';

    try {
      const result = await this.bbpsGet(
        '/payu-nbc/v2/nbc/getCustomizedRechargePlans',
        {
          agentId,
          mobileNo: mobileNumber,
          operatorId,
          circleId,
        },
        'read_plans'
      );

      if (result.status === 'SUCCESS' && result.payload) {
        const payload = result.payload;
        const plans = (payload.plansInfo || []).map(plan => ({
          planName: plan.planName || '',
          amount: parseFloat(plan.price) || 0,
          validity: this.parseValidity(plan.validity),
          validityDescription: plan.validityDescription || '',
          talkTime: plan.talkTime || '',
          data: this.extractDataFromDescription(plan.packageDescription || plan.validityDescription || ''),
          calls: this.extractCallsFromDescription(plan.packageDescription || plan.validityDescription || ''),
          sms: this.extractSmsFromDescription(plan.packageDescription || plan.validityDescription || ''),
          description: plan.packageDescription || plan.validityDescription || '',
          planType: this.normalizePlanType(plan.planType),
          operatorName: payload.operatorName,
          operatorId: payload.operatorId,
        }));

        logger.info('[BBPS] Custom plans fetched', { mobileNumber, count: plans.length });
        return { success: true, plans, operatorName: payload.operatorName, operatorId: payload.operatorId };
      }

      logger.warn('[BBPS] Custom plans fetch failed', { mobileNumber, code: result.code });
      return { success: false, error: result.payload?.message || 'Failed to fetch custom plans', plans: [] };
    } catch (error) {
      logger.error('[BBPS] getCustomPlans error', { mobileNumber, error: error.message });
      return { success: false, error: error.message, plans: [] };
    }
  }

  // ============================================================
  // OPERATOR & CIRCLE LISTS
  // ============================================================

  /**
   * Get list of all available operators
   * BBPS API: GET /payu-nbc/v2/nbc/getOperatorList
   */
  async getOperators(agentId) {
    const bbpsConfig = config.payu.bbps;
    agentId = agentId || bbpsConfig?.agentId || '1';

    try {
      const result = await this.bbpsGet(
        '/payu-nbc/v2/nbc/getOperatorList',
        { agentId },
        'read_operators'
      );

      if (result.status === 'SUCCESS' && result.payload) {
        return {
          success: true,
          operators: (result.payload.operatorsInfo || []).map(op => ({
            operatorCode: op.operatorCode,
            operatorName: op.operatorName,
            fixedBill: op.fixedBill,
          })),
        };
      }

      return { success: false, error: result.payload?.message || 'Failed to fetch operators', operators: [] };
    } catch (error) {
      logger.error('[BBPS] getOperators error', { error: error.message });
      return { success: false, error: error.message, operators: [] };
    }
  }

  /**
   * Get list of all available circles
   * BBPS API: GET /payu-nbc/v2/nbc/getCircleList
   */
  async getCircles(agentId) {
    const bbpsConfig = config.payu.bbps;
    agentId = agentId || bbpsConfig?.agentId || '1';

    try {
      const result = await this.bbpsGet(
        '/payu-nbc/v2/nbc/getCircleList',
        { agentId },
        'read_circles'
      );

      if (result.status === 'SUCCESS' && result.payload) {
        return {
          success: true,
          circles: (result.payload.circlesInfo || []).map(c => ({
            circleId: c.circleRefID,
            circleName: c.circleName,
          })),
        };
      }

      return { success: false, error: result.payload?.message || 'Failed to fetch circles', circles: [] };
    } catch (error) {
      logger.error('[BBPS] getCircles error', { error: error.message });
      return { success: false, error: error.message, circles: [] };
    }
  }

  // ============================================================
  // COMBINED: FETCH PLANS FOR A SIM (BBPS + LOCAL FALLBACK)
  // ============================================================

  /**
   * Fetch available recharge plans for a given SIM.
   * Strategy:
   * 1. Try PayU BBPS API — detect operator/circle from SIM's mobile number,
   *    then fetch plans by operator + circle.
   * 2. If BBPS fails, fall back to local RechargePlan collection.
   *
   * @param {Object} sim - Mongoose Sim document (must have mobileNumber, operator, circle)
   * @returns {Promise<{success, source, operatorInfo, plans: []}>}
   */
  async getPlansForSim(sim) {
    const bbpsConfig = config.payu.bbps;
    const hasBbpsConfig = bbpsConfig?.clientId && bbpsConfig?.clientSecret;

    // Try BBPS if configured
    if (hasBbpsConfig) {
      try {
        // Step 1: Detect operator/circle from mobile number
        const operatorInfo = await this.getOperatorAndCircle(sim.mobileNumber);

        if (operatorInfo.success && operatorInfo.operatorId) {
          // Step 2: Fetch plans by operator and circle
          const plansResult = await this.getRechargePlans(
            operatorInfo.operatorId,
            operatorInfo.circleId || '1',
            bbpsConfig.agentId
          );

          if (plansResult.success && plansResult.plans.length > 0) {
            return {
              success: true,
              source: 'bbps',
              operatorInfo: {
                operatorName: operatorInfo.operatorName,
                operatorId: operatorInfo.operatorId,
                circleName: operatorInfo.circleName,
                circleId: operatorInfo.circleId,
              },
              plans: plansResult.plans,
            };
          }

          // Try custom plans as fallback
          const customResult = await this.getCustomPlans(
            sim.mobileNumber,
            operatorInfo.operatorId,
            operatorInfo.circleId || '1',
            bbpsConfig.agentId
          );

          if (customResult.success && customResult.plans.length > 0) {
            return {
              success: true,
              source: 'bbps',
              operatorInfo: {
                operatorName: operatorInfo.operatorName,
                operatorId: operatorInfo.operatorId,
                circleName: operatorInfo.circleName,
                circleId: operatorInfo.circleId,
              },
              plans: customResult.plans,
            };
          }
        }
      } catch (error) {
        logger.warn('[BBPS] Failed to fetch plans, falling back to local', {
          error: error.message,
        });
      }
    }

    // Fallback: local RechargePlan collection
    try {
      const operator = sim.operator || 'Other';
      const circle = sim.circle || 'all';
      const localPlans = await RechargePlan.findByOperatorAndCircle(operator, circle);

      if (localPlans.length > 0) {
        return {
          success: true,
          source: 'local',
          operatorInfo: {
            operatorName: operator,
            circleName: circle,
          },
          plans: localPlans.map(p => ({
            planName: p.plan.name,
            amount: p.amount,
            validity: p.validity,
            validityDescription: `${p.validity} days`,
            talkTime: '',
            data: p.plan.data || '',
            calls: p.plan.calls || '',
            sms: p.plan.sms || '',
            description: p.plan.description || '',
            planType: p.planType,
            _id: p._id, // local plan ID for reference
          })),
        };
      }
    } catch (error) {
      logger.error('[BBPS] Local plan fallback also failed', { error: error.message });
    }

    // No plans available from any source
    return {
      success: false,
      source: 'none',
      operatorInfo: {
        operatorName: sim.operator || 'Unknown',
        circleName: sim.circle || '',
      },
      plans: [],
      error: 'No recharge plans available for this operator',
    };
  }

  // ============================================================
  // UTILITY: PARSE HELPERS
  // ============================================================

  /**
   * Parse validity string to number of days
   * Examples: "28", "28 Days", "56 days", "1 Year", "365 Days"
   */
  parseValidity(validity) {
    if (!validity) return 0;
    if (typeof validity === 'number') return validity;

    const str = String(validity).toLowerCase().trim();

    // "1 Year" / "2 Years"
    const yearMatch = str.match(/(\d+)\s*year/);
    if (yearMatch) return parseInt(yearMatch[1]) * 365;

    // "28 Days" / "56 days" / "28"
    const dayMatch = str.match(/(\d+)/);
    return dayMatch ? parseInt(dayMatch[1]) : 0;
  }

  /**
   * Normalize PayU plan type to our internal enum
   */
  normalizePlanType(planType) {
    if (!planType) return 'other';
    const type = String(planType).toLowerCase().trim();

    const typeMap = {
      'popular': 'popular',
      'topup': 'talktime',
      'top_up': 'talktime',
      'talktime': 'talktime',
      'full talktime': 'talktime',
      'data': 'data',
      '2g': 'data',
      '3g': 'data',
      '4g': 'data',
      '5g': 'data',
      'unlimited': 'unlimited',
      'combo': 'combo',
      'rate_cutter': 'other',
      'sms': 'other',
      'roaming': 'other',
      'annual': 'annual',
      'validity': 'other',
    };

    return typeMap[type] || 'other';
  }

  /**
   * Extract data info from plan description
   * Examples: "1.5GB/Day Data + Unlimited Calls" → "1.5GB/day"
   */
  extractDataFromDescription(desc) {
    if (!desc) return '';
    // Match patterns like "1.5GB/Day", "2GB/day", "100GB", "1.5 GB/Day"
    const match = desc.match(/(\d+\.?\d*)\s*GB\s*(\/\s*(?:Day|day|daily))?/i);
    if (match) {
      return match[2] ? `${match[1]}GB/day` : `${match[1]}GB`;
    }
    return '';
  }

  /**
   * Extract calls info from plan description
   */
  extractCallsFromDescription(desc) {
    if (!desc) return '';
    if (/unlimited\s*call/i.test(desc)) return 'Unlimited';
    const match = desc.match(/(\d+)\s*min/i);
    return match ? `${match[1]} min` : '';
  }

  /**
   * Extract SMS info from plan description
   */
  extractSmsFromDescription(desc) {
    if (!desc) return '';
    if (/unlimited\s*sms/i.test(desc)) return 'Unlimited';
    const match = desc.match(/(\d+)\s*sms/i);
    return match ? `${match[1]}/day` : '';
  }
}

module.exports = new BBPSService();