const { body, param, query } = require('express-validator');

// ==================== Office Validations ====================

const createOfficeValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Office name is required')
    .isLength({ max: 100 })
    .withMessage('Office name cannot exceed 100 characters'),
  body('address.street')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Street cannot exceed 200 characters'),
  body('address.city')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('City cannot exceed 100 characters'),
  body('address.state')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('State cannot exceed 100 characters'),
  body('address.country')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Country cannot exceed 100 characters'),
  body('address.zipCode')
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage('Zip code cannot exceed 20 characters'),
  body('contactPerson')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Contact person cannot exceed 100 characters'),
  body('contactPhone')
    .optional()
    .trim()
    .matches(/^\+?\d{10,15}$/)
    .withMessage('Invalid phone number format (10-15 digits)'),
  body('timezone')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Timezone cannot exceed 50 characters'),
  body('companyId')
    .optional()
    .isMongoId()
    .withMessage('Invalid company ID'),
];

const updateOfficeValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid office ID'),
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Office name cannot be empty')
    .isLength({ max: 100 })
    .withMessage('Office name cannot exceed 100 characters'),
  body('address.street')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Street cannot exceed 200 characters'),
  body('address.city')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('City cannot exceed 100 characters'),
  body('address.state')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('State cannot exceed 100 characters'),
  body('address.country')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Country cannot exceed 100 characters'),
  body('address.zipCode')
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage('Zip code cannot exceed 20 characters'),
  body('contactPerson')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Contact person cannot exceed 100 characters'),
  body('contactPhone')
    .optional()
    .trim()
    .matches(/^\+?\d{10,15}$/)
    .withMessage('Invalid phone number format (10-15 digits)'),
  body('timezone')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Timezone cannot exceed 50 characters'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
];

// ==================== Camera Validations ====================

const createCameraValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Camera name is required')
    .isLength({ max: 100 })
    .withMessage('Camera name cannot exceed 100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  body('type')
    .optional()
    .isIn(['ip_camera', 'dvr_nvr'])
    .withMessage('Type must be ip_camera or dvr_nvr'),
  body('officeId')
    .optional()
    .isMongoId()
    .withMessage('Invalid office ID'),
  body('ipAddress')
    .trim()
    .notEmpty()
    .withMessage('IP address is required')
    .matches(/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/)
    .withMessage('Invalid IP address or hostname'),
  body('rtspPort')
    .optional()
    .isInt({ min: 1, max: 65535 })
    .withMessage('RTSP port must be between 1 and 65535'),
  body('rtspUrl')
    .trim()
    .notEmpty()
    .withMessage('RTSP URL is required')
    .matches(/^rtsp:\/\//i)
    .withMessage('RTSP URL must start with rtsp://'),
  body('username')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Username cannot exceed 100 characters'),
  body('password')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Password cannot exceed 100 characters'),
  body('captureInterval')
    .optional()
    .isInt({ min: 1, max: 1440 })
    .withMessage('Capture interval must be between 1 and 1440 minutes'),
  body('imageQuality')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Image quality must be between 1 and 100'),
  body('resolution')
    .optional()
    .isIn(['original', '1920x1080', '1280x720', '640x480'])
    .withMessage('Invalid resolution value'),
  body('companyId')
    .optional()
    .isMongoId()
    .withMessage('Invalid company ID'),
  body('assignedAgentId')
    .notEmpty()
    .withMessage('Agent assignment is required')
    .isMongoId()
    .withMessage('Invalid agent ID'),
];

const updateCameraValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid camera ID'),
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Camera name cannot be empty')
    .isLength({ max: 100 })
    .withMessage('Camera name cannot exceed 100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  body('type')
    .optional()
    .isIn(['ip_camera', 'dvr_nvr'])
    .withMessage('Type must be ip_camera or dvr_nvr'),
  body('officeId')
    .optional()
    .isMongoId()
    .withMessage('Invalid office ID'),
  body('ipAddress')
    .optional()
    .trim()
    .matches(/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/)
    .withMessage('Invalid IP address or hostname'),
  body('rtspPort')
    .optional()
    .isInt({ min: 1, max: 65535 })
    .withMessage('RTSP port must be between 1 and 65535'),
  body('rtspUrl')
    .optional()
    .trim()
    .matches(/^rtsp:\/\//i)
    .withMessage('RTSP URL must start with rtsp://'),
  body('username')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Username cannot exceed 100 characters'),
  body('password')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Password cannot exceed 100 characters'),
  body('captureInterval')
    .optional()
    .isInt({ min: 1, max: 1440 })
    .withMessage('Capture interval must be between 1 and 1440 minutes'),
  body('imageQuality')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Image quality must be between 1 and 100'),
  body('resolution')
    .optional()
    .isIn(['original', '1920x1080', '1280x720', '640x480'])
    .withMessage('Invalid resolution value'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  body('assignedAgentId')
    .optional({ nullable: true })
    .isMongoId()
    .withMessage('Invalid agent ID'),
];

// ==================== Agent Validations ====================

const generateActivationCodeValidation = [
  body('officeId')
    .optional()
    .isMongoId()
    .withMessage('Invalid office ID'),
  body('expiresInHours')
    .optional()
    .isInt({ min: 1, max: 168 })
    .withMessage('Expiry must be between 1 and 168 hours (7 days)'),
  body('maxUses')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Max uses must be between 1 and 10'),
];

const activateAgentValidation = [
  body('activationCode')
    .trim()
    .notEmpty()
    .withMessage('Activation code is required')
    .matches(/^AGT-[A-Z0-9]{6}-[A-Z0-9]{6}$/)
    .withMessage('Invalid activation code format'),
  body('machineId')
    .trim()
    .notEmpty()
    .withMessage('Machine ID is required')
    .isLength({ min: 8, max: 100 })
    .withMessage('Machine ID must be between 8 and 100 characters'),
  body('hostname')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Hostname cannot exceed 200 characters'),
  body('osVersion')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('OS version cannot exceed 100 characters'),
  body('agentVersion')
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage('Agent version cannot exceed 20 characters'),
];

const heartbeatValidation = [
  body('status')
    .optional()
    .isIn(['active', 'inactive'])
    .withMessage('Status must be active or inactive'),
  body('cameraCount')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Camera count must be a non-negative integer'),
  body('queueSize')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Queue size must be a non-negative integer'),
  body('agentVersion')
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage('Agent version cannot exceed 20 characters'),
];

const cameraStatusUpdateValidation = [
  body('cameras')
    .isArray({ min: 1, max: 100 })
    .withMessage('Cameras must be a non-empty array (max 100 items)'),
  body('cameras.*.cameraId')
    .isMongoId()
    .withMessage('Invalid camera ID'),
  body('cameras.*.status')
    .isIn(['online', 'offline', 'error'])
    .withMessage('Camera status must be online, offline, or error'),
  body('cameras.*.lastError')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Error message cannot exceed 500 characters'),
];

// ==================== Snapshot Validations ====================

const uploadSnapshotValidation = [
  body('cameraId')
    .isMongoId()
    .withMessage('Invalid camera ID'),
  body('capturedAt')
    .optional()
    .isISO8601()
    .withMessage('Invalid capturedAt date format'),
  body('fileSize')
    .optional()
    .isInt({ min: 0 })
    .withMessage('File size must be a non-negative integer'),
  body('width')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Width must be a non-negative integer'),
  body('height')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Height must be a non-negative integer'),
  body('format')
    .optional()
    .isIn(['jpg', 'jpeg', 'png', 'webp'])
    .withMessage('Format must be jpg, jpeg, png, or webp'),
];

const snapshotQueryValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid startDate format'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid endDate format'),
  query('status')
    .optional()
    .isIn(['uploaded', 'processing', 'failed'])
    .withMessage('Invalid status value'),
];

// ==================== Alert Validations ====================

const alertQueryValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('status')
    .optional()
    .isIn(['active', 'acknowledged', 'resolved'])
    .withMessage('Invalid status value'),
  query('alertType')
    .optional()
    .isIn(['camera_offline', 'camera_error', 'snapshot_failed', 'agent_offline', 'agent_error'])
    .withMessage('Invalid alert type'),
  query('cameraId')
    .optional()
    .isMongoId()
    .withMessage('Invalid camera ID'),
];

const acknowledgeAlertValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid alert ID'),
];

const resolveAlertValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid alert ID'),
  body('resolutionNote')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Resolution note cannot exceed 500 characters'),
];

// ==================== Dashboard Validations ====================

const dashboardQueryValidation = [
  query('range')
    .optional()
    .isIn(['today', 'week', 'month', 'custom'])
    .withMessage('Range must be today, week, month, or custom'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid startDate format'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid endDate format'),
];

module.exports = {
  // Office
  createOfficeValidation,
  updateOfficeValidation,
  // Camera
  createCameraValidation,
  updateCameraValidation,
  // Agent
  generateActivationCodeValidation,
  activateAgentValidation,
  heartbeatValidation,
  cameraStatusUpdateValidation,
  // Snapshot
  uploadSnapshotValidation,
  snapshotQueryValidation,
  // Alert
  alertQueryValidation,
  acknowledgeAlertValidation,
  resolveAlertValidation,
  // Dashboard
  dashboardQueryValidation,
};