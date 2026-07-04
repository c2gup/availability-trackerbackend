import bcrypt from "bcryptjs";
import { DateTime } from "luxon";
import { prisma } from "../lib/prisma.js";
import { getWeekStart } from "../utils/time.js";
import { loadWeeklyAvailability, isAvailableBetween } from "../services/availabilityWeek.js";
import { v4 as uuidv4 } from "uuid";
import { isPastTime } from "../utils/time.js";
import { createCalendarEventWithMeet } from "../services/googleCalendar.js";

export async function listUsers(req, res, next) {
  try {
    const users = await prisma.user.findMany({
      where: { role: "USER" },
      select: { id: true, name: true, email: true, timezone: true, createdAt: true },
      orderBy: { name: "asc" },
    });
    res.json(users);
  } catch (e) {
    next(e);
  }
}

export async function listMentors(req, res, next) {
  try {
    const mentors = await prisma.user.findMany({
      where: { role: "MENTOR" },
      select: { id: true, name: true, email: true, timezone: true, createdAt: true },
      orderBy: { name: "asc" },
    });
    res.json(mentors);
  } catch (e) {
    next(e);
  }
}

export async function createUser(req, res, next) {
  try {
    const { name, email, password, role } = req.body;
    if (!email?.trim() || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    if (!role || !["USER", "MENTOR"].includes(role)) {
      return res.status(400).json({ error: "Role must be USER or MENTOR" });
    }
    const existing = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }
    const displayName = name?.trim() || email.trim().split("@")[0] || "User";
    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        id: uuidv4(),
        name: displayName,
        email: email.trim().toLowerCase(),
        password: hashed,
        role,
        timezone: "UTC",
      },
      select: { id: true, name: true, email: true, role: true, timezone: true, createdAt: true },
    });
    res.status(201).json(user);
  } catch (e) {
    next(e);
  }
}

export async function getAvailabilityForUser(req, res, next) {
  try {
    const { userId } = req.params;
    const { weekStart } = req.query;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const owner =
      user.role === "MENTOR"
        ? { userId: null, mentorId: userId, role: "MENTOR" }
        : { userId, mentorId: null, role: "USER" };

    const weekStartDate = weekStart ? new Date(weekStart) : getWeekStart(new Date());
    weekStartDate.setUTCHours(0, 0, 0, 0);

    const result = await loadWeeklyAvailability(owner, weekStartDate);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export async function getOverlappingSlots(req, res, next) {
  try {
    const { userId } = req.params;
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: "startTime and endTime required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const owner =
      user.role === "MENTOR"
        ? { userId: null, mentorId: userId, role: "MENTOR" }
        : { userId, mentorId: null, role: "USER" };

    const available = await isAvailableBetween(owner, startTime, endTime);
    res.json(available ? [{ userId, startTime, endTime }] : []);
  } catch (e) {
    next(e);
  }
}

export async function scheduleMeeting(req, res, next) {
  try {
    const adminId = req.userId;
    const { title, startTime, endTime, date, timezone, participantEmails } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    let start;
    let end;
    /** IANA timezone for Google Calendar (e.g. "Asia/Kolkata" or "UTC"). DB always stores UTC. */
    let requestTimezone = "UTC";

    if (date && timezone && typeof startTime === "string" && typeof endTime === "string" && /^\d{2}:\d{2}$/.test(startTime) && /^\d{2}:\d{2}$/.test(endTime)) {
      const startDt = DateTime.fromFormat(`${date} ${startTime}`, "dd-MM-yyyy HH:mm", { zone: timezone });
      const endDt = DateTime.fromFormat(`${date} ${endTime}`, "dd-MM-yyyy HH:mm", { zone: timezone });
      if (!startDt.isValid || !endDt.isValid) {
        return res.status(400).json({ error: "Invalid date or time. Use dd-MM-yyyy and HH:mm in the selected timezone." });
      }
      start = startDt.toJSDate();
      end = endDt.toJSDate();
      requestTimezone = timezone;
    } else if (startTime && endTime) {
      start = new Date(startTime);
      end = new Date(endTime);
    } else {
      return res.status(400).json({ error: "startTime and endTime are required (or date, startTime, endTime, timezone)." });
    }

    if (start >= end) {
      return res.status(400).json({ error: "endTime must be after startTime" });
    }
    if (isPastTime(start)) {
      return res.status(400).json({ error: "Cannot schedule meeting in the past" });
    }

    const emails = Array.isArray(participantEmails)
      ? participantEmails.map((e) => (typeof e === "string" ? e.trim() : "")).filter(Boolean)
      : [];

    // Create meeting in DB first (meetLink null if Google not connected or fails).
    const meeting = await prisma.meeting.create({
      data: {
        id: uuidv4(),
        adminId,
        title: title.trim(),
        startTime: start,
        endTime: end,
        meetLink: null,
        calendarEventId: null,
        googleEventId: null,
      },
    });

    if (emails.length > 0) {
      await prisma.meetingParticipant.createMany({
        data: emails.map((email) => ({
          id: uuidv4(),
          meetingId: meeting.id,
          email,
        })),
        skipDuplicates: true,
      });
    }

    // Create Google Calendar event + Meet link using GOOGLE_REFRESH_TOKEN from .env (do not break meeting creation if this fails).
    let meetLink = null;
    let googleEventId = null;
    try {
      const created = await createCalendarEventWithMeet({
        title: title.trim(),
        startTime: start,
        endTime: end,
        attendeeEmails: emails,
        timezone: requestTimezone,
      });
      meetLink = created.meetLink ?? null;
      googleEventId = created.eventId ?? null;
      if (meetLink || googleEventId) {
        await prisma.meeting.update({
          where: { id: meeting.id },
          data: {
            ...(meetLink && { meetLink }),
            ...(googleEventId && { googleEventId }),
            ...(googleEventId && { calendarEventId: googleEventId }),
          },
        });
      }
    } catch (err) {
      console.error("[scheduleMeeting] Google Calendar/Meet API failed (meeting already saved). Meet link will be null.", err?.message || err);
    }

    const withParticipants = await prisma.meeting.findUnique({
      where: { id: meeting.id },
      include: { participants: true },
    });

    res.status(201).json({ ...withParticipants, meetLink: withParticipants.meetLink ?? meetLink });
  } catch (e) {
    next(e);
  }
}
