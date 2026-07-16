const express = require('express');
const router  = express.Router();
const { requestDeletion, getMyDeletionRequest, cancelDeletion } = require('../controllers/accountController');
const { protect } = require('../middleware/auth');

router.post('/delete-request',   protect, requestDeletion);
router.get('/delete-request',    protect, getMyDeletionRequest);
router.delete('/delete-request', protect, cancelDeletion);

module.exports = router;
