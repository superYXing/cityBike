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

// Middleware: public JWT (aud=citybike-users)
function authUser(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return errRes(res, 401, "UNAUTHENTICATED", "Missing Bearer token");
  try {
    req.user = jwt.verify(h.slice(7), JWT_SECRET, { audience: "citybike-users" });
    next();
  } catch { errRes(res, 401, "UNAUTHENTICATED", "Invalid or expired token"); }
}

// Middleware: internal JWT (aud=citybike-internal) — Authorization: Bearer header
// Matches the spec's internalAuth: http bearer scheme so schemathesis auth tests work correctly.
function authInternal(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return errRes(res, 401, "UNAUTHENTICATED", "Missing Bearer token");
  try {
    req.caller = jwt.verify(h.slice(7), INTERNAL_SECRET, { audience: "citybike-internal" });
    next();
  } catch { return errRes(res, 401, "UNAUTHENTICATED", "Invalid internal token"); }
}

// -- in-memory store -----------------------------------------------------------------------
const users = new Map();   // id -> user (including _pw for stub auth)
const byEmail = new Map(); // email -> id

// -- routes ---------------------------------------------------------------------------------
app.get("/status", (_, res) => res.json({ status: "ok", version: "1.0.0" }));

// Register
app.post("/v1/users/register", (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name)
    return errRes(res, 400, "VALIDATION_ERROR", "email, password, and name are required");
  if (typeof email !== "string" || typeof password !== "string" || typeof name !== "string")
    return errRes(res, 400, "VALIDATION_ERROR", "email, password, and name must be strings");
  if (password.length < 8)
    return errRes(res, 422, "VALIDATION_ERROR", "password must be >= 8 characters");
  if (byEmail.has(email))
    return errRes(res, 409, "EMAIL_IN_USE", "Email already registered");

  const user = { id: randomUUID(), email, name, createdAt: new Date().toISOString(), _pw: password };
  users.set(user.id, user);
  byEmail.set(email, user.id);
  const { _pw, ...pub } = user;
  res.status(201).json(pub);
});

// Login
app.post("/v1/users/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return errRes(res, 400, "VALIDATION_ERROR", "email and password are required");
  const user = users.get(byEmail.get(email));
  if (!user || user._pw !== password)
    return errRes(res, 401, "INVALID_CREDENTIALS", "Invalid email or password");

  const token = jwt.sign(
    { sub: user.id, email: user.email, aud: "citybike-users" },
    JWT_SECRET, { expiresIn: "24h" }
  );
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  const { _pw, ...pub } = user;
  res.json({ token, expiresAt, user: pub });
});

// Get my profile
app.get("/v1/users/me", authUser, (req, res) => {
  const user = users.get(req.user.sub);
  if (!user) return errRes(res, 404, "USER_NOT_FOUND", "User not found");
  const { _pw, ...pub } = user;
  res.json(pub);
});

// Internal: get user by ID
app.get("/v1/internal/users/:userId", authInternal, (req, res) => {
  const user = users.get(req.params.userId);
  if (!user) return errRes(res, 404, "USER_NOT_FOUND", "User not found");
  const { _pw, ...pub } = user;
  res.json(pub);
});

// -- 405 Method Not Allowed for documented routes --
const definedRoutes = [
  { path: "/status",                    methods: ["GET"] },
  { path: "/v1/users/register",         methods: ["POST"] },
  { path: "/v1/users/login",            methods: ["POST"] },
  { path: "/v1/users/me",               methods: ["GET"] },
  { path: "/v1/internal/users/:userId", methods: ["GET"] },
];
for (const route of definedRoutes) {
  app.all(route.path, (req, res, next) => {
    if (!route.methods.includes(req.method)) {
      res.set("Allow", route.methods.join(", "));
      return errRes(res, 405, "METHOD_NOT_ALLOWED", `Method ${req.method} not allowed`);
    }
    next();
  });
}

// -- JSON body parse error -> return JSON 400 instead of HTML --
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed" || err.status === 400) {
    return errRes(res, 400, "INVALID_JSON", "Request body contains invalid JSON");
  }
  next(err);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`user-service on :${port}`));
