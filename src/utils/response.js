// [PHONE NORMALIZATION FIX] - Helper function for phone number normalization
/**
 * Normalize phone number to international format (+91XXXXXXXXXX)
 * @param {string} number - Phone number input (10 digits or with country code)
 * @returns {object} - { normalized: string, original: string, valid: boolean }
 */
const normalizePhoneNumber = (number) => {
  if (!number) {
    return { normalized: null, original: null, valid: false };
  }

  // Store original input
  const original = number;

  // Remove spaces, dashes, parentheses
  let cleaned = number.replace(/[\s\-\(\)]/g, '');

  // Default country code for India
  const DEFAULT_COUNTRY_CODE = '+91';

  // Check if already has country code (starts with +)
  if (cleaned.startsWith('+')) {
    // Already in international format - validate length
    // +91XXXXXXXXXX = 13 characters
    if (cleaned.length >= 12 && cleaned.length <= 15) {
      return { normalized: cleaned, original, valid: true };
    }
    return { normalized: null, original, valid: false };
  }

  // Check if it's a 10-digit number without country code
  if (/^\d{10}$/.test(cleaned)) {
    return {
      normalized: `${DEFAULT_COUNTRY_CODE}${cleaned}`,
      original,
      valid: true
    };
  }

  // Check if it has country code without + (e.g., 919876543210)
  if (/^91\d{10}$/.test(cleaned)) {
    return {
      normalized: `+${cleaned}`,
      original,
      valid: true
    };
  }

  // Invalid format
  return { normalized: null, original, valid: false };
};

/**
 * Build query for finding user/SIM by phone number (handles both formats)
 * [PHONE NORMALIZATION FIX] - Comprehensive query to match all possible formats
 * @param {string} number - Phone number to search
 * @returns {object} - MongoDB query object
 */
const buildPhoneQuery = (number) => {
  const { normalized } = normalizePhoneNumber(number);

  if (!normalized) {
    return null;
  }

  // Get the last 10 digits (actual phone number without country code)
  const last10Digits = normalized.slice(-10);
  const countryCodeWithoutPlus = normalized.replace('+', ''); // e.g., "919876543210"

  // [PHONE NORMALIZATION FIX] - Build comprehensive query to match ALL possible formats
  // Use Set to avoid duplicate conditions
  const possibleNumbers = [...new Set([
    normalized,              // +91XXXXXXXXXX (normalized format)
    last10Digits,            // XXXXXXXXXX (10 digits only)
    `+91${last10Digits}`,    // +91 + 10 digits (explicit +91)
    countryCodeWithoutPlus   // 91XXXXXXXXXX (without +)
  ])];

  return {
    $or: possibleNumbers.map(num => ({ mobileNumber: num }))
  };
};

const successResponse = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
};

const errorResponse = (res, message = 'Error', statusCode = 500, errors = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    errors,
    timestamp: new Date().toISOString(),
  });
};

const paginatedResponse = (res, data, total, page, limit, message = 'Success') => {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    },
    timestamp: new Date().toISOString(),
  });
};

const reportResponse = (res, data, summary, total, page, limit, message = 'Report generated successfully') => {
  return res.status(200).json({
    success: true,
    message,
    data,
    summary,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    },
    timestamp: new Date().toISOString(),
  });
};

module.exports = {
  successResponse,
  errorResponse,
  paginatedResponse,
  reportResponse,
  // [PHONE NORMALIZATION FIX]
  normalizePhoneNumber,
  buildPhoneQuery,
};