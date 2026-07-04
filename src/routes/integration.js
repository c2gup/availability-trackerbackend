import { Router } from "express";
import { integrationAuth } from "../middleware/integrationAuth.js";
import {
  computeBookableSlots,
  resolvePriorityMentor,
  DEFAULT_BOOKING_WINDOW_DAYS,
} from "../services/bookingSlots.js";

export const integrationRoutes = Router();

integrationRoutes.use(integrationAuth);

integrationRoutes.post("/booking-slots", async (req, res, next) => {
  try {
    const { mentorEmails, durationMinutes, daysAhead } = req.body || {};
    if (!Array.isArray(mentorEmails) || !mentorEmails.length) {
      return res.status(400).json({ error: "mentorEmails array is required" });
    }
    const slots = await computeBookableSlots({
      mentorEmails,
      durationMinutes,
      daysAhead: daysAhead ?? DEFAULT_BOOKING_WINDOW_DAYS,
    });
    res.json({ slots });
  } catch (error) {
    next(error);
  }
});

integrationRoutes.post("/booking-slots/mentor", async (req, res, next) => {
  try {
    const { mentorEmails, durationMinutes, slotStart } = req.body || {};
    if (!Array.isArray(mentorEmails) || !mentorEmails.length) {
      return res.status(400).json({ error: "mentorEmails array is required" });
    }
    if (!slotStart) {
      return res.status(400).json({ error: "slotStart is required" });
    }
    const mentor = await resolvePriorityMentor({ mentorEmails, durationMinutes, slotStart });
    if (!mentor) {
      return res.status(409).json({ error: "Slot no longer available" });
    }
    res.json({ mentor });
  } catch (error) {
    next(error);
  }
});
