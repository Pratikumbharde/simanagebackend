const jwt = require('jsonwebtoken');
const User = require('../models/auth/user.model');
const { AppError, UnauthorizedError } = require('../utils/errors');
const config = require('../config');

const authenticate = async (req, res, next) => {
  try {
    let token;

    // Check Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new UnauthorizedError('No token provided. Please log in.');
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new UnauthorizedError('Token expired. Please log in again.');
      }
      throw new UnauthorizedError('Invalid token. Please log in again.');
    }

    // Check if user still exists
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      throw new UnauthorizedError('User no longer exists.');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedError('User account is deactivated.');
    }

    // Check if user's company is active (skip for super_admin who has no company)
    if (user.role !== 'super_admin' && user.companyId) {
      const Company = require('../models/company/company.model');
      const company = await Company.findById(user.companyId).select('isActive');
      if (!company || !company.isActive) {
        throw new UnauthorizedError('Company account has been deactivated. Please contact your administrator.');
      }
    }

    // Add user to request
    req.user = user;
    req.tokenId = decoded.tokenId;
    next();
  } catch (error) {
    next(error);
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to perform this action',
      });
    }
    next();
  };
};

const checkCompanyAccess = async (req, res, next) => {
  try {
    // Check multiple sources for companyId: params, query, body
    const requestedCompanyId = req.params.companyId || req.query.companyId || req.body.companyId;

    if (req.user.role === 'super_admin') {
      // super_admin can access any company; set companyId from request if provided
      if (requestedCompanyId) {
        req.companyId = requestedCompanyId;
      }
      return next();
    }

    // For admin/users, always set req.companyId to their own company
    if (!requestedCompanyId) {
      req.companyId = req.user.companyId;
      return next();
    }

    // Validate that requested company matches user's company
    if (requestedCompanyId.toString() !== req.user.companyId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only access your own company data.',
      });
    }

    req.companyId = req.user.companyId;
    next();
  } catch (error) {
    next(error);
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      return authenticate(req, res, next);
    }
    req.user = null;
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

module.exports = {
  authenticate,
  authorize,
  checkCompanyAccess,
  optionalAuth,
};