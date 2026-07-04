import {
  resolveOwner,
  loadWeeklyAvailability,
  getTemplateSlots,
  applyAvailabilityChanges,
  saveTemplateFromGrid,
  validateChangesNotPast,
  templateResponse,
} from "../services/availabilityWeek.js";

function canAccessOwner(callerId, callerRole, owner) {
  const isOwn =
    (owner.userId === callerId && !owner.mentorId) ||
    (owner.mentorId === callerId && !owner.userId);
  return isOwn || callerRole === "ADMIN";
}

export async function getWeekly(req, res, next) {
  try {
    const { userId: targetUserId, mentorId, weekStart } = req.query;
    const owner = resolveOwner(req.userId, req.userRole, { targetUserId, targetMentorId: mentorId });
    if (!owner) {
      return res.status(400).json({ error: "Pass either userId or mentorId, not both" });
    }
    if (!canAccessOwner(req.userId, req.userRole, owner)) {
      return res.status(403).json({ error: "Cannot view another user's availability" });
    }

    const result = await loadWeeklyAvailability(owner, weekStart);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function getTemplate(req, res, next) {
  try {
    const owner = resolveOwner(req.userId, req.userRole, {
      targetUserId: req.query.userId,
      targetMentorId: req.query.mentorId,
    });
    if (!owner) {
      return res.status(400).json({ error: "Pass either userId or mentorId, not both" });
    }
    if (!canAccessOwner(req.userId, req.userRole, owner)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const slots = await getTemplateSlots(owner);
    res.json({ slots: templateResponse(slots) });
  } catch (e) {
    next(e);
  }
}

export async function saveBatch(req, res, next) {
  try {
    const { weekStart, scope, slots, pattern } = req.body;
    const callerId = req.userId;
    const role = req.userRole;

    if (!weekStart) {
      return res.status(400).json({ error: "weekStart required" });
    }
    if (scope !== "week" && scope !== "template") {
      return res.status(400).json({ error: "scope must be 'week' or 'template'" });
    }

    let owner = resolveOwner(callerId, role, {
      targetUserId: req.body.userId,
      targetMentorId: req.body.mentorId,
    });
    if (!owner) {
      return res.status(400).json({ error: "Pass either userId or mentorId, not both" });
    }
    if (!canAccessOwner(callerId, role, owner)) {
      return res.status(403).json({ error: "Cannot modify another user's availability" });
    }

    if (scope === "template") {
      const enabledPattern = Array.isArray(pattern)
        ? pattern
        : (Array.isArray(slots) ? slots.filter((s) => s.enabled) : []);

      if (enabledPattern.length === 0 && !Array.isArray(pattern)) {
        return res.status(400).json({ error: "pattern array required for template scope" });
      }

      validateChangesNotPast(weekStart, enabledPattern.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        hour: s.hour,
      })));

      await saveTemplateFromGrid(owner, enabledPattern, weekStart);
      const result = await loadWeeklyAvailability(owner, weekStart);
      return res.json({ ok: true, scope: "template", ...result });
    }

    if (!Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({ error: "slots array required for week scope" });
    }

    validateChangesNotPast(weekStart, slots);
    await applyAvailabilityChanges(owner, weekStart, slots, "week");

    const result = await loadWeeklyAvailability(owner, weekStart);
    res.json({ ok: true, scope: "week", ...result });
  } catch (e) {
    next(e);
  }
}
