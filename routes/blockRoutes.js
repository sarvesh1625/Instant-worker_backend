const express = require('express');
const router  = express.Router();
const { blockUser, unblockUser, getMyBlocks, checkBlocked } = require('../controllers/reportController');
const { protect } = require('../middleware/auth');

router.post('/',             protect, blockUser);
router.delete('/:userId',    protect, unblockUser);
router.get('/my',            protect, getMyBlocks);
router.get('/check/:userId', protect, checkBlocked);

module.exports = router;
