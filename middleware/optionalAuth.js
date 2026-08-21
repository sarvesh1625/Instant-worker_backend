const jwt  = require('jsonwebtoken');
const User = require('../models/User');

// FIX: GET /api/jobs and GET /api/jobs/urgent are intentionally public
// routes (anyone can browse jobs without logging in), so they never run the
// normal `protect` middleware — which means req.user was never being set,
// even for a logged-in worker sending a valid token. That silently broke
// the subscription early-access check, since getEarlyAccessContext()
// depends entirely on req.user._id being present.
//
// This middleware verifies the token IF one is sent, populating req.user
// exactly like `protect` does — but unlike `protect`, it never rejects the
// request when no token is present. Anonymous browsing keeps working
// exactly as before; logged-in workers now correctly get their
// subscription status checked.
const optionalAuth = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) return next(); // no token — proceed as anonymous, same as before

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
  } catch (err) {
    // Invalid/expired token on a PUBLIC route — don't reject the request,
    // just proceed as anonymous. This route never required login in the
    // first place.
  }
  next();
};

module.exports = { optionalAuth };