"use strict";
const express = require("express");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-users";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "dev-secret-internal";

// -- helpers -------------------------------------------------------------------------------
const errRes = (res, status, code, message) =>
  res.status(status).json({ error: { code, message, traceId: randomUUID() } });

function authUser(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return errRes(res, 401, "UNAUTHENTICATED", "Missing Bearer token");
  try {
    req.user = jwt.verify(h.slice(7), JWT_SECRET, { audience: "citybike-users" });
    next();
  } catch { errRes(res, 401, "UNAUTHENTICATED", "Invalid or expired token"); }
}

function authInternal(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return errRes(res, 401, "UNAUTHENTICATED", "Missing Bearer token");
  try {
    req.caller = jwt.verify(h.slice(7), INTERNAL_SECRET, { audience: "citybike-internal" });
    next();
  } catch { errRes(res, 401, "UNAUTHENTICATED", "Invalid internal token"); }
}

// -- in-memory store -----------------------------------------------------------------------
const rides = new Map(); // id -> ride

// -- routes ---------------------------------------------------------------------------------
app.get("/status", (_, res) => res.json({ status: "ok", version: "1.0.0" }));

// Start ride
app.post("/v1/rides", authUser, (req, res) => {
  const { bikeId } = req.body || {};
  if (!bikeId) return errRes(res, 400, "VALIDATION_ERROR", "bikeId is required");

  // Check user doesn't already have an active ride
  for (const r of rides.values()) {
    if (r.userId === req.user.sub && r.status === "active")
      return errRes(res, 409, "RIDE_ALREADY_ACTIVE", "User already has an active ride");
  }

  const ride = {
    id: randomUUID(),
    userId: req.user.sub,
    bikeId,
    status: "active",
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationSeconds: null,
    amountCharged: null,
  };
  rides.set(ride.id, ride);
  res.status(201).json(ride);
});

// List user's rides
app.get("/v1/rides", authUser, (req, res) => {
  const { status, limit = 20, offset = 0 } = req.query;
  const validStatuses = ["active", "completed", "cancelled"];
  if (status && !validStatuses.includes(status))
    return errRes(res, 400, "VALIDATION_ERROR", `status must be one of: ${validStatuses.join(", ")}`);
  let items = [...rides.values()].filter(r => r.userId === req.user.sub);
  if (status) items = items.filter(r => r.status === status);
  const total = items.length;
  items = items.slice(Number(offset), Number(offset) + Number(limit));
  res.json({ items, total });
});

// Get single ride
app.get("/v1/rides/:rideId", authUser, (req, res) => {
  const ride = rides.get(req.params.rideId);
  if (!ride) return errRes(res, 404, "RIDE_NOT_FOUND", "Ride not found");
  if (ride.userId !== req.user.sub) return errRes(res, 403, "FORBIDDEN", "Not your ride");
  res.json(ride);
});

// End ride
app.patch("/v1/rides/:rideId/end", authUser, (req, res) => {
  const ride = rides.get(req.params.rideId);
  if (!ride) return errRes(res, 404, "RIDE_NOT_FOUND", "Ride not found");
  if (ride.userId !== req.user.sub) return errRes(res, 403, "FORBIDDEN", "Not your ride");
  if (ride.status !== "active") return errRes(res, 409, "RIDE_ALREADY_ENDED", "Ride is not active");

  const endedAt = new Date().toISOString();
  const durationSeconds = Math.round((new Date(endedAt) - new Date(ride.startedAt)) / 1000);
  // Stub pricing: 0.10 GBP per minute
  const amountCharged = parseFloat(((durationSeconds / 60) * 0.1).toFixed(2));
  Object.assign(ride, { status: "completed", endedAt, durationSeconds, amountCharged });
  res.json(ride);
});

// Internal: list all active rides
app.get("/v1/internal/rides/active", authInternal, (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const items = [...rides.values()].filter(r => r.status === "active").slice(0, limit);
  res.json({ items, total: items.length });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ride-service on :${port}`));
