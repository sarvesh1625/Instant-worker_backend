const express = require('express');
const router = express.Router();
const { getNotifications, markAsRead, markAllRead, deleteNotification } = require('../controllers/notificationController');
const { registerPushToken, removePushToken } = require('../controllers/pushController');
const { protect } = require('../middleware/auth');

router.get('/',           protect, getNotifications);
router.post('/push-token',   protect, registerPushToken);    // must stay above '/:id'
router.delete('/push-token', protect, removePushToken);
router.patch('/read-all', protect, markAllRead);
router.patch('/:id/read', protect, markAsRead);
router.delete('/:id',     protect, deleteNotification);

module.exports = router;