require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const couchbase = require("couchbase");
const { initCouchbase, collectionPath } = require("./couchbase");
const { CouchbaseSessionStore } = require("./couchbase-session-store");
const bcrypt = require("bcryptjs");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const sessionStore = new CouchbaseSessionStore({
  getCollection: async () => {
    const { collections } = await initCouchbase();
    return collections.sessions;
  }
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    },
    store: sessionStore
  })
);

const ROLES = ["admin", "professional", "client"];

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Nao autenticado." });
  }
  return next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ error: "Acesso negado." });
    }
    return next();
  };
}

function parseISODate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function validateEvent(payload) {
  const errors = [];
  if (!payload.title || typeof payload.title !== "string") {
    errors.push("title");
  }
  if (!payload.startAt || !parseISODate(payload.startAt)) {
    errors.push("startAt");
  }
  if (typeof payload.durationMinutes !== "number" || payload.durationMinutes < 15) {
    errors.push("durationMinutes");
  }
  if (typeof payload.capacity !== "number" || payload.capacity < 1) {
    errors.push("capacity");
  }
  if (payload.location && typeof payload.location !== "string") {
    errors.push("location");
  }
  return errors;
}

function buildEnrollmentKey(eventId, userId) {
  return `enrollment::${eventId}::${userId}`;
}

async function getDb() {
  const { cluster, collections, config } = await initCouchbase();
  return { cluster, collections, config };
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const { cluster, collections, config } = await getDb();
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const role = ROLES.includes(req.body.role) ? req.body.role : "client";

    const errors = [];
    if (!name) errors.push("name");
    if (!email || !email.includes("@")) errors.push("email");
    if (password.length < 6) errors.push("password");

    if (errors.length > 0) {
      return res.status(400).json({ error: "Campos invalidos.", fields: errors });
    }

    const usersPath = collectionPath(config, config.collections.users);
    const existing = await cluster.query(
      `SELECT u.id FROM ${usersPath} u WHERE u.email = $email LIMIT 1`,
      {
        parameters: { email },
        scanConsistency: couchbase.QueryScanConsistency.RequestPlus
      }
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email ja cadastrado." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash,
      role,
      createdAt: new Date().toISOString()
    };

    await collections.users.insert(doc.id, doc);
    req.session.userId = doc.id;
    req.session.role = role;
    req.session.name = name;

    return res.status(201).json({ user: safeUser(doc) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { cluster, config } = await getDb();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    const usersPath = collectionPath(config, config.collections.users);
    const { rows } = await cluster.query(
      `SELECT u.* FROM ${usersPath} u WHERE u.email = $email LIMIT 1`,
      {
        parameters: { email },
        scanConsistency: couchbase.QueryScanConsistency.RequestPlus
      }
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: "Credenciais invalidas." });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Credenciais invalidas." });
    }

    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.name = user.name;

    return res.json({ user: safeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }

  try {
    const { collections } = await getDb();
    const result = await collections.users.get(req.session.userId);
    return res.json({ user: safeUser(result.content) });
  } catch (error) {
    if (error instanceof couchbase.DocumentNotFoundError) {
      return res.json({ user: null });
    }
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/events", async (req, res) => {
  try {
    const { cluster, config } = await getDb();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const query = String(req.query.q || "").trim();
    const from = req.query.from ? parseISODate(req.query.from) : null;
    const to = req.query.to ? parseISODate(req.query.to) : null;

    const filters = ["e.status = \"open\""];
    const parameters = { limit, offset };

    if (query) {
      filters.push(
        "(LOWER(e.title) LIKE $q OR LOWER(e.description) LIKE $q OR LOWER(e.location) LIKE $q)"
      );
      parameters.q = `%${query.toLowerCase()}%`;
    }
    if (from) {
      filters.push("e.startAt >= $from");
      parameters.from = from.toISOString();
    }
    if (to) {
      filters.push("e.startAt <= $to");
      parameters.to = to.toISOString();
    }

    const eventsPath = collectionPath(config, config.collections.events);
    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const [totalResult, itemsResult] = await Promise.all([
      cluster.query(`SELECT COUNT(*) AS total FROM ${eventsPath} e ${whereClause}`, {
        parameters
      }),
      cluster.query(
        `SELECT e.* FROM ${eventsPath} e ${whereClause} ORDER BY e.startAt ASC LIMIT $limit OFFSET $offset`,
        { parameters }
      )
    ]);

    const total = totalResult.rows[0]?.total || 0;

    return res.json({
      items: itemsResult.rows,
      total,
      limit,
      offset
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/events/mine", requireAuth, requireRole(["admin", "professional"]), async (req, res) => {
  try {
    const { cluster, config } = await getDb();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const eventsPath = collectionPath(config, config.collections.events);
    const parameters = {
      limit,
      offset,
      createdBy: req.session.userId
    };

    const [totalResult, itemsResult] = await Promise.all([
      cluster.query(
        `SELECT COUNT(*) AS total FROM ${eventsPath} e WHERE e.createdBy = $createdBy`,
        { parameters }
      ),
      cluster.query(
        `SELECT e.* FROM ${eventsPath} e WHERE e.createdBy = $createdBy ORDER BY e.startAt DESC LIMIT $limit OFFSET $offset`,
        { parameters }
      )
    ]);

    const total = totalResult.rows[0]?.total || 0;

    return res.json({
      items: itemsResult.rows,
      total,
      limit,
      offset
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/events/:id", async (req, res) => {
  try {
    const { collections, cluster, config } = await getDb();
    const eventId = req.params.id;

    const result = await collections.events.get(eventId);
    const event = result.content;

    const enrollmentsPath = collectionPath(config, config.collections.enrollments);
    const countResult = await cluster.query(
      `SELECT COUNT(*) AS count FROM ${enrollmentsPath} e WHERE e.eventId = $eventId AND e.status = "active"`,
      { parameters: { eventId } }
    );

    const enrolled = countResult.rows[0]?.count || 0;

    return res.json({
      ...event,
      enrolled
    });
  } catch (error) {
    if (error instanceof couchbase.DocumentNotFoundError) {
      return res.status(404).json({ error: "Evento nao encontrado." });
    }
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/events", requireAuth, requireRole(["admin", "professional"]), async (req, res) => {
  try {
    const errors = validateEvent(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: "Campos invalidos.", fields: errors });
    }

    const { collections, cluster, config } = await getDb();
    const start = parseISODate(req.body.startAt);
    const end = new Date(start.getTime() + req.body.durationMinutes * 60000);

    const eventsPath = collectionPath(config, config.collections.events);
    const conflict = await cluster.query(
      `SELECT e.id FROM ${eventsPath} e WHERE e.createdBy = $createdBy AND e.status = "open" AND e.startAt < $end AND e.endAt > $start LIMIT 1`,
      {
        parameters: {
          createdBy: req.session.userId,
          start: start.toISOString(),
          end: end.toISOString()
        }
      }
    );

    if (conflict.rows.length > 0) {
      return res.status(409).json({ error: "Conflito de horario com outro evento." });
    }

    const doc = {
      id: crypto.randomUUID(),
      title: String(req.body.title).trim(),
      description: String(req.body.description || "").trim(),
      location: String(req.body.location || "").trim(),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      durationMinutes: req.body.durationMinutes,
      capacity: req.body.capacity,
      status: "open",
      createdBy: req.session.userId,
      createdAt: new Date().toISOString(),
      updatedAt: null
    };

    await collections.events.insert(doc.id, doc);
    return res.status(201).json(doc);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/api/events/:id", requireAuth, requireRole(["admin", "professional"]), async (req, res) => {
  try {
    const { collections, cluster, config } = await getDb();
    const eventId = req.params.id;

    const result = await collections.events.get(eventId);
    const event = result.content;

    if (req.session.role !== "admin" && event.createdBy !== req.session.userId) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    const payload = { ...req.body };
    const errors = validateEvent({
      title: payload.title || event.title,
      startAt: payload.startAt || event.startAt,
      durationMinutes: payload.durationMinutes ?? event.durationMinutes,
      capacity: payload.capacity ?? event.capacity,
      location: payload.location || event.location
    });

    if (errors.length > 0) {
      return res.status(400).json({ error: "Campos invalidos.", fields: errors });
    }

    const start = parseISODate(payload.startAt || event.startAt);
    const duration = payload.durationMinutes ?? event.durationMinutes;
    const end = new Date(start.getTime() + duration * 60000);

    const eventsPath = collectionPath(config, config.collections.events);
    const conflict = await cluster.query(
      `SELECT e.id FROM ${eventsPath} e WHERE e.createdBy = $createdBy AND e.status = "open" AND e.startAt < $end AND e.endAt > $start AND e.id != $id LIMIT 1`,
      {
        parameters: {
          createdBy: event.createdBy,
          start: start.toISOString(),
          end: end.toISOString(),
          id: eventId
        }
      }
    );

    if (conflict.rows.length > 0) {
      return res.status(409).json({ error: "Conflito de horario com outro evento." });
    }

    const update = {
      ...event,
      title: String(payload.title || event.title).trim(),
      description: String(payload.description ?? event.description).trim(),
      location: String(payload.location ?? event.location).trim(),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      durationMinutes: duration,
      capacity: payload.capacity ?? event.capacity,
      updatedAt: new Date().toISOString()
    };

    await collections.events.replace(eventId, update);
    return res.json(update);
  } catch (error) {
    if (error instanceof couchbase.DocumentNotFoundError) {
      return res.status(404).json({ error: "Evento nao encontrado." });
    }
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/api/events/:id", requireAuth, requireRole(["admin", "professional"]), async (req, res) => {
  try {
    const { collections } = await getDb();
    const eventId = req.params.id;

    const result = await collections.events.get(eventId);
    const event = result.content;

    if (req.session.role !== "admin" && event.createdBy !== req.session.userId) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    const update = {
      ...event,
      status: "cancelled",
      updatedAt: new Date().toISOString()
    };

    await collections.events.replace(eventId, update);

    return res.json({ ok: true });
  } catch (error) {
    if (error instanceof couchbase.DocumentNotFoundError) {
      return res.status(404).json({ error: "Evento nao encontrado." });
    }
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/events/:id/enroll", requireAuth, requireRole(["client"]), async (req, res) => {
  try {
    const { collections, cluster, config } = await getDb();
    const eventId = req.params.id;

    const eventResult = await collections.events.get(eventId);
    const event = eventResult.content;

    if (event.status !== "open") {
      return res.status(404).json({ error: "Evento nao encontrado." });
    }

    const enrollmentsPath = collectionPath(config, config.collections.enrollments);
    const enrolledResult = await cluster.query(
      `SELECT COUNT(*) AS count FROM ${enrollmentsPath} e WHERE e.eventId = $eventId AND e.status = "active"`,
      { parameters: { eventId } }
    );

    const enrolled = enrolledResult.rows[0]?.count || 0;
    if (enrolled >= event.capacity) {
      return res.status(409).json({ error: "Evento lotado." });
    }

    const enrollmentKey = buildEnrollmentKey(eventId, req.session.userId);
    let existing;
    try {
      const existingResult = await collections.enrollments.get(enrollmentKey);
      existing = existingResult.content;
    } catch (error) {
      if (!(error instanceof couchbase.DocumentNotFoundError)) {
        throw error;
      }
    }

    const reminderMinutes = typeof req.body.reminderMinutes === "number"
      ? req.body.reminderMinutes
      : 1440;

    if (existing && existing.status === "active") {
      return res.status(409).json({ error: "Ja inscrito." });
    }

    if (existing) {
      const update = {
        ...existing,
        status: "active",
        reminderMinutes,
        cancelledAt: null
      };

      await collections.enrollments.replace(enrollmentKey, update);
      return res.status(200).json(update);
    }

    const doc = {
      id: enrollmentKey,
      eventId,
      userId: req.session.userId,
      status: "active",
      reminderMinutes,
      createdAt: new Date().toISOString(),
      cancelledAt: null
    };

    await collections.enrollments.insert(enrollmentKey, doc);
    return res.status(201).json(doc);
  } catch (error) {
    if (error instanceof couchbase.DocumentNotFoundError) {
      return res.status(404).json({ error: "Evento nao encontrado." });
    }
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/enrollments/me", requireAuth, async (req, res) => {
  try {
    const { cluster, collections, config } = await getDb();
    const enrollmentsPath = collectionPath(config, config.collections.enrollments);

    const { rows } = await cluster.query(
      `SELECT en.*
       FROM ${enrollmentsPath} en
       WHERE en.userId = $userId AND en.status = "active"
       ORDER BY en.createdAt DESC`,
      { parameters: { userId: req.session.userId } }
    );

    const items = await Promise.all(
      rows.map(async (row) => {
        const eventResult = await collections.events.get(row.eventId);
        return {
          id: row.id,
          status: row.status,
          reminderMinutes: row.reminderMinutes,
          createdAt: row.createdAt,
          cancelledAt: row.cancelledAt,
          event: eventResult.content
        };
      })
    );

    return res.json({
      items
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get(
  "/api/enrollments/all",
  requireAuth,
  requireRole(["admin", "professional"]),
  async (req, res) => {
    try {
      const { cluster, collections, config } = await getDb();
      const enrollmentsPath = collectionPath(config, config.collections.enrollments);

      const { rows } = await cluster.query(
        `SELECT en.*
         FROM ${enrollmentsPath} en
         ORDER BY en.createdAt DESC`,
        {}
      );

      const items = await Promise.all(
        rows.map(async (row) => {
          const [eventResult, userResult] = await Promise.all([
            collections.events.get(row.eventId),
            collections.users.get(row.userId)
          ]);

          const user = userResult.content;

          return {
            id: row.id,
            status: row.status,
            reminderMinutes: row.reminderMinutes,
            createdAt: row.createdAt,
            cancelledAt: row.cancelledAt,
            event: eventResult.content,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role
            }
          };
        })
      );

      return res.json({
        items
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
);

app.post("/api/enrollments/:id/cancel", requireAuth, async (req, res) => {
  try {
    const { collections } = await getDb();
    const enrollmentId = req.params.id;

    const result = await collections.enrollments.get(enrollmentId);
    const enrollment = result.content;

    if (enrollment.userId !== req.session.userId) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    const update = {
      ...enrollment,
      status: "cancelled",
      cancelledAt: new Date().toISOString()
    };

    await collections.enrollments.replace(enrollmentId, update);

    return res.json({ ok: true });
  } catch (error) {
    if (error instanceof couchbase.DocumentNotFoundError) {
      return res.status(404).json({ error: "Inscricao nao encontrada." });
    }
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/reminders/upcoming", requireAuth, async (req, res) => {
  try {
    const { cluster, collections, config } = await getDb();
    const windowHours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168);
    const now = new Date();
    const later = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

    const enrollmentsPath = collectionPath(config, config.collections.enrollments);

    const { rows } = await cluster.query(
      `SELECT en.*
       FROM ${enrollmentsPath} en
       WHERE en.userId = $userId AND en.status = "active"
       ORDER BY en.createdAt DESC`,
      {
        parameters: {
          userId: req.session.userId
        }
      }
    );

    const items = [];
    for (const row of rows) {
      const eventResult = await collections.events.get(row.eventId);
      const event = eventResult.content;
      const startAt = parseISODate(event.startAt);

      if (startAt && startAt >= now && startAt <= later) {
        items.push({
          id: row.id,
          reminderMinutes: row.reminderMinutes,
          event
        });
      }
    }

    items.sort((a, b) => a.event.startAt.localeCompare(b.event.startAt));

    return res.json({
      items
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
