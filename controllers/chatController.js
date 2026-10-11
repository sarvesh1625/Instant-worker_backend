const Message = require('../models/Message');
const Job     = require('../models/Job');
const User    = require('../models/User');
const { pushToUser } = require('../services/pushService');

const canChat = async (userId1, userId2) => {
  const a = await Job.findOne({
    postedBy: userId1,
    applicants: { $elemMatch: { worker: userId2, chatUnlocked: true, contactClosed: { $ne: true } } },
  });
  if (a) return true;
  const b = await Job.findOne({
    postedBy: userId2,
    applicants: { $elemMatch: { worker: userId1, chatUnlocked: true, contactClosed: { $ne: true } } },
  });
  return !!b;
};

const checkAccess = async (req, res) => {
  try {
    const allowed = await canChat(req.user._id.toString(), req.params.userId);
    const other = await User.findById(req.params.userId).select('name phone profilePhoto role');
    // Never hand out a phone number once chat/call access is closed.
    const otherOut = other ? other.toObject() : null;
    if (otherOut && !allowed) delete otherOut.phone;
    res.status(200).json({ success: true, allowed, otherUser: otherOut });
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
        const open = await canChat(userId.toString(), other._id.toString());
        return {
          conversationId: conv._id,
          // No phone number once chat/call is closed.
          otherUser: { _id: other._id, name: other.name, phone: open ? other.phone : undefined, profilePhoto: other.profilePhoto },
          closed: !open,
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
    if (!allowed) return res.status(403).json({ success: false, message: 'Chat is not available. It opens when you are accepted for a job and closes once the job is paid.' });

    const conversationId = Message.getConversationId(req.user._id, req.params.userId);
    const messages = await Message.find({ conversationId })
      .populate('sender', 'name phone profilePhoto')
      .populate('receiver', 'name phone profilePhoto')
      .sort({ createdAt: 1 });

    await Message.updateMany({ conversationId, receiver: req.user._id, read: false }, { read: true });
    res.status(200).json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const sendMessage = async (req, res) => {
  try {
    const allowed = await canChat(req.user._id.toString(), req.params.userId);
    if (!allowed) return res.status(403).json({ success: false, message: 'Chat is closed for this job.' });

    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ success: false, message: 'Message cannot be empty' });

    const conversationId = Message.getConversationId(req.user._id, req.params.userId);
    const message = await Message.create({ conversationId, sender: req.user._id, receiver: req.params.userId, type: 'text', text: text.trim() });
    await message.populate('sender', 'name phone profilePhoto');
    await message.populate('receiver', 'name phone profilePhoto');

    // Phone alert for the other person (no in-app notification row — that would flood the list).
    pushToUser(req.params.userId, {
      type: 'new_message', title: req.user.name, body: text.trim().slice(0, 140),
      link: `/chat/${req.user._id}`, meta: { actorName: req.user.name },
    }).catch(() => {});

    res.status(201).json({ success: true, message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const sendVoiceMessage = async (req, res) => {
  try {
    const allowed = await canChat(req.user._id.toString(), req.params.userId);
    if (!allowed) return res.status(403).json({ success: false, message: 'Chat is closed for this job.' });

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

    res.status(201).json({ success: true, message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getMessages, getConversations, sendMessage, sendVoiceMessage, checkAccess, canChat };