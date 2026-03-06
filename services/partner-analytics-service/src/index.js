"use strict";
const express = require("express");
const { randomUUID } = require("crypto");

const app = express();
app.use(express.json());

const PARTNER_API_KEY = process.env.PARTNER_API_KEY || "dev-partner-key";

// -- helpers -------------------------------------------------------------------------------
const errRes = (res, status, code, message) =>
  res.status(status).json({ error: { code, message, traceId: randomUUID() } });

// Partner auth: X-Api-Key header + X-Partner-Id header
function authPartner(req, res, next) {
  if (req.headers["x-api-key"] !== PARTNER_API_KEY)
    return errRes(res, 401, "UNAUTHENTICATED", "Invalid or missing X-Api-Key");
  if (!req.headers["x-partner-id"])
    return errRes(res, 403, "FORBIDDEN", "Missing X-Partner-Id header");
  next();
}

// Validate that ISO date-time query params are valid dates (reject arrays, objects, etc.)
function validateDateParams(req, res, next) {
  for (const name of ["from", "to"]) {
    const val = req.query[name];
    if (val === undefined) continue;
    if (typeof val !== "string" || isNaN(Date.parse(val)))
      return errRes(res, 400, "INVALID_PARAMETER", `Invalid value for '${name}': must be a valid date-time string`);
  }
  next();
}

// -- routes ---------------------------------------------------------------------------------
app.get("/status", (_, res) => res.json({ status: "ok", version: "1.0.0" }));

// Ride statistics
app.get("/v1/analytics/rides", authPartner, validateDateParams, (req, res) => {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = now.toISOString();
  res.json({
    periodStart,
    periodEnd,
    totalRides: 1240,
    completedRides: 1198,
    cancelledRides: 42,
    totalDurationSeconds: 4320000,
    avgDurationSeconds: 3484,
  });
});

// Fleet statistics
app.get("/v1/analytics/fleet", authPartner, (req, res) => {
  res.json({
    totalBikes: 150,
    availableBikes: 97,
    inUseBikes: 38,
    maintenanceBikes: 10,
    offlineBikes: 5,
    avgBatteryLevel: 71,
  });
});

// Revenue statistics
app.get("/v1/analytics/revenue", authPartner, validateDateParams, (req, res) => {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = now.toISOString();
  res.json({
    periodStart,
    periodEnd,
    currency: "GBP",
    totalAmountCents: 432100,
    completedPayments: 1198,
    failedPayments: 14,
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`partner-analytics-service on :${port}`));
