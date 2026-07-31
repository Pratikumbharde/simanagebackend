const { AppError } = require('./errors');

/**
 * Camera Not Found Error
 * Thrown when a camera resource is not found
 */
class CameraNotFoundError extends AppError {
  constructor(message = 'Camera not found') {
    super(message, 404, 'CAMERA_NOT_FOUND');
  }
}

/**
 * Agent Not Found Error
 * Thrown when an agent resource is not found
 */
class AgentNotFoundError extends AppError {
  constructor(message = 'Agent not found') {
    super(message, 404, 'AGENT_NOT_FOUND');
  }
}

/**
 * Activation Code Error
 * Thrown when activation code validation fails
 */
class ActivationCodeError extends AppError {
  constructor(message = 'Invalid activation code') {
    super(message, 400, 'ACTIVATION_CODE_ERROR');
  }
}

/**
 * Snapshot Upload Error
 * Thrown when a snapshot upload fails
 */
class SnapshotUploadError extends AppError {
  constructor(message = 'Snapshot upload failed') {
    super(message, 500, 'SNAPSHOT_UPLOAD_ERROR');
  }
}

/**
 * RTSP Connection Error
 * Thrown when an RTSP connection to a camera fails
 */
class RTSPConnectionError extends AppError {
  constructor(message = 'RTSP connection failed') {
    super(message, 502, 'RTSP_CONNECTION_ERROR');
  }
}

/**
 * Office Not Found Error
 * Thrown when an office resource is not found
 */
class OfficeNotFoundError extends AppError {
  constructor(message = 'Office not found') {
    super(message, 404, 'OFFICE_NOT_FOUND');
  }
}

/**
 * Camera Limit Exceeded Error
 * Thrown when a company exceeds its camera subscription limit
 */
class CameraLimitExceededError extends AppError {
  constructor(limit) {
    super(`Camera limit reached. Maximum ${limit} cameras allowed for your plan.`, 403, 'CAMERA_LIMIT_EXCEEDED');
  }
}

/**
 * Agent Already Active Error
 * Thrown when trying to activate an agent that is already active
 */
class AgentAlreadyActiveError extends AppError {
  constructor(message = 'Agent is already active') {
    super(message, 409, 'AGENT_ALREADY_ACTIVE');
  }
}

/**
 * Snapshot Not Found Error
 * Thrown when a snapshot resource is not found
 */
class SnapshotNotFoundError extends AppError {
  constructor(message = 'Snapshot not found') {
    super(message, 404, 'SNAPSHOT_NOT_FOUND');
  }
}

/**
 * Alert Not Found Error
 * Thrown when a camera alert is not found
 */
class AlertNotFoundError extends AppError {
  constructor(message = 'Alert not found') {
    super(message, 404, 'ALERT_NOT_FOUND');
  }
}

module.exports = {
  CameraNotFoundError,
  AgentNotFoundError,
  ActivationCodeError,
  SnapshotUploadError,
  RTSPConnectionError,
  OfficeNotFoundError,
  CameraLimitExceededError,
  AgentAlreadyActiveError,
  SnapshotNotFoundError,
  AlertNotFoundError,
};