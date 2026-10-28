const Message = require('../models/Message');
const Job     = require('../models/Job');
const User    = require('../models/User');
const DirectChat = require('../models/DirectChat');
const Block   = require('../models/Block');
const { createNotification } = require('./notificationController');

const isBlocked = async (a, b) =>
  !!(await Block.findOne({ $or: [{ blocker: a, blocked: b }, { blocker: b, blocked: a }] }));

// Tell the other person about a new message — once per burst (not for every message while they have unread ones).
const notifyNewMessage = async (req, receiverId, messageId, conversationId) => {
  try {
    const earlierUnread = await Message.countDocuments({
      conversationId, sender: req.user._id, receiver: receiverId, read: false, _id: { $ne: messageId },
    });
    if (earlierUnread > 0) return;
    await createNotification({
      recipient: receiverId, type: 'new_message',
      title: 'New message', body: `${req.user.name} sent you a message`,
      link: `/chat/${req.user._id}`, meta: { actorName: req.user.name },
    });
  } catch {}
};

// Is this person connected right now (app open)? Then a message counts as delivered at once.
const isOnline = (io, userId) => {
  const room = io && io.sockets && io.sockets.adapter && io.sockets.adapter.rooms.get(`user_${userId}`);
  return !!room && room.size > 0;
};
// deliveredAt is optional: it is stored only if the Message model has that field.
const hasDeliveredField = () => !!(Message.schema && Message.schema.path('deliveredAt'));

// The reader opened the thread: mark their unread messages read (and delivered), and tell the sender live.
const markThreadRead = async (req, otherUserId, conversationId) => {
  const now = new Date();
  const r = await Message.updateMany({ conversationId, receiver: req.user._id, read: false }, { read: true });
  if (hasDeliveredField()) {
    await Message.updateMany({ conversationId, receiver: req.user._id, deliveredAt: null }, { deliveredAt: now });
  }
  const io = req.app.get('io');
  if (io && (r.modifiedCount || r.nModified || 0) > 0) {
    io.to(`user_${otherUserId}`).emit('messages_read', { by: String(req.user._id) });
  }
};

const canChat = async (userId1, userId2) => {
  const a = await Job.findOne({
    postedBy: userId1,
    applicants: { $elemMatch: { worker: userId2, chatUnlocked: true } },
  });
  if (a) return true;
  const b = await Job.findOne({
    postedBy: userId2,
    applicants: { $elemMatch: { worker: userId1, chatUnlocked: true } },
  });
  if (b) return true;
  // A chat the hirer started from the worker's profile (no job involved).
  const pair = Message.getConversationId(userId1, userId2);
  if (await DirectChat.findOne({ pair })) return !(await isBlocked(userId1, userId2));
  return false;
};

// POST /api/chat/direct/:userId — a hirer opens a chat with a worker straight from the worker's profile.
const startDirectChat = async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Only people hiring can start a chat with a worker.' });
    }
    const worker = await User.findOne({ _id: req.params.userId, role: 'worker', accountStatus: 'active' }).select('_id');
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });
    if (await isBlocked(req.user._id, worker._id)) {
      return res.status(403).json({ success: false, message: 'You cannot contact this worker.' });
    }
    const pair = Message.getConversationId(req.user._id, worker._id);
    await DirectChat.updateOne({ pair }, { $setOnInsert: { pair, hirer: req.user._id, worker: worker._id } }, { upsert: true });
    res.status(200).json({ success: true, allowed: true });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Could not start the chat.' });
  }
};

const checkAccess = async (req, res) => {
  try {
    const allowed = await canChat(req.user._id.toString(), req.params.userId);
    const other = await User.findById(req.params.userId).select('name phone profilePhoto role');
    res.status(200).json({ success: true, allowed, otherUser: other || null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;
    const messages = await Message.aggregate([
      { $match: { $or: [{ sender: userId }, { receiver: userId }] } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$conversationId', lastMessage: { $first: '$$ROOT' } } },
      { $sort: { 'lastMessage.createdAt': -1 } },
    ]);
    if (messages.length === 0) return res.status(200).json({ success: true, conversations: [] });

    const conversations = await Promise.all(
      messages.map(async (conv) => {
        const msg = conv.lastMessage;
        const sender   = await User.findById(msg.sender).select('name phone profilePhoto');
        const receiver = await User.findById(msg.receiver).select('name phone profilePhoto');
        if (!sender || !receiver) return null;
        const isSender = msg.sender.toString() === userId.toString();
        const other    = isSender ? receiver : sender;
        const unread = await Message.countDocuments({ conversationId: conv._id, receiver: userId, read: false });
        const preview = msg.type === 'voice' ? '🎤 Voice message' : msg.text;
        return {
          conversationId: conv._id,
          otherUser: { _id: other._id, name: other.name, phone: other.phone, profilePhoto: other.profilePhoto },
          lastMessage: preview, lastTime: msg.createdAt, unread,
        };
      })
    );
    res.status(200).json({ success: true, conversations: conversations.filter(Boolean) });
  } catch (error) {
    console.error('getConversations error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMessages = async (req, res) => {
  try {
    const allowed = await canChat(req.user._id.toString(), req.params.userId);
    if (!allowed) return res.status(403).json({ success: false, message: 'Chat not unlocked yet.' });

    const conversationId = Message.getConversationId(req.user._id, req.params.userId);
    const messages = await Message.find({ conversationId })
      .populate('sender', 'name phone profilePhoto')
      .populate('receiver', 'name phone profilePhoto')
      .sort({ createdAt: 1 });

    await markThreadRead(req, req.params.userId, conversationId);
    res.status(200).json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const sendMessage = async (req, res) => {
  try {
    const allowed = await canChat(req.user._id.toString(), req.params.userId);
    if (!allowed) return res.status(403).json({ success: false, message: 'Chat not unlocked.' });

    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ success: false, message: 'Message cannot be empty' });

    const conversationId = Message.getConversationId(req.user._id, req.params.userId);
    const message = await Message.create({ conversationId, sender: req.user._id, receiver: req.params.userId, type: 'text', text: text.trim() });
    await message.populate('sender', 'name phone profilePhoto');
    await message.populate('receiver', 'name phone profilePhoto');
    notifyNewMessage(req, req.params.userId, message._id, conversationId);

    // Push it to the other person from the server (does not depend on the sender's socket being connected).
    const io = req.app.get('io');
    const out = message.toObject();
    if (isOnline(io, req.params.userId)) {
      out.deliveredAt = new Date().toISOString();
      if (hasDeliveredField()) Message.updateOne({ _id: message._id }, { deliveredAt: out.deliveredAt }).catch(() => {});
    }
    if (io) io.to(`user_${req.params.userId}`).emit('receive_message', out);

    res.status(201).json({ success: true, message: out });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/chat/:userId/read — the chat screen is open and a new message just arrived: mark it read right away.
const markRead = async (req, res) => {
  try {
    const conversationId = Message.getConversationId(req.user._id, req.params.userId);
    await markThreadRead(req, req.params.userId, conversationId);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const sendVoiceMessage = async (req, res) => {
  try {
    const allowed = await canChat(req.user._id.toString(), req.params.userId);
    if (!allowed) return res.status(403).json({ success: false, message: 'Chat not unlocked.' });

    const cloudinary = require('cloudinary').v2;
    const result = await cloudinary.uploader.upload(req.file.path, {
      resource_type: 'video',
      folder: `instant-worker/voice/${req.user._id}`,
    });

    const conversationId = Message.getConversationId(req.user._id, req.params.userId);
    const message = await Message.create({
      conversationId, sender: req.user._id, receiver: req.params.userId,
      type: 'voice', voiceUrl: result.secure_url, voiceDuration: req.body.duration || 0,
    });
    await message.populate('sender', 'name phone profilePhoto');
    notifyNewMessage(req, req.params.userId, message._id, conversationId);

    const io = req.app.get('io');
    const out = message.toObject();
    if (isOnline(io, req.params.userId)) out.deliveredAt = new Date().toISOString();
    if (io) io.to(`user_${req.params.userId}`).emit('receive_message', out);

    res.status(201).json({ success: true, message: out });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getMessages, getConversations, sendMessage, sendVoiceMessage, checkAccess, canChat, startDirectChat, markRead };