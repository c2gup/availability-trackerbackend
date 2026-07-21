import { prisma } from "../lib/prisma.js";
import { v4 as uuidv4 } from "uuid";
import {
  getWeekStart,
  getWeekDates,
  parseDateUTC,
  normalizeSlot,
  isPastDateOnly,
  isPastTime,
} from "../utils/time.js";

/** @typedef {{ userId: string | null, mentorId: string | null, role: 'USER' | 'MENTOR' }} AvailabilityOwner */
/** @typedef {{ dayOfWeek: number, hour: number }} PatternSlot */

export function resolveOwner(
  callerId,
  callerRole,
  { targetUserId, targetMentorId } = {},
) {
  const hasUserId = targetUserId != null && String(targetUserId).trim() !== "";
  const hasMentorId =
    targetMentorId != null && String(targetMentorId).trim() !== "";

  if (hasUserId && !hasMentorId) {
    return {
      userId: String(targetUserId).trim(),
      mentorId: null,
      role: "USER",
    };
  }
  if (hasMentorId && !hasUserId) {
    return {
      userId: null,
      mentorId: String(targetMentorId).trim(),
      role: "MENTOR",
    };
  }
  if (!hasUserId && !hasMentorId) {
    if (callerRole === "MENTOR") {
      return { userId: null, mentorId: callerId, role: "MENTOR" };
    }
    return { userId: callerId, mentorId: null, role: "USER" };
  }
  return null;
}

function ownerWhere(owner) {
  return owner.role === "MENTOR"
    ? { mentorId: owner.mentorId, role: "MENTOR" }
    : { userId: owner.userId, role: "USER" };
}

function weekStartDate(weekStartInput) {
  if (weekStartInput instanceof Date) {
    return parseDateUTC(weekStartInput.toISOString().slice(0, 10));
  }
  return parseDateUTC(String(weekStartInput).slice(0, 10));
}

function normalizeToMonday(dateInput) {
  const date = dateInput instanceof Date
    ? dateInput
    : parseDateUTC(String(dateInput).slice(0, 10));
  return getWeekStart(date);
}

function weekDateStrings(weekStart) {
  const start = weekStart instanceof Date ? weekStart : parseDateUTC(weekStart);
  return getWeekDates(start).map((d) => d.toISOString().slice(0, 10));
}

export function dayOfWeekIndex(dateStr, weekStart) {
  return weekDateStrings(weekStart).indexOf(dateStr);
}

function slotKey(dow, hour) {
  return `${dow}-${hour}`;
}

function slotUtcTimes(dateStr, hour) {
  const start = parseDateUTC(dateStr);
  start.setUTCHours(hour, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(hour + 1, 0, 0, 0);
  return normalizeSlot(start, end);
}

export function normalizePatternSlots(raw) {
  if (!Array.isArray(raw)) return [];
  const unique = new Map();
  for (const slot of raw) {
    const dayOfWeek = Number(slot.dayOfWeek);
    const hour = Number(slot.hour);
    if (dayOfWeek < 0 || dayOfWeek > 6 || hour < 0 || hour > 23) continue;
    unique.set(slotKey(dayOfWeek, hour), { dayOfWeek, hour });
  }
  return [...unique.values()].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour,
  );
}

function templateSet(slots) {
  return new Set(slots.map((s) => slotKey(s.dayOfWeek, s.hour)));
}

function templateHas(slots, dayOfWeek, hour) {
  return templateSet(slots).has(slotKey(dayOfWeek, hour));
}

async function findTemplateRow(owner) {
  if (owner.role === "MENTOR") {
    return prisma.availabilityTemplate.findUnique({
      where: { mentorId: owner.mentorId },
    });
  }
  return prisma.availabilityTemplate.findUnique({
    where: { userId: owner.userId },
  });
}

export async function getTemplateSlots(owner) {
  const row = await findTemplateRow(owner);
  if (!row) return [];
  return normalizePatternSlots(row.slots);
}

export async function replaceTemplate(owner, patternSlots) {
  const slots = normalizePatternSlots(patternSlots);
  const base = { role: owner.role, slots };

  if (owner.role === "MENTOR") {
    await prisma.availabilityTemplate.upsert({
      where: { mentorId: owner.mentorId },
      create: { id: uuidv4(), userId: null, mentorId: owner.mentorId, ...base },
      update: { slots },
    });
  } else {
    await prisma.availabilityTemplate.upsert({
      where: { userId: owner.userId },
      create: { id: uuidv4(), userId: owner.userId, mentorId: null, ...base },
      update: { slots },
    });
  }

  return slots;
}

async function getExceptionsForWeek(owner, weekStart) {
  const ws = normalizeToMonday(weekStart);
  const where =
    owner.role === "MENTOR"
      ? { mentorId: owner.mentorId, weekStart: ws }
      : { userId: owner.userId, weekStart: ws };

  return prisma.availabilityException.findMany({
    where,
    orderBy: [{ dayOfWeek: "asc" }, { hour: "asc" }],
  });
}

async function getExceptionsForWeekRange(owner, dateStrs) {
  if (dateStrs.length === 0) return [];
  const mondays = [...new Set(dateStrs.map(dStr => getWeekStart(parseDateUTC(dStr)).toISOString()))]
    .map(iso => new Date(iso));

  const where =
    owner.role === "MENTOR"
      ? {
          mentorId: owner.mentorId,
          OR: mondays.map(m => ({ weekStart: m })),
        }
      : {
          userId: owner.userId,
          OR: mondays.map(m => ({ weekStart: m })),
        };

  return prisma.availabilityException.findMany({
    where,
    orderBy: [{ weekStart: "asc" }, { dayOfWeek: "asc" }, { hour: "asc" }],
  });
}

function exceptionsMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const exceptionDate = new Date(row.weekStart);
    exceptionDate.setUTCDate(exceptionDate.getUTCDate() + row.dayOfWeek);
    const dateStr = exceptionDate.toISOString().slice(0, 10);
    map.set(`${dateStr}-${row.hour}`, row.enabled);
    map.set(`${row.dayOfWeek}-${row.hour}`, row.enabled);
  }
  return map;
}

export function effectiveSlotEnabled(template, excMap, dayOfWeek, hour, dateStr = null) {
  const keysToCheck = [];
  if (dateStr) {
    keysToCheck.push(`${dateStr}-${hour}`);
  }
  keysToCheck.push(`${dayOfWeek}-${hour}`);

  for (const key of keysToCheck) {
    if (excMap.has(key)) return excMap.get(key);
  }

  const templateKey = slotKey(dayOfWeek, hour);
  return templateSet(template).has(templateKey);
}

function buildAvailabilityByDate(dateStrs, weekStart, template, excMap) {
  const byDate = {};
  dateStrs.forEach((d) => (byDate[d] = []));

  dateStrs.forEach((dateStr) => {
    const d = new Date(dateStr + "T00:00:00.000Z");
    const day = d.getUTCDay();
    const dowIndex = day === 0 ? 6 : day - 1;

    for (let hour = 0; hour < 24; hour++) {
      if (!effectiveSlotEnabled(template, excMap, dowIndex, hour, dateStr)) continue;
      const { start, end } = slotUtcTimes(dateStr, hour);
      byDate[dateStr].push({
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      });
    }
  });

  return byDate;
}

async function getMeetingsForWeek(owner, weekStart) {
  const userId = owner.userId || owner.mentorId;
  if (!userId) return [];

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true }
  });

  if (!user) return [];

  const ws = weekStartDate(weekStart);
  const we = new Date(ws);
  we.setUTCDate(we.getUTCDate() + 7);

  return prisma.meeting.findMany({
    where: {
      participants: {
        some: {
          email: user.email
        }
      },
      startTime: {
        gte: ws,
        lt: we
      }
    },
    orderBy: {
      startTime: "asc"
    }
  });
}

export async function loadWeeklyAvailability(owner, weekStartInput) {
  const start = weekStartInput
    ? weekStartDate(weekStartInput)
    : getWeekStart(new Date());

  const dateStrs = weekDateStrings(start);
  const weekEnd = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  let template = await getTemplateSlots(owner);

  if (template.length === 0) {
    template = await ensureTemplateFromLegacyAvailabilities(owner);
  }

  const exceptions = await getExceptionsForWeekRange(owner, dateStrs);
  const excMap = exceptionsMap(exceptions);

  const meetings = await getMeetingsForWeek(owner, start);

  const availability = buildAvailabilityByDate(
    dateStrs,
    start,
    template,
    excMap,
  );

  console.log("--- DEBUG Weekly Availability ---");
  console.log("received weekStart:", weekStartInput);
  console.log("normalized weekStart:", start.toISOString().slice(0, 10));
  console.log("computed weekEnd:", weekEnd.toISOString().slice(0, 10));
  console.log("timezone: UTC");
  console.log("template records (count):", template.length);
  console.log("template records:", JSON.stringify(template));
  console.log("exception records (count):", exceptions.length);
  console.log("exception records:", JSON.stringify(exceptions));
  console.log("final merged availability:", JSON.stringify(availability));
  console.log("---------------------------------");

  return {
    weekStart: dateStrs[0],
    dates: dateStrs,

    availability,
    meetings,

    hasTemplate: template.length > 0,
    exceptionCount: exceptions.length,
  };
}

async function ensureTemplateFromLegacyAvailabilities(owner) {
  const availWhere = ownerWhere(owner);
  const latest = await prisma.availability.findFirst({
    where: availWhere,
    orderBy: { date: "desc" },
  });
  if (!latest) return [];

  const ws = getWeekStart(latest.date);
  const weekEnd = new Date(ws);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const rows = await prisma.availability.findMany({
    where: { ...availWhere, date: { gte: ws, lt: weekEnd } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  const pattern = [];
  const seen = new Set();
  for (const row of rows) {
    const dateStr = row.date.toISOString().slice(0, 10);
    const dow = dayOfWeekIndex(dateStr, ws);
    if (dow < 0) continue;
    const hour = new Date(row.startTime).getUTCHours();
    const key = slotKey(dow, hour);
    if (seen.has(key)) continue;
    seen.add(key);
    pattern.push({ dayOfWeek: dow, hour });
  }

  if (pattern.length === 0) return [];
  return replaceTemplate(owner, pattern);
}

async function upsertException(owner, weekStart, dayOfWeek, hour, enabled) {
  const ws = normalizeToMonday(weekStart);
  const data = {
    role: owner.role,
    weekStart: ws,
    dayOfWeek,
    hour,
    enabled,
  };

  if (owner.role === "MENTOR") {
    return prisma.availabilityException.upsert({
      where: {
        mentorId_weekStart_dayOfWeek_hour: {
          mentorId: owner.mentorId,
          weekStart: ws,
          dayOfWeek,
          hour,
        },
      },
      create: { id: uuidv4(), userId: null, mentorId: owner.mentorId, ...data },
      update: { enabled },
    });
  }

  return prisma.availabilityException.upsert({
    where: {
      userId_weekStart_dayOfWeek_hour: {
        userId: owner.userId,
        weekStart: ws,
        dayOfWeek,
        hour,
      },
    },
    create: { id: uuidv4(), userId: owner.userId, mentorId: null, ...data },
    update: { enabled },
  });
}

async function deleteException(owner, weekStart, dayOfWeek, hour) {
  const ws = normalizeToMonday(weekStart);
  const where =
    owner.role === "MENTOR"
      ? { mentorId: owner.mentorId, weekStart: ws, dayOfWeek, hour }
      : { userId: owner.userId, weekStart: ws, dayOfWeek, hour };
  await prisma.availabilityException.deleteMany({ where });
}

/**
 * @param {AvailabilityOwner} owner
 * @param {string} weekStart
 * @param {{ dayOfWeek: number, hour: number, enabled: boolean }[]} changes
 * @param {'week' | 'template'} scope
 */
export async function applyAvailabilityChanges(
  owner,
  weekStart,
  changes,
  scope,
) {
  const template = await getTemplateSlots(owner);

  if (scope === "template") {
    const pattern = normalizePatternSlots(changes.filter((c) => c.enabled));
    await replaceTemplate(owner, pattern);
    await clearWeekExceptions(owner, weekStart);
    return { scope: "template", slots: pattern.length };
  }

  // ponytail: removed — first save uses template scope from frontend; week scope writes exceptions only
  for (const { dayOfWeek, hour, enabled } of changes) {
    const inTemplate = templateHas(template, dayOfWeek, hour);
    if (enabled === inTemplate) {
      await deleteException(owner, weekStart, dayOfWeek, hour);
    } else {
      await upsertException(owner, weekStart, dayOfWeek, hour, enabled);
    }
  }

  return { scope: "week", changes: changes.length };
}

/** Save full grid pattern as template (every week). */
export async function saveTemplateFromGrid(
  owner,
  enabledSlots,
  weekStart = null,
) {
  const pattern = normalizePatternSlots(enabledSlots);
  await replaceTemplate(owner, pattern);
  if (weekStart) {
    await clearWeekExceptions(owner, weekStart);
  }
  return pattern;
}

async function clearWeekExceptions(owner, weekStart) {
  const ws = normalizeToMonday(weekStart);
  const where =
    owner.role === "MENTOR"
      ? { mentorId: owner.mentorId, weekStart: ws }
      : { userId: owner.userId, weekStart: ws };
  await prisma.availabilityException.deleteMany({ where });
}

/** Check if owner is available for entire [start, end) using template ± exceptions. */
export async function isAvailableBetween(owner, startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (start >= end) return false;

  let template = await getTemplateSlots(owner);
  if (template.length === 0) {
    template = await ensureTemplateFromLegacyAvailabilities(owner);
  }
  if (template.length === 0) return false;

  const cursor = new Date(start);
  cursor.setUTCMinutes(0, 0, 0);

  while (cursor < end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const hour = cursor.getUTCHours();
    const ws = getWeekStart(cursor);
    const dow = dayOfWeekIndex(dateStr, ws);
    if (dow < 0) return false;

    const exceptions = await getExceptionsForWeek(owner, ws);
    const excMap = exceptionsMap(exceptions);
    if (!effectiveSlotEnabled(template, excMap, dow, hour, dateStr)) return false;

    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }

  return true;
}

export function templateResponse(slots) {
  return slots.map((s) => ({ dayOfWeek: s.dayOfWeek, hour: s.hour }));
}

export function changesNeedScope(template, excMap, changes) {
  return changes.some(({ dayOfWeek, hour, enabled }) => {
    const baseline = effectiveSlotEnabled(template, excMap, dayOfWeek, hour);
    return enabled !== baseline;
  });
}

export function validateChangesNotPast(weekStart, changes) {
  const dateStrs = weekDateStrings(weekStart);
  for (const { dayOfWeek, hour } of changes) {
    const dateStr = dateStrs[dayOfWeek];
    if (!dateStr) continue;
    if (isPastDateOnly(dateStr)) {
      throw new Error("Cannot set availability in the past");
    }
    const { start } = slotUtcTimes(dateStr, hour);
    if (isPastTime(start)) {
      throw new Error("Cannot set availability for past time");
    }
  }
}
