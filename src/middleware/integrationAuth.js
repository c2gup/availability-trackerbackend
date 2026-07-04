export function integrationAuth(req, res, next) {
  const secret = process.env.INTEGRATION_API_SECRET;
  if (!secret) {
    return res.status(503).json({ error: "Integration API not configured" });
  }
  const provided = req.headers["x-integration-secret"];
  if (provided !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
