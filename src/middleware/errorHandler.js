export function errorHandler(err, req, res, next) {
  console.error(err);
  if (res.headersSent || req.destroyed || res.writableEnded) {
    return next(err);
  }
  const status = err.statusCode || 500;
  const message = err.message || "Internal server error";
  res.status(status).json({ error: message });
}

