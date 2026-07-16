const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only' });
  }
  if (req.user.accountStatus !== 'active') {
    return res.status(403).json({ success: false, message: 'Admin account is not active' });
  }
  next();
};

module.exports = { adminOnly };
