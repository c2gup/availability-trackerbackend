/**
 * One-time: copy real names from platform DB into tracker User.name (match on email).
 * Dry run:  node src/scripts/backfillNamesFromPlatform.js
 * Apply:    node src/scripts/backfillNamesFromPlatform.js --apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const platformUrl = process.env.PLATFORM_DATABASE_URL;
if (!platformUrl) {
  console.error("Set PLATFORM_DATABASE_URL in .env (platform backend DATABASE_URL)");
  process.exit(1);
}

const tracker = new PrismaClient();
const platform = new PrismaClient({ datasources: { db: { url: platformUrl } } });

function isStaleName(name, email) {
  if (!name?.trim()) return true;
  const n = name.trim().toLowerCase();
  const e = (email || "").trim().toLowerCase();
  if (n === "sso user" || n === e) return true;
  const local = e.split("@")[0] || "";
  if (local && n === local) return true;
  const derived = local.split(/[._-]+/).filter(Boolean).join(" ");
  if (derived && n === derived) return true;
  if (derived && n === derived.charAt(0).toUpperCase() + derived.slice(1)) return true;
  return false;
}

async function main() {
  const [users, mentors] = await Promise.all([
    platform.$queryRaw`
      SELECT lower(email) AS email, trim("fullName") AS name
      FROM users
      WHERE "fullName" IS NOT NULL AND trim("fullName") <> ''
        AND "deletedAt" IS NULL`,
    platform.$queryRaw`
      SELECT lower(email) AS email, trim(name) AS name
      FROM admin_mentors
      WHERE name IS NOT NULL AND trim(name) <> ''
        AND "deletedAt" IS NULL`,
  ]);

  const byEmail = new Map();
  for (const row of users) byEmail.set(row.email, { name: row.name, source: "users.fullName" });
  for (const row of mentors) byEmail.set(row.email, { name: row.name, source: "admin_mentors.name" });

  const trackerUsers = await tracker.user.findMany({
    select: { id: true, email: true, name: true, role: true },
    orderBy: { email: "asc" },
  });

  const updates = [];
  const skipped = [];

  for (const u of trackerUsers) {
    const email = u.email.trim().toLowerCase();
    const platformRow = byEmail.get(email);
    if (!platformRow) {
      skipped.push({ email, name: u.name, reason: "no platform name" });
      continue;
    }
    if (platformRow.name === u.name.trim()) continue;
    if (!isStaleName(u.name, email)) {
      skipped.push({ email, name: u.name, reason: "tracker name looks valid, skipped" });
      continue;
    }
    updates.push({
      id: u.id,
      email,
      role: u.role,
      from: u.name,
      to: platformRow.name,
      source: platformRow.source,
    });
  }

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — name backfill from platform\n`);
  console.log(`Tracker users: ${trackerUsers.length}`);
  console.log(`Platform names loaded: ${byEmail.size} (${users.length} users + ${mentors.length} mentors/admins)`);
  console.log(`Would update: ${updates.length}\n`);

  if (updates.length) {
    console.log("Changes:");
    for (const u of updates) {
      console.log(`  [${u.role}] ${u.email}`);
      console.log(`    "${u.from}" → "${u.to}"  (${u.source})`);
    }
  } else {
    console.log("No updates needed.");
  }

  if (skipped.length && !APPLY) {
    const noPlatform = skipped.filter((s) => s.reason === "no platform name");
    if (noPlatform.length) {
      console.log(`\nSkipped (${noPlatform.length}): no matching platform name — still email-derived or SSO User:`);
      for (const s of noPlatform.filter((x) => isStaleName(x.name, x.email))) {
        console.log(`  ${s.email}: "${s.name}"`);
      }
    }
  }

  if (APPLY && updates.length) {
    await tracker.$transaction(
      updates.map((u) => tracker.user.update({ where: { id: u.id }, data: { name: u.to } }))
    );
    console.log("\nApplied.");
  } else if (!APPLY) {
    console.log("\nNo data changed. Re-run with --apply to write.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await tracker.$disconnect();
    await platform.$disconnect();
  });
