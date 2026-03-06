"use strict";
const express = require("express");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-users";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "dev-secret-internal";
const DEVICE_API_KEY = process.env.DEVICE_API_KEY || "dev-device-key";

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

// Device: X-Device-Key header
function authDevice(req, res, next) {
  if (req.headers["x-device-key"] !== DEVICE_API_KEY)
    return errRes(res, 401, "UNAUTHENTICATED", "Invalid or missing X-Device-Key");
  next();
}

// -- in-memory store (seed 3 bikes) -------------------------------------------------
const bikes = new Map();
[
  { id: "770e8400-e29b-41d4-a716-446655440001", model: "CityBike-Pro-3", status: "available", batteryLevel: 85, location: { lat: 51.5074, lng: -0.1278 } },
  { id: "770e8400-e29b-41d4-a716-446655440002", model: "CityBike-Pro-3", status: "available", batteryLevel: 72, location: { lat: 51.5080, lng: -0.1250 } },
  { id: "770e8400-e29b-41d4-a716-446655440003", model: "CityBike-Lite-1", status: "maintenance", batteryLevel: 10, location: { lat: 51.5060, lng: -0.1300 } },
].forEach(b => bikes.set(b.id, { ...b, lastSeenAt: new Date().toISOString() }));

// -- routes ---------------------------------------------------------------------------------
app.get("/status", (_, res) => res.json({ status: "ok", version: "1.0.0" }));

// List bikes
app.get("/v1/bikes", authUser, (req, res) => {
  const { status, limit = 20 } = req.query;
  const validStatuses = ["available", "in-use", "maintenance", "offline"];
  if (status && !validStatuses.includes(status))
    return errRes(res, 400, "VALIDATION_ERROR", `status must be one of: ${validStatuses.join(", ")}`);
  let items = [...bikes.values()];
  if (status) items = items.filter(b => b.status === status);
  items = items.slice(0, Number(limit));
  res.json({ items, total: items.length });
});

// Get bike
app.get("/v1/bikes/:bikeId", authUser, (req, res) => {
  const bike = bikes.get(req.params.bikeId);
  if (!bike) return errRes(res, 404, "BIKE_NOT_FOUND", "Bike not found");
  res.json(bike);
});

// Internal: reserve
app.post("/v1/internal/bikes/:bikeId/reserve", authInternal, (req, res) => {
  const bike = bikes.get(req.params.bikeId);
  if (!bike) return errRes(res, 404, "BIKE_NOT_FOUND", "Bike not found");
  if (bike.status === "in-use") return errRes(res, 409, "BIKE_ALREADY_IN_USE", "Bike already in use");
  bike.status = "in-use";
  res.json(bike);
});

// Internal: release
app.post("/v1/internal/bikes/:bikeId/release", authInternal, (req, res) => {
  const bike = bikes.get(req.params.bikeId);
  if (!bike) return errRes(res, 404, "BIKE_NOT_FOUND", "Bike not found");
  bike.status = "available";
  res.json(bike);
});

// Device: update location
app.patch("/v1/device/bikes/:bikeId/location", authDevice, (req, res) => {
  const bike = bikes.get(req.params.bikeId);
  if (!bike) return errRes(res, 404, "BIKE_NOT_FOUND", "Bike not found");
  const { lat, lng, batteryLevel } = req.body || {};
  if (lat == null || lng == null || batteryLevel == null)
    return errRes(res, 400, "VALIDATION_ERROR", "lat, lng, and batteryLevel are required");
  Object.assign(bike, { location: { lat, lng }, batteryLevel, lastSeenAt: new Date().toISOString() });
  res.json(bike);
});

// Device: update status
app.patch("/v1/device/bikes/:bikeId/status", authDevice, (req, res) => {
  const bike = bikes.get(req.params.bikeId);
  if (!bike) return errRes(res, 404, "BIKE_NOT_FOUND", "Bike not found");
  const { status } = req.body || {};
  const allowed = ["available", "maintenance", "offline"];
  if (!allowed.includes(status))
    return errRes(res, 400, "VALIDATION_ERROR", `status must be one of: ${allowed.join(", ")}`);
  bike.status = status;
  res.json(bike);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`bike-inventory-service on :${port}`));
