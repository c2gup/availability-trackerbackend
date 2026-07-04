import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is required");
// Must match Mentorque platform JWT_SECRET (used for sso-token and admin/mentor JWTs)
const MAIN_SITE_JWT_SECRET =
  process.env.MAIN_SITE_JWT_SECRET || "your-secret-key-change-in-production";

function getDecodedToken(token) {
  const isPlatformShape = (() => {
    try {
      const payload = jwt.decode(token);
      return payload && typeof payload === "object" && "id" in payload && !("userId" in payload);
    } catch {
      return false;
    }
  })();

  console.log("[auth] isPlatformShape:", isPlatformShape);

  if (isPlatformShape && MAIN_SITE_JWT_SECRET) {
    try {
      const result = jwt.verify(token, MAIN_SITE_JWT_SECRET);
      console.log("[auth] Verified with MAIN_SITE_JWT_SECRET ✓");
      return result;
    } catch (e1) {
      console.error("[auth] MAIN_SITE_JWT_SECRET verify failed:", e1.message);
      try {
        const result = jwt.verify(token, JWT_SECRET);
        console.log("[auth] Verified with JWT_SECRET ✓");
        return result;
      } catch (e2) {
        console.error("[auth] JWT_SECRET verify failed:", e2.message);
        return null;
      }
    }
  }

  try {
    const result = jwt.verify(token, JWT_SECRET);
    console.log("[auth] Verified with JWT_SECRET (non-platform shape) ✓");
    return result;
  } catch (e1) {
    console.error("[auth] JWT_SECRET verify failed:", e1.message);
    if (MAIN_SITE_JWT_SECRET) {
      try {
        const result = jwt.verify(token, MAIN_SITE_JWT_SECRET);
        console.log("[auth] Verified with MAIN_SITE_JWT_SECRET (fallback) ✓");
        return result;
      } catch (e2) {
        console.error("[auth] MAIN_SITE_JWT_SECRET fallback verify failed:", e2.message);
        return null;
      }
    }
    return null;
  }
}

function roleFromDecoded(decoded) {
  if (decoded.role === "USER" || decoded.role === "MENTOR" || decoded.role === "ADMIN") {
    return decoded.role;
  }
  return decoded.isAdmin ? "ADMIN" : "MENTOR";
}

function nameFromDecoded(decoded, email) {
  const parts = [
    decoded.name,
    decoded.fullName,
    decoded.displayName,
    decoded.firstName && decoded.lastName
      ? `${decoded.firstName} ${decoded.lastName}`
      : decoded.firstName || decoded.lastName,
  ];
  for (const part of parts) {
    const trimmed = typeof part === "string" ? part.trim() : "";
    if (trimmed && !trimmed.includes("@")) return trimmed;
  }
  const local = email?.split("@")[0]?.split(/[._-]+/).filter(Boolean).join(" ");
  if (local) return local.charAt(0).toUpperCase() + local.slice(1);
  return "SSO User";
}

function isStaleSsoName(name, email) {
  if (!name?.trim()) return true;
  const normalized = name.trim().toLowerCase();
  if (normalized === "sso user") return true;
  const emailLower = (email || "").trim().toLowerCase();
  if (normalized === emailLower) return true;
  const local = emailLower.split("@")[0] || "";
  if (local && normalized === local) return true;
  return false;
}

function hasExplicitJwtName(decoded) {
  return [decoded.name, decoded.fullName, decoded.displayName, decoded.firstName, decoded.lastName].some(
    (part) => typeof part === "string" && part.trim() && !part.includes("@")
  );
}

async function upsertUserFromToken(decoded, email, role, idFromToken, token) {
  const tokenName = nameFromDecoded(decoded, email);
  let user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const data = {};
    if (user.role !== role) data.role = role;
    const shouldUpdateName =
      hasExplicitJwtName(decoded) &&
      !isStaleSsoName(tokenName, email) &&
      (isStaleSsoName(user.name, email) || user.name.trim() !== tokenName.trim());
    if (shouldUpdateName) data.name = tokenName;
    console.log("[SSO] tracker auth upsert (existing user)", {
      email,
      token,
      jwtNameFields: {
        name: decoded.name,
        fullName: decoded.fullName,
        displayName: decoded.displayName,
        firstName: decoded.firstName,
        lastName: decoded.lastName,
      },
      resolvedName: tokenName,
      previousName: user.name,
      storedName: data.name ?? user.name,
      isStalePreviousName: isStaleSsoName(user.name, email),
      shouldUpdateName,
      updatedFields: Object.keys(data),
    });
    if (Object.keys(data).length > 0) {
      user = await prisma.user.update({ where: { id: user.id }, data });
    }
    return user;
  }

  console.log("[SSO] tracker auth upsert (new user)", {
    email,
    token,
    jwtNameFields: {
      name: decoded.name,
      fullName: decoded.fullName,
      displayName: decoded.displayName,
      firstName: decoded.firstName,
      lastName: decoded.lastName,
    },
    resolvedName: tokenName,
  });

  return prisma.user.create({
    data: {
      id: idFromToken,
      email,
      name: tokenName,
      role,
      password: "SSO_USER_NO_PASSWORD",
    },
  });
}

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  console.log("[auth] Verifying token, prefix:", token?.slice(0, 20));

  const decoded = getDecodedToken(token);
  if (!decoded) {
    console.error("[auth] All verification attempts failed for token prefix:", token?.slice(0, 20));
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const email = (decoded.email || "").trim().toLowerCase();
  const role = roleFromDecoded(decoded);
  const idFromToken = decoded.userId || decoded.id;

  console.log("[auth] Decoded email:", email, "role:", role);

  if (!email) {
    return res.status(401).json({ error: "Invalid token: missing email" });
  }

  let user = await upsertUserFromToken(decoded, email, role, idFromToken, token);

  req.userId = user.id;
  req.userRole = user.role;
  req.userEmail = user.email;

  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res
        .status(403)
        .json({
          error: "Insufficient permissions",
          message: `This action requires one of: ${roles.join(", ")}. Your role: ${req.userRole || "none"}.`,
        });
    }
    next();
  };
}

export async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : req.cookies?.token;
  if (!token) return next();
  try {
    const decoded = getDecodedToken(token);
    if (!decoded) return next();
    const email = (decoded.email || "").trim().toLowerCase();
    if (!email) return next();
    const role = roleFromDecoded(decoded);
    const idFromToken = decoded.userId || decoded.id;
    const user = await upsertUserFromToken(decoded, email, role, idFromToken, token);
    req.userId = user.id;
    req.userRole = user.role;
    req.userEmail = user.email;
  } catch {
    // ignore
  }
  next();
}