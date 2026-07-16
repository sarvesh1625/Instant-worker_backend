const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const { authLimiter, otpLimiter, generalLimiter, reportLimiter } = require('./middleware/rateLimiter');

dotenv.config();
connectDB();

const app = express();
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(mongoSanitize());
app.use('/api', generalLimiter);

app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/send-otp', otpLimiter);
app.use('/api/auth/verify-otp', otpLimiter);
app.use('/api/auth/register-send-otp', otpLimiter);
app.use('/api/reports', reportLimiter);

app.use('/api/auth',          require('./routes/authRoutes'));
app.use('/api/workers',       require('./routes/workerRoutes'));
app.use('/api/jobs',          require('./routes/jobRoutes'));
app.use('/api/reviews',       require('./routes/reviewRoutes'));
app.use('/api/chat',          require('./routes/chatRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/portfolio',     require('./routes/portfolioRoutes'));
app.use('/api/verification',  require('./routes/verificationRoutes'));
app.use('/api/reports',       require('./routes/reportRoutes'));
app.use('/api/blocks',        require('./routes/blockRoutes'));
app.use('/api/admin',         require('./routes/adminRoutes'));
app.use('/api/profile',       require('./routes/profileRoutes'));
app.use('/api/tts',           require('./routes/ttsRoutes'));
app.use('/api/location',      require('./routes/locationRoutes'));
app.use('/api/wallet',        require('./routes/walletRoutes'));
app.use('/api/account',       require('./routes/accountRoutes'));
// ⚠️ MISSING — userRoutes.js exists but is never mounted. Add this line if
// /api/users/me and /api/users/upload-photo are meant to be reachable:
// app.use('/api/users', require('./routes/userRoutes'));

app.get('/', (req, res) => res.json({ message: 'Instant Worker API' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true },
});

const userSockets = {};

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;
  if (userId) {
    userSockets[userId] = socket.id;
    socket.join(`user_${userId}`);
  }

  socket.on('send_message', ({ senderId, receiverId, message }) => {
    io.to(`user_${receiverId}`).emit('receive_message', message);
  });

  socket.on('typing', ({ senderId, receiverId }) => {
    io.to(`user_${receiverId}`).emit('user_typing', { senderId });
  });
  socket.on('stop_typing', ({ senderId, receiverId }) => {
    io.to(`user_${receiverId}`).emit('user_stop_typing', { senderId });
  });

  socket.on('start_location_sharing', async ({ workerId, jobId, contractorId, lat, lng }) => {
    const room = `location_${jobId}_${workerId}`;
    socket.join(room);
    try {
      const Location = require('./models/Location');
      await Location.findOneAndUpdate(
        { worker: workerId },
        { worker: workerId, job: jobId, coordinates: { lat, lng }, isSharing: true, lastUpdated: Date.now() },
        { upsert: true, new: true }
      );
    } catch (e) { console.error('Location save error:', e.message); }
    io.to(`user_${contractorId}`).emit('worker_started_sharing', { workerId, jobId, lat, lng });
  });

  socket.on('location_update', async ({ workerId, jobId, contractorId, lat, lng }) => {
    const room = `location_${jobId}_${workerId}`;
    socket.to(room).emit('worker_location_updated', { workerId, jobId, lat, lng });
    io.to(`user_${contractorId}`).emit('worker_location_updated', { workerId, jobId, lat, lng });
    try {
      const Location = require('./models/Location');
      await Location.findOneAndUpdate({ worker: workerId }, { coordinates: { lat, lng }, lastUpdated: Date.now() }, { upsert: true });
    } catch (e) { console.error('Location update error:', e.message); }
  });

  socket.on('watch_worker', ({ contractorId, workerId, jobId }) => {
    socket.join(`location_${jobId}_${workerId}`);
  });

  socket.on('stop_location_sharing', async ({ workerId, jobId, contractorId }) => {
    const room = `location_${jobId}_${workerId}`;
    try {
      const Location = require('./models/Location');
      await Location.findOneAndUpdate({ worker: workerId }, { isSharing: false, job: null });
    } catch (e) { console.error('Location stop error:', e.message); }
    io.to(room).emit('worker_stopped_sharing', { workerId, jobId });
    io.to(`user_${contractorId}`).emit('worker_stopped_sharing', { workerId, jobId });
    socket.leave(room);
  });

  socket.on('disconnect', () => {
    if (userId) delete userSockets[userId];
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Instant Worker server running on http://localhost:${PORT}`));
