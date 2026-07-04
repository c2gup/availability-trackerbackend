import { prisma } from "../lib/prisma.js";
import {
  loadWeeklyAvailability,
  isAvailableBetween,
} from "./availabilityWeek.js";
import { getWeekStart, isPastTime } from "../utils/time.js";

/** Days ahead for slot search — platform passes daysAhead; this is the default. */
export const DEFAULT_BOOKING_WINDOW_DAYS = 7;

async function mentorOwnerByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user || user.role !== "MENTOR") return null;
  return { userId: null, mentorId: user.id, role: "MENTOR", name: user.name, email: user.email };
}

export async function computeBookableSlots({
  mentorEmails,
  durationMinutes,
  daysAhead = DEFAULT_BOOKING_WINDOW_DAYS,
}) {
  const duration = Number(durationMinutes);
  if (!duration || duration < 5 || duration > 240) {
    throw new Error("durationMinutes must be between 5 and 240");
  }

  const now = new Date();
  const endLimit = new Date(now);
  endLimit.setUTCDate(endLimit.getUTCDate() + daysAhead);

  /** @type {Map<string, { startTime: string, endTime: string, mentors: { name: string, email: string }[] }>} */
  const slotMap = new Map();

  for (const rawEmail of mentorEmails || []) {
    const owner = await mentorOwnerByEmail(rawEmail);
    if (!owner) continue;

    let weekStart = getWeekStart(now);
    while (weekStart < endLimit) {
      const weekly = await loadWeeklyAvailability(owner, weekStart);
      for (const dateStr of weekly.dates) {
        for (const slot of weekly.availability[dateStr] || []) {
          const start = new Date(slot.startTime);
          const end = new Date(start.getTime() + duration * 60 * 1000);
          if (isPastTime(start) || start >= endLimit) continue;
          if (!(await isAvailableBetween(owner, start, end))) continue;

          const key = start.toISOString();
          if (!slotMap.has(key)) {
            slotMap.set(key, {
              startTime: key,
              endTime: end.toISOString(),
              mentors: [],
            });
          }
          slotMap.get(key).mentors.push({ name: owner.name, email: owner.email });
        }
      }
      weekStart = new Date(weekStart);
      weekStart.setUTCDate(weekStart.getUTCDate() + 7);
    }
  }

  return [...slotMap.values()]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map(({ startTime, endTime, mentors }) => ({
      startTime,
      endTime,
      mentors,
      mentor: mentors[0] ?? null,
    }));
}

/** First mentor in priority order (mentorEmails array) available for slotStart. */
export async function resolvePriorityMentor({
  mentorEmails,
  durationMinutes,
  slotStart,
}) {
  const duration = Number(durationMinutes);
  if (!duration || duration < 5 || duration > 240) {
    throw new Error("durationMinutes must be between 5 and 240");
  }

  const start = new Date(slotStart);
  if (Number.isNaN(start.getTime())) {
    throw new Error("slotStart must be a valid ISO datetime");
  }
  const end = new Date(start.getTime() + duration * 60 * 1000);
  if (isPastTime(start)) return null;

  for (const rawEmail of mentorEmails || []) {
    const owner = await mentorOwnerByEmail(rawEmail);
    if (!owner) continue;
    if (await isAvailableBetween(owner, start, end)) {
      return { name: owner.name, email: owner.email };
    }
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const slots = [
    {
      startTime: "2026-07-04T10:00:00.000Z",
      endTime: "2026-07-04T10:30:00.000Z",
      mentors: [
        { name: "A", email: "a@test.com" },
        { name: "B", email: "b@test.com" },
      ],
    },
  ];
  console.assert(slots[0].mentors[0].email === "a@test.com", "priority order preserved");
}
