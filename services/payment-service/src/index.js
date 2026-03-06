"use strict";
const express = require("express");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const app = express();

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "dev-secret-internal";

// -- helpers -------------------------------------------------------------------------------
const errRes = (res, status, code, message) =>
  res.status(status).json({ error: { code, message, traceId: randomUUID() } });

app.use(express.json());

// Catch JSON parse errors and return JSON (not default HTML)
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return errRes(res, 400, "INVALID_JSON", "Request body must be valid JSON");
  }
  next(err);
});

// All non-status routes require internal JWT
function authInternal(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return errRes(res, 401, "UNAUTHENTICATED", "Missing Bearer token");
  try {
    req.caller = jwt.verify(h.slice(7), INTERNAL_SECRET, { audience: "citybike-internal" });
    next();
  } catch { errRes(res, 401, "UNAUTHENTICATED", "Invalid internal token"); }
}

// -- in-memory store -----------------------------------------------------------------------
const payments = new Map();     // id -> payment
const byRide = new Map();       // rideId -> paymentId

// -- routes ---------------------------------------------------------------------------------
app.get("/status", (_, res) => res.json({ status: "ok", version: "1.0.0" }));

// Charge for a ride
app.post("/v1/internal/payments/charge", authInternal, (req, res) => {
  const { userId, rideId, durationSeconds, currency = "GBP" } = req.body || {};
  if (!userId || !rideId || !durationSeconds)
    return errRes(res, 400, "VALIDATION_ERROR", "userId, rideId, and durationSeconds are required");
  if (typeof userId !== "string")
    return errRes(res, 400, "VALIDATION_ERROR", "userId must be a string");
  if (typeof rideId !== "string")
    return errRes(res, 400, "VALIDATION_ERROR", "rideId must be a string");
  if (typeof durationSeconds !== "number" || !Number.isInteger(durationSeconds) || durationSeconds < 1)
    return errRes(res, 400, "VALIDATION_ERROR", "durationSeconds must be a positive integer");
  if (durationSeconds > Number.MAX_SAFE_INTEGER)
    return errRes(res, 400, "VALIDATION_ERROR", "durationSeconds is out of range");
  if (typeof currency !== "string" || currency.length !== 3)
    return errRes(res, 400, "VALIDATION_ERROR", "currency must be a 3-letter string");
  if (byRide.has(rideId))
    return errRes(res, 409, "PAYMENT_EXISTS", "Payment already exists for this ride");

  // Stub pricing: 10p per minute, minimum 10p
  const amountCents = Math.max(10, Math.round((durationSeconds / 60) * 10));
  const now = new Date().toISOString();
  const payment = { id: randomUUID(), userId, rideId, amountCents, currency, status: "completed", createdAt: now, updatedAt: now };
  payments.set(payment.id, payment);
  byRide.set(rideId, payment.id);
  res.status(201).json(payment);
});

// Get payment by ID
app.get("/v1/internal/payments/:paymentId", authInternal, (req, res) => {
  const payment = payments.get(req.params.paymentId);
  if (!payment) return errRes(res, 404, "PAYMENT_NOT_FOUND", "Payment not found");
  res.json(payment);
});

// List payments for a user
app.get("/v1/internal/users/:userId/payments", authInternal, (req, res) => {
  const allowedParams = new Set(["limit", "offset"]);
  for (const key of Object.keys(req.query)) {
    if (!allowedParams.has(key))
      return errRes(res, 400, "VALIDATION_ERROR", `Unknown query parameter: ${key}`);
  }
  const { limit = 20, offset = 0 } = req.query;
  let items = [...payments.values()].filter(p => p.userId === req.params.userId);
  const total = items.length;
  items = items.slice(Number(offset), Number(offset) + Number(limit));
  res.json({ items, total });
});

// Return 405 for unsupported methods on known routes
app.all("/v1/internal/users/:userId/payments", (req, res) => {
  res.set("Allow", "GET").status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: `Method ${req.method} not allowed`, traceId: randomUUID() } });
});
app.all("/v1/internal/payments/charge", (req, res) => {
  res.set("Allow", "POST").status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: `Method ${req.method} not allowed`, traceId: randomUUID() } });
});
app.all("/v1/internal/payments/:paymentId", (req, res) => {
  res.set("Allow", "GET").status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: `Method ${req.method} not allowed`, traceId: randomUUID() } });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`payment-service on :${port}`));
