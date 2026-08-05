const Skill = require('../models/Skill');

// @route  GET /api/skills
// @desc   Public — every dropdown in the app (Register, PostJob,
//         WorkerProfileSetup, BrowseJobs filters, SearchWorkers) reads from
//         this instead of a hardcoded array.
// @access Public
const getSkills = async (req, res) => {
  try {
    const skills = await Skill.find({ active: true }).sort({ order: 1, name: 1 }).select('name');
    res.status(200).json({ success: true, skills: skills.map(s => s.name) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  GET /api/admin/skills
// @desc   Admin — sees active AND inactive skills, so a removed one can be
//         restored instead of re-typed from scratch.
// @access Private (admin)
const getAllSkillsAdmin = async (req, res) => {
  try {
    const skills = await Skill.find().sort({ order: 1, name: 1 });
    res.status(200).json({ success: true, skills });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  POST /api/admin/skills
// @access Private (admin)
const createSkill = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Skill name is required' });
    }
    const clean = name.trim();
    const existing = await Skill.findOne({ name: { $regex: `^${clean}$`, $options: 'i' } });
    if (existing) {
      if (existing.active) {
        return res.status(400).json({ success: false, message: 'This skill already exists' });
      }
      // Re-activate a previously removed skill instead of creating a duplicate
      existing.active = true;
      await existing.save();
      return res.status(200).json({ success: true, message: 'Skill restored', skill: existing });
    }
    const count = await Skill.countDocuments();
    const skill = await Skill.create({ name: clean, order: count });
    res.status(201).json({ success: true, message: 'Skill added', skill });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  PATCH /api/admin/skills/:id
// @desc   Rename a skill, or toggle active/inactive directly
// @access Private (admin)
const updateSkill = async (req, res) => {
  try {
    const { name, active } = req.body;
    const skill = await Skill.findById(req.params.id);
    if (!skill) return res.status(404).json({ success: false, message: 'Skill not found' });

    if (name !== undefined && name.trim()) skill.name = name.trim();
    if (active !== undefined) skill.active = active;
    await skill.save();

    res.status(200).json({ success: true, message: 'Skill updated', skill });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  DELETE /api/admin/skills/:id
// @desc   Soft-delete — sets active: false. Never hard-deletes, since
//         existing User/Job documents may already reference this skill name
//         as a plain string and should keep displaying correctly.
// @access Private (admin)
const deleteSkill = async (req, res) => {
  try {
    const skill = await Skill.findById(req.params.id);
    if (!skill) return res.status(404).json({ success: false, message: 'Skill not found' });
    skill.active = false;
    await skill.save();
    res.status(200).json({ success: true, message: 'Skill removed from active list' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getSkills, getAllSkillsAdmin, createSkill, updateSkill, deleteSkill };