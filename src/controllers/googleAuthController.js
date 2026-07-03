import { google } from "googleapis";
import { prisma } from "../lib/prisma.js";

// Load from env; redirect must match Google Cloud Console (e.g. http://localhost:5000/api/auth/google/callback)
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5174";

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

/**
 * Initiate Google OAuth. Requires JWT (authenticate + ADMIN).
 * Call from frontend with Authorization: Bearer <token>; do not open this URL in the browser without the token.
 * Returns { url } to redirect the user to Google consent.
 */
export function googleAuthInit(req, res) {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return res.status(503).json({
      error: "Google OAuth not configured",
      detail: "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI (e.g. http://localhost:5000/api/auth/google/callback)",
    });
  }
  const state = Buffer.from(JSON.stringify({ userId: req.userId })).toString("base64url");
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
  res.json({ url });
}

/**
 * Google OAuth callback. No JWT required (Google redirects here).
 * Exchanges code for tokens and saves refresh_token to User.googleRefreshToken.
 */
export async function googleAuthCallback(req, res) {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    console.error("Google OAuth env missing in callback");
    return res.redirect(`${FRONTEND_URL}/admin/settings?error=oauth_not_configured`);
  }
  const { code, state } = req.query;
  if (!code) {
    return res.redirect(`${FRONTEND_URL}/admin/settings?error=no_code`);
  }
  let userId;
  try {
    userId = JSON.parse(Buffer.from(state, "base64url").toString()).userId;
  } catch {
    return res.redirect(`${FRONTEND_URL}/admin/settings?error=invalid_state`);
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      return res.redirect(`${FRONTEND_URL}/admin/settings?error=no_refresh_token`);
    }
    await prisma.user.update({
      where: { id: userId },
      data: { googleRefreshToken: tokens.refresh_token },
    });
    console.log("[Google OAuth] Refresh token saved for user:", userId);
    res.redirect(`${FRONTEND_URL}/admin/settings?google=connected`);
  } catch (e) {
    console.error("Google callback error:", e);
    res.redirect(`${FRONTEND_URL}/admin/settings?error=oauth_failed`);
  }
}

export async function googleAuthDisconnect(req, res, next) {
  try {
    await prisma.user.update({
      where: { id: req.userId },
      data: { googleRefreshToken: null },
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

export function getOAuth2Client(refreshToken) {
  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
