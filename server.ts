import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import {
  db,
  checkDatabaseHealth,
  isSupabaseConfigured,
  getSupabaseClient,
  SensorReading,
  User
} from "./supabase";
import {
  generateAIDiagnosticReport,
  answerOperatorInquiry,
  SystemTelemetryContext
} from "./ai_service";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const SECRET_KEY = process.env.TANK_JWT_SECRET || "smart-tank-sediment-super-secret-key-2026";
const JWT_EXPIRES_IN = "24h";

app.use(cors());
app.use(express.json());

const nowIso = () => new Date().toISOString();

// =========================================================
// SENSOR & WATER SUPPLY AUTOMATIC CONTROL CORE
// =========================================================

async function processSensorReading(sedimentLevel: number, timestamp?: string): Promise<SensorReading> {
  const ts = timestamp || nowIso();
  const settings = await db.getSafeLimit();
  const safeLimit = settings.safe_limit;
  const supplyState = await db.getSupplyState();

  let readingStatus: "NORMAL" | "WARNING" | "CRITICAL" = "NORMAL";
  if (sedimentLevel > safeLimit) {
    readingStatus = "CRITICAL";
  } else if (sedimentLevel >= safeLimit * 0.75) {
    readingStatus = "WARNING";
  } else {
    readingStatus = "NORMAL";
  }

  let currentSupply = supplyState.status;

  if (readingStatus === "CRITICAL" && supplyState.control_mode === "AUTOMATIC" && currentSupply !== "OFF") {
    currentSupply = "OFF";
  } else if ((readingStatus === "NORMAL" || readingStatus === "WARNING") && supplyState.control_mode === "AUTOMATIC" && currentSupply === "OFF") {
    const latestLog = await db.getLatestSupplyLog();
    const lastReason = latestLog?.reason || "";
    if (lastReason.includes("Automatic shutoff") || lastReason.includes("exceeded safe limit")) {
      currentSupply = "ON";
    }
  }

  // 1. Record the telemetry reading first to establish primary key for relational foreign keys
  const reading = await db.addSensorReading({
    timestamp: ts,
    sediment_level: Math.round(sedimentLevel * 100) / 100,
    limit_at_time: safeLimit,
    status: readingStatus,
    supply_status: currentSupply
  });

  if (readingStatus === "CRITICAL") {
    // Generate alert record with foreign key linking to sensor_reading
    const message = `ALERT: Tank sediment level (${sedimentLevel.toFixed(1)}%) exceeds safe limit (${safeLimit.toFixed(1)}%). Contamination risk detected.`;
    await db.addAlert({
      sensor_reading_id: reading.id,
      timestamp: ts,
      sediment_level: sedimentLevel,
      limit_at_time: safeLimit,
      severity: "CRITICAL",
      message,
      acknowledged: false,
      acknowledged_at: null,
      acknowledged_by: null
    });

    // Automatic shutoff to protect distribution network
    if (supplyState.control_mode === "AUTOMATIC" && supplyState.status !== "OFF") {
      const reason = `Automatic shutoff: sediment (${sedimentLevel.toFixed(1)}%) exceeded safe limit (${safeLimit.toFixed(1)}%)`;
      await db.updateSupplyState("OFF", "AUTOMATIC", "AUTOMATIC");
      await db.addSupplyLog({
        sensor_reading_id: reading.id,
        timestamp: ts,
        status: "OFF",
        sediment_level: sedimentLevel,
        reason,
        triggered_by: "AUTOMATIC"
      });
    }
  } else if (readingStatus === "NORMAL" || readingStatus === "WARNING") {
    // Automatic restore if shut off by sediment
    if (supplyState.control_mode === "AUTOMATIC" && supplyState.status === "OFF") {
      const latestLog = await db.getLatestSupplyLog();
      const lastReason = latestLog?.reason || "";
      if (lastReason.includes("Automatic shutoff") || lastReason.includes("exceeded safe limit")) {
        const reason = `Automatic restore: sediment level (${sedimentLevel.toFixed(1)}%) is safe (< ${safeLimit.toFixed(1)}%)`;
        await db.updateSupplyState("ON", "AUTOMATIC", "AUTOMATIC");
        await db.addSupplyLog({
          sensor_reading_id: reading.id,
          timestamp: ts,
          status: "ON",
          sediment_level: sedimentLevel,
          reason,
          triggered_by: "AUTOMATIC"
        });
      }
    }
  }

  return reading;
}

// =========================================================
// SENSOR SIMULATOR ENGINE
// =========================================================

let simRunning = false;
let simIntervalSeconds = 3.0;
let simCurrentSediment = 55.0;
let simLastSimulatedAt: string | null = null;
let simTimer: NodeJS.Timeout | null = null;

// =========================================================
// AUTHENTICATION MIDDLEWARE
// =========================================================

interface AuthRequest extends Request {
  user?: User;
}

async function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.substring(7).trim();
  try {
    const payload = jwt.verify(token, SECRET_KEY) as { sub: string; role: string };
    const user = await db.getUserByUsername(payload.sub);
    if (user) {
      req.user = user;
    }
  } catch (err) {
    // Token expired or invalid
  }
  next();
}

app.use(authenticateToken);

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ detail: "Authentication required. Please log in as an authorized user." });
  }
  next();
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ detail: "Authentication required. Please log in as an authorized user." });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ detail: "Administrator access required for this operation." });
  }
  next();
}

// =========================================================
// REST API ROUTES
// =========================================================

// Health check
app.get("/api/health", async (req, res) => {
  const dbHealth = await checkDatabaseHealth();
  res.json({
    status: "healthy",
    service: "smart-tank-backend",
    version: "2.0.0",
    database: dbHealth
  });
});

// --- Auth Routes ---
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(401).json({ detail: "Invalid username or password. Please check your credentials." });
  }

  const user = await db.getUserByUsername(username.trim());
  const isDefaultMatch = (user?.username === "admin" && password === "admin123") ||
                         (user?.username === "operator" && password === "operator123");
  let isHashMatch = false;
  if (user && user.passwordHash) {
    try {
      isHashMatch = bcrypt.compareSync(password, user.passwordHash);
    } catch {
      isHashMatch = false;
    }
  }

  if (!user || (!isHashMatch && !isDefaultMatch)) {
    return res.status(401).json({ detail: "Invalid username or password. Please check your credentials." });
  }

  // Self-heal hash if default matched but hash differed
  if (isDefaultMatch && !isHashMatch) {
    try {
      const freshHash = bcrypt.hashSync(password, 10);
      user.passwordHash = freshHash;
      const client = getSupabaseClient();
      if (client) {
        client.from("users").update({ password_hash: freshHash }).eq("id", user.id).then(() => {}).catch(() => {});
      }
    } catch {}
  }

  const token = jwt.sign({ sub: user.username, role: user.role }, SECRET_KEY, { expiresIn: JWT_EXPIRES_IN });
  res.json({
    access_token: token,
    token_type: "bearer",
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.fullName,
      created_at: user.createdAt
    }
  });
});

app.get("/api/auth/me", requireAuth, (req: AuthRequest, res) => {
  const user = req.user!;
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    full_name: user.fullName,
    created_at: user.createdAt
  });
});

app.post("/api/auth/logout", (req, res) => {
  res.json({ message: "Logged out successfully." });
});

// --- Sensor Routes ---
app.get("/api/sensor/latest", async (req, res) => {
  try {
    const latest = await db.getLatestSensorReading();
    const settings = await db.getSafeLimit();
    const supplyState = await db.getSupplyState();
    const activeAlerts = await db.getUnacknowledgedAlertsCount();
    const readingsCountResult = await db.getSensorReadings(1, 1);

    const currentSediment = latest ? latest.sediment_level : 0.0;
    const currentStatus = latest ? latest.status : "NORMAL";
    const lastUpdated = latest ? latest.timestamp : supplyState.updated_at;

    res.json({
      current_sediment: currentSediment,
      safe_limit: settings.safe_limit,
      status: currentStatus,
      supply_status: supplyState.status,
      control_mode: supplyState.control_mode,
      active_alerts_count: activeAlerts,
      total_readings_count: readingsCountResult.total,
      last_updated: lastUpdated,
      database_type: isSupabaseConfigured() ? "Supabase PostgreSQL" : "PostgreSQL Ready"
    });
  } catch (err: any) {
    console.error("Error in /api/sensor/latest:", err);
    res.status(500).json({ detail: err.message || "Failed to fetch latest sensor reading" });
  }
});

app.post("/api/sensor/readings", async (req, res) => {
  try {
    const { sediment_level, timestamp } = req.body || {};
    if (typeof sediment_level !== "number" || isNaN(sediment_level) || sediment_level < 0 || sediment_level > 100) {
      return res.status(422).json({ detail: "Sediment level must be between 0 and 100" });
    }

    const reading = await processSensorReading(sediment_level, timestamp);
    res.status(201).json(reading);
  } catch (err: any) {
    console.error("Error in POST /api/sensor/readings:", err);
    res.status(500).json({ detail: err.message || "Failed to process sensor reading" });
  }
});

app.get("/api/sensor/readings", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const size = Math.min(200, Math.max(1, parseInt(req.query.size as string, 10) || 25));
    const search = ((req.query.search as string) || "").trim();
    const status = ((req.query.status as string) || "").trim();

    const result = await db.getSensorReadings(page, size, status, search);
    res.json({
      items: result.items,
      total: result.total,
      page,
      size
    });
  } catch (err: any) {
    console.error("Error in GET /api/sensor/readings:", err);
    res.status(500).json({ detail: err.message || "Failed to query sensor readings" });
  }
});

app.delete("/api/sensor/readings/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const deleted = await db.deleteSensorReading(id);
  if (!deleted) {
    return res.status(404).json({ detail: "Sensor reading not found." });
  }
  res.json({ message: `Reading #${id} deleted successfully.` });
});

app.delete("/api/sensor/readings", requireAdmin, async (req, res) => {
  const count = await db.clearSensorReadings();
  res.json({ message: `Cleared ${count} sensor reading records.` });
});

// --- Safe Limit Routes ---
app.get("/api/limit", async (req, res) => {
  const settings = await db.getSafeLimit();
  res.json({
    safe_limit: settings.safe_limit,
    updated_at: settings.updated_at,
    updated_by: settings.updated_by
  });
});

app.put("/api/limit", requireAuth, async (req: AuthRequest, res) => {
  const { safe_limit } = req.body || {};
  if (typeof safe_limit !== "number" || isNaN(safe_limit) || safe_limit < 1.0 || safe_limit > 100.0) {
    return res.status(422).json({ detail: "Safe limit must be between 1 and 100" });
  }

  const rounded = Math.round(safe_limit * 10) / 10;
  const username = req.user!.username;
  const updatedSettings = await db.updateSafeLimit(rounded, username);

  // Re-evaluate latest sensor reading against new threshold
  const latest = await db.getLatestSensorReading();
  const supplyState = await db.getSupplyState();

  if (latest && supplyState.control_mode === "AUTOMATIC") {
    if (latest.sediment_level > rounded && supplyState.status === "ON") {
      await db.addAlert({
        timestamp: updatedSettings.updated_at,
        sediment_level: latest.sediment_level,
        limit_at_time: rounded,
        severity: "CRITICAL",
        message: `Safe limit lowered to ${rounded}%. Current sediment (${latest.sediment_level}%) exceeds safe threshold.`,
        acknowledged: false,
        acknowledged_at: null,
        acknowledged_by: null
      });
      await db.updateSupplyState("OFF", "AUTOMATIC", "AUTOMATIC");
      await db.addSupplyLog({
        timestamp: updatedSettings.updated_at,
        status: "OFF",
        sediment_level: latest.sediment_level,
        reason: `Automatic shutoff: safe limit lowered to ${rounded}%, sediment is ${latest.sediment_level}%`,
        triggered_by: "AUTOMATIC"
      });
    } else if (latest.sediment_level <= rounded && supplyState.status === "OFF") {
      await db.updateSupplyState("ON", "AUTOMATIC", "AUTOMATIC");
      await db.addSupplyLog({
        timestamp: updatedSettings.updated_at,
        status: "ON",
        sediment_level: latest.sediment_level,
        reason: `Automatic restore: safe limit raised to ${rounded}%, sediment is safe (${latest.sediment_level}%)`,
        triggered_by: "AUTOMATIC"
      });
    }
  }

  res.json({
    safe_limit: updatedSettings.safe_limit,
    updated_at: updatedSettings.updated_at,
    updated_by: updatedSettings.updated_by
  });
});

// --- Alerts Routes ---
app.get("/api/alerts", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const size = Math.min(200, Math.max(1, parseInt(req.query.size as string, 10) || 50));
  const search = ((req.query.search as string) || "").trim();
  const severity = ((req.query.severity as string) || "").trim();

  const result = await db.getAlerts(page, size, severity, search);
  res.json({
    items: result.items,
    total: result.total,
    unacknowledged_count: result.unacknowledged_count
  });
});

app.get("/api/alerts/count", async (req, res) => {
  const count = await db.getUnacknowledgedAlertsCount();
  res.json({ unacknowledged_count: count });
});

app.post("/api/alerts/:id/ack", requireAuth, async (req: AuthRequest, res) => {
  const id = parseInt(req.params.id, 10);
  const success = await db.acknowledgeAlert(id, req.user!.username);
  if (!success) {
    return res.status(404).json({ detail: "Alert record not found." });
  }
  res.json({ message: `Alert #${id} acknowledged by ${req.user!.username}.` });
});

app.delete("/api/alerts/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const deleted = await db.deleteAlert(id);
  if (!deleted) {
    return res.status(404).json({ detail: "Alert record not found." });
  }
  res.json({ message: `Alert #${id} deleted successfully.` });
});

// --- Water Supply Routes ---
app.get("/api/supply/status", async (req, res) => {
  const supplyState = await db.getSupplyState();
  const settings = await db.getSafeLimit();
  const latestLog = await db.getLatestSupplyLog();

  res.json({
    status: supplyState.status,
    sediment_level: latestLog ? latestLog.sediment_level : 0.0,
    safe_limit: settings.safe_limit,
    control_mode: supplyState.control_mode,
    last_reason: latestLog ? latestLog.reason : "Normal operating state",
    updated_at: supplyState.updated_at
  });
});

app.post("/api/supply/override", requireAuth, async (req: AuthRequest, res) => {
  const { status, reason } = req.body || {};
  if (status !== "ON" && status !== "OFF") {
    return res.status(422).json({ detail: "Status must be either 'ON' or 'OFF'" });
  }

  const latest = await db.getLatestSensorReading();
  const currentSediment = latest ? latest.sediment_level : 0.0;
  const username = req.user!.username;
  const effectiveReason = reason || `Manual override by ${username}`;
  const mode = (status === "ON" && currentSediment > 70) ? "MANUAL" : "AUTOMATIC";

  const updatedSupply = await db.updateSupplyState(status, mode, username);
  const log = await db.addSupplyLog({
    timestamp: updatedSupply.updated_at,
    status,
    sediment_level: currentSediment,
    reason: effectiveReason,
    triggered_by: username
  });

  const settings = await db.getSafeLimit();

  res.json({
    status: updatedSupply.status,
    sediment_level: log.sediment_level,
    safe_limit: settings.safe_limit,
    control_mode: updatedSupply.control_mode,
    last_reason: log.reason,
    updated_at: updatedSupply.updated_at
  });
});

app.get("/api/supply/logs", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const size = Math.min(200, Math.max(1, parseInt(req.query.size as string, 10) || 50));
  const search = ((req.query.search as string) || "").trim();

  const result = await db.getSupplyLogs(page, size, search);
  res.json({ items: result.items, total: result.total });
});

app.delete("/api/supply/logs/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const deleted = await db.deleteSupplyLog(id);
  if (!deleted) {
    return res.status(404).json({ detail: "Supply log entry not found." });
  }
  res.json({ message: `Supply log #${id} deleted successfully.` });
});

// --- Reports & Analytics Routes ---
app.get("/api/reports/summary", async (req, res) => {
  const summary = await db.getReportsSummary();
  res.json(summary);
});

app.get("/api/reports/export", async (req, res) => {
  const reportType = ((req.query.report_type as string) || "readings") as "readings" | "alerts" | "supply";
  const csvContent = await db.getExportData(reportType);
  const filename = `smart_tank_${reportType}_report.csv`;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-cache");
  res.send(csvContent);
});

// --- AI Diagnostic & Operational Intelligence Routes ---
async function fetchSystemTelemetryContext(): Promise<SystemTelemetryContext> {
  const summary = await db.getReportsSummary();
  const latest = await db.getLatestSensorReading();
  const readingsRes = await db.getSensorReadings(1, 10);
  const alertsRes = await db.getAlerts(1, 5);
  const supplyLogsRes = await db.getSupplyLogs(1, 5);
  const supplyState = await db.getSupplyState();

  const currentSediment = latest ? latest.sediment_level : (summary.average_sediment || 0.0);
  const currentStatus = latest ? latest.status : "NORMAL";

  return {
    total_readings: summary.total_readings,
    current_sediment: currentSediment,
    average_sediment: summary.average_sediment,
    max_sediment: summary.max_sediment,
    min_sediment: summary.min_sediment,
    current_safe_limit: summary.current_safe_limit,
    current_status: currentStatus,
    current_supply_status: supplyState.status,
    control_mode: supplyState.control_mode,
    total_alerts: summary.total_alerts,
    unacknowledged_alerts: summary.unacknowledged_alerts,
    supply_shutoff_incidents: summary.supply_shutoff_incidents,
    compliance_rate_percent: summary.compliance_rate_percent,
    recent_readings: readingsRes.items.map(r => ({ sediment_level: r.sediment_level, timestamp: r.timestamp, status: r.status })),
    recent_alerts: alertsRes.items.map(a => ({ severity: a.severity, message: a.message, timestamp: a.timestamp, acknowledged: a.acknowledged })),
    recent_supply_logs: supplyLogsRes.items.map(s => ({ status: s.status, reason: s.reason, timestamp: s.timestamp }))
  };
}

app.post("/api/ai/diagnostics", async (req, res) => {
  try {
    const context = await fetchSystemTelemetryContext();
    const report = await generateAIDiagnosticReport(context);
    res.json(report);
  } catch (err: any) {
    console.error("Error in /api/ai/diagnostics:", err);
    res.status(500).json({ detail: err.message || "Failed to generate AI diagnostic report" });
  }
});

app.post("/api/ai/inquiry", async (req, res) => {
  try {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query) {
      return res.status(400).json({ detail: "A non-empty 'query' string is required." });
    }
    const context = await fetchSystemTelemetryContext();
    const result = await answerOperatorInquiry(query, context);
    res.json({
      query,
      answer: result.answer,
      source: result.source,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("Error in /api/ai/inquiry:", err);
    res.status(500).json({ detail: err.message || "Failed to process AI inquiry" });
  }
});

// --- Simulator Routes ---
app.get("/api/simulator/status", (req, res) => {
  res.json({
    is_running: simRunning,
    interval_seconds: simIntervalSeconds,
    current_sediment: simCurrentSediment,
    last_simulated_at: simLastSimulatedAt
  });
});

app.post("/api/simulator/toggle", (req, res) => {
  const reqEnable = req.body?.enable;
  const enable = typeof reqEnable === "boolean" ? reqEnable : !simRunning;

  if (enable && !simRunning) {
    simRunning = true;
    simTimer = setInterval(async () => {
      if (!simRunning) return;
      const delta = (Math.random() * 5.3) - 2.5; // range -2.5 to +2.8
      let updated = simCurrentSediment + delta;
      updated = Math.max(5.0, Math.min(95.0, updated));
      simCurrentSediment = Math.round(updated * 10) / 10;
      const reading = await processSensorReading(simCurrentSediment);
      simLastSimulatedAt = reading.timestamp;
    }, simIntervalSeconds * 1000);
  } else if (!enable && simRunning) {
    simRunning = false;
    if (simTimer) {
      clearInterval(simTimer);
      simTimer = null;
    }
  }

  res.json({
    is_running: simRunning,
    interval_seconds: simIntervalSeconds,
    current_sediment: simCurrentSediment,
    last_simulated_at: simLastSimulatedAt
  });
});

app.post("/api/simulator/inject", async (req, res) => {
  const { sediment_level } = req.body || {};
  if (typeof sediment_level !== "number" || isNaN(sediment_level) || sediment_level < 0 || sediment_level > 100) {
    return res.status(422).json({ detail: "Sediment level must be between 0 and 100" });
  }

  simCurrentSediment = sediment_level;
  const reading = await processSensorReading(sediment_level);
  simLastSimulatedAt = reading.timestamp;
  res.json(reading);
});

// =========================================================
// API 404 & ERROR HANDLING (Prevents falling through to HTML)
// =========================================================

app.all("/api/*", (req, res) => {
  res.status(404).json({ detail: `API route ${req.method} ${req.path} not found` });
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("Express unhandled error:", err);
  if (req.path.startsWith("/api")) {
    return res.status(500).json({ detail: err.message || "Internal server error" });
  }
  next(err);
});

// =========================================================
// FRONTEND STATIC FILES SERVING & PWA ROUTES
// =========================================================

const staticRoot = path.resolve(process.cwd());

// Service Worker with full root scope allowance and no-cache policy
app.get("/sw.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(staticRoot, "sw.js"));
});

// Web App Manifest
app.get("/manifest.json", (req, res) => {
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(path.join(staticRoot, "manifest.json"));
});

// App Icons
app.get("/icon.svg", (req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.sendFile(path.join(staticRoot, "icon.svg"));
});

app.get("/pwa-192x192.png", (req, res) => {
  res.setHeader("Content-Type", "image/png");
  res.sendFile(path.join(staticRoot, "pwa-192x192.png"));
});

app.get("/pwa-512x512.png", (req, res) => {
  res.setHeader("Content-Type", "image/png");
  res.sendFile(path.join(staticRoot, "pwa-512x512.png"));
});

app.get("/pwa-maskable-512x512.png", (req, res) => {
  res.setHeader("Content-Type", "image/png");
  res.sendFile(path.join(staticRoot, "pwa-maskable-512x512.png"));
});

app.get("/apple-touch-icon.png", (req, res) => {
  res.setHeader("Content-Type", "image/png");
  res.sendFile(path.join(staticRoot, "apple-touch-icon.png"));
});

app.get("/favicon.ico", (req, res) => {
  res.setHeader("Content-Type", "image/x-icon");
  res.sendFile(path.join(staticRoot, "favicon.ico"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(staticRoot, "index.html"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(staticRoot, "index.html"));
});

app.get("/style.css", (req, res) => {
  res.setHeader("Content-Type", "text/css; charset=utf-8");
  res.sendFile(path.join(staticRoot, "style.css"));
});

app.get("/script.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.sendFile(path.join(staticRoot, "script.js"));
});

app.use(express.static(staticRoot));

app.get("*", (req, res) => {
  res.sendFile(path.join(staticRoot, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SmartTank server running on http://0.0.0.0:${PORT}`);
  console.log(`Database status: ${isSupabaseConfigured() ? "Supabase PostgreSQL connected" : "Ready for Supabase PostgreSQL"}`);
});
