const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');

let io = null;

/**
 * Initialize Socket.IO server
 * @param {Object} server - HTTP server instance
 * @returns {Object} Socket.IO instance
 */
const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: function (origin, callback) {
        const allowedOrigins = [
          'https://simtrackr.b100x.in',
          'https://sim-management-rho.vercel.app',
          'http://localhost:3001',
          'http://localhost:3000',
          'http://localhost:5000',
          'http://localhost:8081',
          process.env.FRONTEND_URL,
        ].filter(Boolean);

        // Allow all origins in development
        if (process.env.NODE_ENV === 'development') {
          return callback(null, true);
        }

        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'), false);
        }
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, config.jwt.secret);

      // Check if this is an agent token (agent tokens have type: 'agent')
      if (decoded.type === 'agent') {
        // Agent connection — minimal user info for room joining
        socket.user = {
          id: decoded.id,
          role: 'agent',
          companyId: decoded.companyId?.toString(),
          name: decoded.name || 'Agent',
        };
        return next();
      }

      // Regular user connection
      const User = require('../models/auth/user.model');
      const user = await User.findById(decoded.id).select('-password');

      if (!user || !user.isActive) {
        return next(new Error('Invalid or inactive user'));
      }

      // Attach user info to socket
      socket.user = {
        id: user._id,
        role: user.role,
        companyId: user.companyId?.toString(),
        name: user.name,
        email: user.email,
      };

      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return next(new Error('Token expired'));
      }
      next(new Error('Authentication failed'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] User connected: ${socket.user?.name || socket.user?.id || 'unknown'}`);

    // Join company room for company-wide events
    if (socket.user?.companyId) {
      socket.join(`company_${socket.user.companyId}`);
      console.log(`[Socket.IO] User ${socket.user.id} joined company_${socket.user.companyId}`);
    }

    // Join user-specific room for personal notifications
    if (socket.user?.id) {
      socket.join(`user_${socket.user.id}`);
    }

    // Handle joining specific camera rooms for detailed monitoring
    // Verify camera belongs to user's company before allowing join
    socket.on('join:camera', async (cameraId) => {
      try {
        const Camera = require('../models/cctv/camera.model');
        const camera = await Camera.findOne({ _id: cameraId, isActive: true }).select('companyId').lean();
        if (!camera) {
          socket.emit('error', { message: 'Camera not found' });
          return;
        }
        // Verify company access (super_admin without companyId can join any)
        if (socket.user?.companyId && camera.companyId.toString() !== socket.user.companyId) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }
        socket.join(`camera_${cameraId}`);
      } catch (err) {
        socket.emit('error', { message: 'Failed to join camera room' });
      }
    });

    // Handle leaving camera rooms
    socket.on('leave:camera', (cameraId) => {
      socket.leave(`camera_${cameraId}`);
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO] User disconnected: ${socket.user?.name || socket.user?.id || 'unknown'} (${reason})`);
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`[Socket.IO] Socket error for user ${socket.user?.id}:`, error.message);
    });
  });

  console.log('[Socket.IO] Server initialized');
  return io;
};

/**
 * Get the Socket.IO instance
 * @returns {Object|null} Socket.IO instance or null if not initialized
 */
const getIO = () => {
  if (!io) {
    console.warn('[Socket.IO] Warning: getIO() called before initialization');
    return null;
  }
  return io;
};

/**
 * Emit an event to a company room
 * @param {string} companyId - Company ID
 * @param {string} event - Event name
 * @param {Object} data - Event data
 */
const emitToCompany = (companyId, event, data) => {
  if (!io) return;
  io.to(`company_${companyId}`).emit(event, data);
};

/**
 * Emit an event to a specific user
 * @param {string} userId - User ID
 * @param {string} event - Event name
 * @param {Object} data - Event data
 */
const emitToUser = (userId, event, data) => {
  if (!io) return;
  io.to(`user_${userId}`).emit(event, data);
};

/**
 * Emit an event to a camera room
 * @param {string} cameraId - Camera ID
 * @param {string} event - Event name
 * @param {Object} data - Event data
 */
const emitToCamera = (cameraId, event, data) => {
  if (!io) return;
  io.to(`camera_${cameraId}`).emit(event, data);
};

module.exports = {
  initializeSocket,
  getIO,
  emitToCompany,
  emitToUser,
  emitToCamera,
};