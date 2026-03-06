/**
 * gen-tokens.js
 * Outputs JSON with JWT tokens needed for Schemathesis runs.
 * Usage: node openapi/tests/schemathesis/gen-tokens.js
 */
"use strict";
const jwt = require("../../../services/user-service/node_modules/jsonwebtoken");

const USER_SECRET     = process.env.JWT_SECRET      || "dev-secret-users";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "dev-secret-internal";

const tokens = {
  // Public JWT - aud=citybike-users (user-service, ride-service, bike-inventory-service)
  user: jwt.sign(
    { sub: "schemathesis-test-user", email: "test@example.com", aud: "citybike-users" },
    USER_SECRET, { expiresIn: "2h" }
  ),
  // Internal JWT - aud=citybike-internal (payment-service, internal routes)
  internal: jwt.sign(
    { sub: "schemathesis-internal", aud: "citybike-internal" },
    INTERNAL_SECRET, { expiresIn: "2h" }
  ),
};

console.log(JSON.stringify(tokens));
