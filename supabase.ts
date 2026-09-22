import { createClient, SupabaseClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

export interface User {
  id: number;
  username: string;
  passwordHash: string;
  role: "admin" | "operator";
  fullName: string;
  createdAt: string;
}

export interface SensorReading {
  id: number;
  timestamp: string;
  sediment_level: number;
  limit_at_time: number;
  status: "NORMAL" | "WARNING" | "CRITICAL";
  supply_status: "ON" | "OFF";
}

export interface Alert {
  id: number;
  sensor_reading_id?: number | null;
  timestamp: string;
  sediment_level: number;
  limit_at_time: number;
  severity: string;
  message: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

export interface SupplyLog {
  id: number;
  sensor_reading_id?: number | null;
  timestamp: string;
  status: "ON" | "OFF";
  sediment_level: number;
  reason: string;
  triggered_by: string;
}

export interface SystemSettings {
  id: number;
  safe_limit: number;
  updated_at: string;
  updated_by: string;
}

export interface WaterSupplyState {
  id: number;
  status: "ON" | "OFF";
  control_mode: "AUTOMATIC" | "MANUAL";
  updated_at: string;
  updated_by: string;
}

// In-Memory Fallback Store (Ensures continuous operation & tests without hard external crash)
const inMemoryStore = {
  users: [
    {
      id: 1,
      username: "admin",
      passwordHash: bcrypt.hashSync("admin123", 10),
      role: "admin" as const,
      fullName: "System Administrator",
      createdAt: new Date().toISOString()
    },
    {
      id: 2,
      username: "operator",
      passwordHash: bcrypt.hashSync("operator123", 10),
      role: "operator" as const,
      fullName: "Tank Field Operator",
      createdAt: new Date().toISOString()
    }
  ],
  settings: {
    id: 1,
    safe_limit: 70.0,
    updated_at: new Date().toISOString(),
    updated_by: "system"
  },
  supplyState: {
    id: 1,
    status: "ON" as const,
    control_mode: "AUTOMATIC" as const,
    updated_at: new Date().toISOString(),
    updated_by: "system"
  },
  nextReadingId: 5,
  sensorReadings: [
    { id: 1, timestamp: new Date(Date.now() - 15 * 60000).toISOString(), sediment_level: 34.2, limit_at_time: 70.0, status: "NORMAL" as const, supply_status: "ON" as const },
    { id: 2, timestamp: new Date(Date.now() - 10 * 60000).toISOString(), sediment_level: 42.0, limit_at_time: 70.0, status: "NORMAL" as const, supply_status: "ON" as const },
    { id: 3, timestamp: new Date(Date.now() - 5 * 60000).toISOString(), sediment_level: 58.5, limit_at_time: 70.0, status: "WARNING" as const, supply_status: "ON" as const },
    { id: 4, timestamp: new Date(Date.now() - 1 * 60000).toISOString(), sediment_level: 62.0, limit_at_time: 70.0, status: "WARNING" as const, supply_status: "ON" as const }
  ],
  nextAlertId: 1,
  alerts: [] as Alert[],
  nextSupplyLogId: 2,
  supplyLogs: [
    {
      id: 1,
      timestamp: new Date().toISOString(),
      status: "ON" as const,
      sediment_level: 62.0,
      reason: "System initial startup - normal supply active",
      triggered_by: "AUTOMATIC"
    }
  ]
};

// Supabase client instance lazy loader
let supabaseInstance: SupabaseClient | null = null;
let supabaseInitialized = false;

export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  return Boolean(url && key && url.trim().length > 0 && key.trim().length > 0);
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!supabaseInstance && !supabaseInitialized) {
    supabaseInitialized = true;
    const rawUrl = process.env.SUPABASE_URL!.trim();
    // Normalize url by stripping any accidental /rest/v1 or trailing slashes
    const url = rawUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY)!.trim();
    try {
      supabaseInstance = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
      console.log(`[Supabase] Initialized client for ${url}`);
      // Migrate existing records to Supabase asynchronously
      migrateExistingDataToSupabase(supabaseInstance).catch(e => {
        console.warn("[Supabase] Auto-migration notice:", e.message || e);
      });
    } catch (err) {
      console.error("[Supabase] Failed to initialize Supabase client:", err);
      supabaseInstance = null;
    }
  }

  return supabaseInstance;
}

/**
 * Ensures any existing baseline records (users, settings, supply state, telemetry, logs)
 * are migrated into the connected Supabase tables without data loss.
 */
export async function migrateExistingDataToSupabase(client: SupabaseClient): Promise<void> {
  try {
    // 1. Ensure system_settings has singleton row
    const { count: settingsCount } = await client.from("system_settings").select("*", { count: "exact", head: true });
    if (settingsCount === 0 || settingsCount === null) {
      await client.from("system_settings").upsert({
        id: inMemoryStore.settings.id,
        safe_limit: inMemoryStore.settings.safe_limit,
        updated_at: inMemoryStore.settings.updated_at,
        updated_by: inMemoryStore.settings.updated_by
      });
    }

    // 2. Ensure water_supply_state has singleton row
    const { count: supplyStateCount } = await client.from("water_supply_state").select("*", { count: "exact", head: true });
    if (supplyStateCount === 0 || supplyStateCount === null) {
      await client.from("water_supply_state").upsert({
        id: inMemoryStore.supplyState.id,
        status: inMemoryStore.supplyState.status,
        control_mode: inMemoryStore.supplyState.control_mode,
        updated_at: inMemoryStore.supplyState.updated_at,
        updated_by: inMemoryStore.supplyState.updated_by
      });
    }

    // 3. Ensure users are seeded
    const { count: userCount } = await client.from("users").select("*", { count: "exact", head: true });
    if (userCount === 0 || userCount === null) {
      for (const u of inMemoryStore.users) {
        await client.from("users").upsert({
          id: u.id,
          username: u.username,
          password_hash: u.passwordHash,
          role: u.role,
          full_name: u.fullName,
          created_at: u.createdAt
        });
      }
    }

    // 4. Ensure initial sensor readings exist
    const { count: readingsCount } = await client.from("sensor_readings").select("*", { count: "exact", head: true });
    if (readingsCount === 0 || readingsCount === null) {
      const readingsToInsert = inMemoryStore.sensorReadings.map(r => ({
        timestamp: r.timestamp,
        sediment_level: r.sediment_level,
        limit_at_time: r.limit_at_time,
        status: r.status,
        supply_status: r.supply_status
      }));
      if (readingsToInsert.length > 0) {
        await client.from("sensor_readings").insert(readingsToInsert);
      }
    }

    // 5. Ensure initial supply logs exist
    const { count: supplyLogsCount } = await client.from("supply_logs").select("*", { count: "exact", head: true });
    if (supplyLogsCount === 0 || supplyLogsCount === null) {
      const logsToInsert = inMemoryStore.supplyLogs.map(l => ({
        timestamp: l.timestamp,
        status: l.status,
        sediment_level: l.sediment_level,
        reason: l.reason,
        triggered_by: l.triggered_by
      }));
      if (logsToInsert.length > 0) {
        await client.from("supply_logs").insert(logsToInsert);
      }
    }
  } catch (err: any) {
    console.warn("[Supabase] Data migration warning (tables may need to be created first using supabase_schema.sql):", err.message || err);
  }
}

export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  type: string;
  supabaseConfigured: boolean;
  message: string;
}> {
  const configured = isSupabaseConfigured();
  if (!configured) {
    return {
      connected: true,
      type: "In-Memory PostgreSQL Cache (Ready for Supabase)",
      supabaseConfigured: false,
      message: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to connect live Supabase project."
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      connected: false,
      type: "Supabase PostgreSQL",
      supabaseConfigured: true,
      message: "Failed to initialize Supabase client."
    };
  }

  try {
    const { data, error } = await client.from("system_settings").select("*").limit(1);
    if (error) {
      if (error.code === "PGRST205" || (error.message && error.message.includes("schema cache"))) {
        return {
          connected: true,
          type: "Supabase PostgreSQL (Connected - Schema Pending)",
          supabaseConfigured: true,
          message: "Connected to Supabase. Run supabase_schema.sql in Supabase SQL Editor to initialize tables."
        };
      }
      return {
        connected: false,
        type: "Supabase PostgreSQL",
        supabaseConfigured: true,
        message: `Supabase query returned error: ${error.message}. Ensure supabase_schema.sql has been run.`
      };
    }
    return {
      connected: true,
      type: "Supabase PostgreSQL",
      supabaseConfigured: true,
      message: "Connected to Supabase PostgreSQL database."
    };
  } catch (err: any) {
    return {
      connected: false,
      type: "Supabase PostgreSQL",
      supabaseConfigured: true,
      message: `Connection error: ${err.message || String(err)}`
    };
  }
}

// =========================================================
// DATA ACCESS LAYER (REPOSITORY)
// =========================================================

export const db = {
  // --- Users ---
  async getUserByUsername(username: string): Promise<User | null> {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("users")
          .select("*")
          .eq("username", username)
          .single();

        if (!error && data) {
          return {
            id: data.id,
            username: data.username,
            passwordHash: data.password_hash,
            role: data.role,
            fullName: data.full_name,
            createdAt: data.created_at
          };
        }
      } catch (err) {
        console.warn("[Supabase] Users lookup fallback to cache:", err);
      }
    }

    const local = inMemoryStore.users.find(u => u.username === username);
    return local || null;
  },

  // --- System Settings ---
  async getSafeLimit(): Promise<SystemSettings> {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("system_settings")
          .select("*")
          .eq("id", 1)
          .single();

        if (!error && data) {
          inMemoryStore.settings.safe_limit = data.safe_limit;
          inMemoryStore.settings.updated_at = data.updated_at;
          inMemoryStore.settings.updated_by = data.updated_by;
          return data;
        }
      } catch (err) {
        console.warn("[Supabase] Settings lookup fallback to cache:", err);
      }
    }
    return inMemoryStore.settings;
  },

  async updateSafeLimit(limit: number, updatedBy: string): Promise<SystemSettings> {
    const now = new Date().toISOString();
    inMemoryStore.settings.safe_limit = limit;
    inMemoryStore.settings.updated_at = now;
    inMemoryStore.settings.updated_by = updatedBy;

    const client = getSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("system_settings")
          .upsert({
            id: 1,
            safe_limit: limit,
            updated_at: now,
            updated_by: updatedBy
          })
          .select()
          .single();

        if (!error && data) {
          return data;
        }
      } catch (err) {
        console.warn("[Supabase] Update safe limit error, saved to cache:", err);
      }
    }

    return inMemoryStore.settings;
  },

  // --- Water Supply State ---
  async getSupplyState(): Promise<WaterSupplyState> {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("water_supply_state")
          .select("*")
          .eq("id", 1)
          .single();

        if (!error && data) {
          inMemoryStore.supplyState.status = data.status;
          inMemoryStore.supplyState.control_mode = data.control_mode;
          inMemoryStore.supplyState.updated_at = data.updated_at;
          inMemoryStore.supplyState.updated_by = data.updated_by;
          return data;
        }
      } catch (err) {
        console.warn("[Supabase] Supply state lookup fallback to cache:", err);
      }
    }
    return inMemoryStore.supplyState;
  },

  async updateSupplyState(status: "ON" | "OFF", controlMode: "AUTOMATIC" | "MANUAL", updatedBy: string): Promise<WaterSupplyState> {
    const now = new Date().toISOString();
    inMemoryStore.supplyState.status = status;
    inMemoryStore.supplyState.control_mode = controlMode;
    inMemoryStore.supplyState.updated_at = now;
    inMemoryStore.supplyState.updated_by = updatedBy;

    const client = getSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("water_supply_state")
          .upsert({
            id: 1,
            status,
            control_mode: controlMode,
            updated_at: now,
            updated_by: updatedBy
          })
          .select()
          .single();

        if (!error && data) {
          return data;
        }
      } catch (err) {
        console.warn("[Supabase] Update supply state error, saved to cache:", err);
      }
    }
    return inMemoryStore.supplyState;
  },

  // --- Supply Logs ---
  async addSupplyLog(log: Omit<SupplyLog, "id">): Promise<SupplyLog> {
    const localEntry: SupplyLog = {
      id: inMemoryStore.nextSupplyLogId++,
      ...log
    };
    inMemoryStore.supplyLogs.push(localEntry);

    const client = getSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("supply_logs")
          .insert({
            sensor_reading_id: log.sensor_reading_id ?? null,
            timestamp: log.timestamp,
            status: log.status,
            sediment_level: log.sediment_level,
            reason: log.reason,
            triggered_by: log.triggered_by
          })
          .select()
          .single();

        if (!error && data) {
          localEntry.id = data.id;
          return data;
        }
      } catch (err) {
        console.warn("[Supabase] Add supply log error, kept in cache:", err);
      }
    }
    return localEntry;
  },

  async getLatestSupplyLog(): Promise<SupplyLog | null> {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("supply_logs")
          .select("*")
          .order("id", { ascending: false })
          .limit(1)
          .single();

        if (!error && data) {
          return data;
        }
      } catch (err) {
        // fallback
      }
    }
    const len = inMemoryStore.supplyLogs.length;
    return len > 0 ? inMemoryStore.supplyLogs[len - 1] : null;
  },

  async getSupplyLogs(page = 1, size = 50, search = ""): Promise<{ items: SupplyLog[]; total: number }> {
    const client = getSupabaseClient();
    if (client) {
      try {
        let query = client.from("supply_logs").select("*", { count: "exact" });
        if (search) {
          query = query.or(`reason.ilike.%${search}%,status.ilike.%${search}%,triggered_by.ilike.%${search}%`);
        }
        const from = (page - 1) * size;
        const to = from + size - 1;
        const { data, count, error } = await query
          .order("id", { ascending: false })
          .range(from, to);

        if (!error && data) {
          return { items: data, total: count || 0 };
        }
      } catch (err) {
        console.warn("[Supabase] Query supply logs fallback to cache:", err);
      }
    }

    let filtered = [...inMemoryStore.supplyLogs].reverse();
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(l =>
        l.reason.toLowerCase().includes(q) ||
        l.status.toLowerCase().includes(q) ||
        l.triggered_by.toLowerCase().includes(q) ||
        l.timestamp.toLowerCase().includes(q)
      );
    }
    const total = filtered.length;
    const offset = (page - 1) * size;
    return { items: filtered.slice(offset, offset + size), total };
  },

  async deleteSupplyLog(id: number): Promise<boolean> {
    const client = getSupabaseClient();
    if (client) {
      try {
        await client.from("supply_logs").delete().eq("id", id);
      } catch (err) {
        console.warn("[Supabase] Delete supply log error:", err);
      }
    }
    const idx = inMemoryStore.supplyLogs.findIndex(l => l.id === id);
    if (idx !== -1) {
      inMemoryStore.supplyLogs.splice(idx, 1);
      return true;
    }
    return false;
  },

  // --- Sensor Readings ---
  async addSensorReading(reading: Omit<SensorReading, "id">): Promise<SensorReading> {
    const localReading: SensorReading = {
      id: inMemoryStore.nextReadingId++,
      ...reading
    };
    inMemoryStore.sensorReadings.push(localReading);

    const client = getSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("sensor_readings")
          .insert({
            timestamp: reading.timestamp,
            sediment_level: reading.sediment_level,
            limit_at_time: reading.limit_at_time,
            status: reading.status,
            supply_status: reading.supply_status
          })
          .select()
          .single();

        if (!error && data) {
          localReading.id = data.id;
          return data;
        }
      } catch (err) {
        console.warn("[Supabase] Add sensor reading error, saved to cache:", err);
      }
    }

    return localReading;
  },

  async getLatestSensorReading(): Promise<SensorReading | null> {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("sensor_readings")
          .select("*")
          .order("id", { ascending: false })
          .limit(1)
          .single();

        if (!error && data) {
          return data;
        }
      } catch (err) {
        // fallback
      }
    }
    const len = inMemoryStore.sensorReadings.length;
    return len > 0 ? inMemoryStore.sensorReadings[len - 1] : null;
  },

  async getSensorReadings(page = 1, size = 25, status?: string, search?: string): Promise<{ items: SensorReading[]; total: number }> {
    const client = getSupabaseClient();
    if (client) {
      try {
        let query = client.from("sensor_readings").select("*", { count: "exact" });
        if (status && status !== "ALL") {
          query = query.eq("status", status.toUpperCase());
        }
        if (search) {
          query = query.or(`status.ilike.%${search}%,supply_status.ilike.%${search}%`);
        }
        const from = (page - 1) * size;
        const to = from + size - 1;
        const { data, count, error } = await query
          .order("id", { ascending: false })
          .range(from, to);

        if (!error && data) {
          return { items: data, total: count || 0 };
        }
      } catch (err) {
        console.warn("[Supabase] Query sensor readings fallback to cache:", err);
      }
    }

    let filtered = [...inMemoryStore.sensorReadings].reverse();
    if (status && status !== "ALL") {
      filtered = filtered.filter(r => r.status === status.toUpperCase());
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r =>
        r.timestamp.toLowerCase().includes(q) ||
        r.sediment_level.toString().includes(q) ||
        r.status.toLowerCase().includes(q) ||
        r.supply_status.toLowerCase().includes(q)
      );
    }

    const total = filtered.length;
    const offset = (page - 1) * size;
    return { items: filtered.slice(offset, offset + size), total };
  },

  async deleteSensorReading(id: number): Promise<boolean> {
    const client = getSupabaseClient();
    if (client) {
      try {
        await client.from("sensor_readings").delete().eq("id", id);
      } catch (err) {
        console.warn("[Supabase] Delete sensor reading error:", err);
      }
    }
    const idx = inMemoryStore.sensorReadings.findIndex(r => r.id === id);
    if (idx !== -1) {
      inMemoryStore.sensorReadings.splice(idx, 1);
      return true;
    }
    return false;
  },

  async clearSensorReadings(): Promise<number> {
    const count = inMemoryStore.sensorReadings.length;
    const client = getSupabaseClient();
    if (client) {
      try {
        await client.from("sensor_readings").delete().neq("id", 0);
      } catch (err) {
        console.warn("[Supabase] Clear sensor readings error:", err);
      }
    }
    inMemoryStore.sensorReadings.length = 0;
    return count;
  },

  // --- Alerts ---
  async addAlert(alert: Omit<Alert, "id">): Promise<Alert> {
    const localAlert: Alert = {
      id: inMemoryStore.nextAlertId++,
      ...alert
    };
    inMemoryStore.alerts.push(localAlert);

    const client = getSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("alerts")
          .insert({
            sensor_reading_id: alert.sensor_reading_id ?? null,
            timestamp: alert.timestamp,
            sediment_level: alert.sediment_level,
            limit_at_time: alert.limit_at_time,
            severity: alert.severity,
            message: alert.message,
            acknowledged: alert.acknowledged,
            acknowledged_at: alert.acknowledged_at,
            acknowledged_by: alert.acknowledged_by
          })
          .select()
          .single();

        if (!error && data) {
          localAlert.id = data.id;
          return data;
        }
      } catch (err) {
        console.warn("[Supabase] Add alert error, saved to cache:", err);
      }
    }

    return localAlert;
  },

  async getAlerts(page = 1, size = 50, severity?: string, search?: string): Promise<{ items: Alert[]; total: number; unacknowledged_count: number }> {
    const client = getSupabaseClient();
    if (client) {
      try {
        let query = client.from("alerts").select("*", { count: "exact" });
        if (severity && severity !== "ALL") {
          query = query.eq("severity", severity.toUpperCase());
        }
        if (search) {
          query = query.or(`message.ilike.%${search}%,severity.ilike.%${search}%`);
        }
        const from = (page - 1) * size;
        const to = from + size - 1;
        const { data, count, error } = await query
          .order("id", { ascending: false })
          .range(from, to);

        if (!error && data) {
          // Count unacknowledged
          const { count: unackCount } = await client
            .from("alerts")
            .select("*", { count: "exact", head: true })
            .eq("acknowledged", false);

          return {
            items: data,
            total: count || 0,
            unacknowledged_count: unackCount || 0
          };
        }
      } catch (err) {
        console.warn("[Supabase] Query alerts fallback to cache:", err);
      }
    }

    let filtered = [...inMemoryStore.alerts].reverse();
    if (severity && severity !== "ALL") {
      filtered = filtered.filter(a => a.severity.toUpperCase() === severity.toUpperCase());
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(a =>
        a.message.toLowerCase().includes(q) ||
        a.timestamp.toLowerCase().includes(q) ||
        a.sediment_level.toString().includes(q)
      );
    }
    const unacknowledged_count = inMemoryStore.alerts.filter(a => !a.acknowledged).length;
    const total = filtered.length;
    const offset = (page - 1) * size;
    return {
      items: filtered.slice(offset, offset + size),
      total,
      unacknowledged_count
    };
  },

  async getUnacknowledgedAlertsCount(): Promise<number> {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { count, error } = await client
          .from("alerts")
          .select("*", { count: "exact", head: true })
          .eq("acknowledged", false);
        if (!error && typeof count === "number") {
          return count;
        }
      } catch (err) {
        // fallback
      }
    }
    return inMemoryStore.alerts.filter(a => !a.acknowledged).length;
  },

  async acknowledgeAlert(id: number, acknowledgedBy: string): Promise<boolean> {
    const now = new Date().toISOString();
    const client = getSupabaseClient();
    if (client) {
      try {
        await client
          .from("alerts")
          .update({
            acknowledged: true,
            acknowledged_at: now,
            acknowledged_by: acknowledgedBy
          })
          .eq("id", id);
      } catch (err) {
        console.warn("[Supabase] Acknowledge alert error:", err);
      }
    }

    const alert = inMemoryStore.alerts.find(a => a.id === id);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledged_at = now;
      alert.acknowledged_by = acknowledgedBy;
      return true;
    }
    return false;
  },

  async deleteAlert(id: number): Promise<boolean> {
    const client = getSupabaseClient();
    if (client) {
      try {
        await client.from("alerts").delete().eq("id", id);
      } catch (err) {
        console.warn("[Supabase] Delete alert error:", err);
      }
    }
    const idx = inMemoryStore.alerts.findIndex(a => a.id === id);
    if (idx !== -1) {
      inMemoryStore.alerts.splice(idx, 1);
      return true;
    }
    return false;
  },

  // --- Reports & Analytics ---
  async getReportsSummary(): Promise<{
    total_readings: number;
    average_sediment: number;
    max_sediment: number;
    min_sediment: number;
    total_alerts: number;
    unacknowledged_alerts: number;
    supply_shutoff_incidents: number;
    compliance_rate_percent: number;
    current_safe_limit: number;
    current_supply_status: "ON" | "OFF";
  }> {
    const settings = await this.getSafeLimit();
    const supply = await this.getSupplyState();
    const client = getSupabaseClient();

    if (client) {
      try {
        const { data: readings, error: readErr } = await client
          .from("sensor_readings")
          .select("sediment_level");
        const { count: alertsCount } = await client
          .from("alerts")
          .select("*", { count: "exact", head: true });
        const { count: unackCount } = await client
          .from("alerts")
          .select("*", { count: "exact", head: true })
          .eq("acknowledged", false);
        const { count: shutoffCount } = await client
          .from("supply_logs")
          .select("*", { count: "exact", head: true })
          .eq("status", "OFF");

        if (!readErr && readings) {
          const total = readings.length;
          let sum = 0;
          let max = total > 0 ? -Infinity : 0;
          let min = total > 0 ? Infinity : 0;
          let compliant = 0;

          for (const r of readings) {
            sum += r.sediment_level;
            if (r.sediment_level > max) max = r.sediment_level;
            if (r.sediment_level < min) min = r.sediment_level;
            if (r.sediment_level <= settings.safe_limit) compliant++;
          }

          const avg = total > 0 ? Math.round((sum / total) * 100) / 100 : 0.0;
          const complianceRate = total > 0 ? Math.round((compliant / total * 100) * 100) / 100 : 100.0;

          return {
            total_readings: total,
            average_sediment: avg,
            max_sediment: max === -Infinity ? 0.0 : max,
            min_sediment: min === Infinity ? 0.0 : min,
            total_alerts: alertsCount || 0,
            unacknowledged_alerts: unackCount || 0,
            supply_shutoff_incidents: shutoffCount || 0,
            compliance_rate_percent: complianceRate,
            current_safe_limit: settings.safe_limit,
            current_supply_status: supply.status
          };
        }
      } catch (err) {
        console.warn("[Supabase] Reports summary fallback to cache:", err);
      }
    }

    // Local fallback calculation
    const totalReadings = inMemoryStore.sensorReadings.length;
    let sumSediment = 0;
    let maxSediment = totalReadings > 0 ? -Infinity : 0.0;
    let minSediment = totalReadings > 0 ? Infinity : 0.0;
    let compliantCount = 0;

    for (const r of inMemoryStore.sensorReadings) {
      sumSediment += r.sediment_level;
      if (r.sediment_level > maxSediment) maxSediment = r.sediment_level;
      if (r.sediment_level < minSediment) minSediment = r.sediment_level;
      if (r.sediment_level <= settings.safe_limit) compliantCount++;
    }

    const avgSediment = totalReadings > 0 ? Math.round((sumSediment / totalReadings) * 100) / 100 : 0.0;
    const complianceRate = totalReadings > 0 ? Math.round((compliantCount / totalReadings * 100) * 100) / 100 : 100.0;
    const shutoffCount = inMemoryStore.supplyLogs.filter(l => l.status === "OFF").length;

    return {
      total_readings: totalReadings,
      average_sediment: avgSediment,
      max_sediment: maxSediment === -Infinity ? 0.0 : maxSediment,
      min_sediment: minSediment === Infinity ? 0.0 : minSediment,
      total_alerts: inMemoryStore.alerts.length,
      unacknowledged_alerts: inMemoryStore.alerts.filter(a => !a.acknowledged).length,
      supply_shutoff_incidents: shutoffCount,
      compliance_rate_percent: complianceRate,
      current_safe_limit: settings.safe_limit,
      current_supply_status: supply.status
    };
  },

  // --- Export Data ---
  async getExportData(reportType: "readings" | "alerts" | "supply"): Promise<string> {
    const client = getSupabaseClient();

    if (reportType === "readings") {
      let readings = inMemoryStore.sensorReadings;
      if (client) {
        try {
          const { data } = await client
            .from("sensor_readings")
            .select("*")
            .order("id", { ascending: false });
          if (data && data.length > 0) readings = data;
        } catch (e) {
          // fallback
        }
      }
      let csv = "ID,Timestamp (UTC),Sediment Level (%),Safe Limit (%),Status,Water Supply\r\n";
      const reversed = [...readings].reverse();
      for (const r of reversed) {
        csv += `${r.id},"${r.timestamp}",${r.sediment_level},${r.limit_at_time},${r.status},${r.supply_status}\r\n`;
      }
      return csv;
    }

    if (reportType === "alerts") {
      let alertsList = inMemoryStore.alerts;
      if (client) {
        try {
          const { data } = await client
            .from("alerts")
            .select("*")
            .order("id", { ascending: false });
          if (data && data.length > 0) alertsList = data;
        } catch (e) {
          // fallback
        }
      }
      let csv = "ID,Timestamp (UTC),Sediment Level (%),Limit at Time (%),Severity,Message,Acknowledged,Acknowledged At,Acknowledged By\r\n";
      const reversed = [...alertsList].reverse();
      for (const a of reversed) {
        const ack = a.acknowledged ? "YES" : "NO";
        const ackAt = a.acknowledged_at || "";
        const ackBy = a.acknowledged_by || "";
        csv += `${a.id},"${a.timestamp}",${a.sediment_level},${a.limit_at_time},${a.severity},"${a.message.replace(/"/g, '""')}",${ack},"${ackAt}","${ackBy}"\r\n`;
      }
      return csv;
    }

    if (reportType === "supply") {
      let logs = inMemoryStore.supplyLogs;
      if (client) {
        try {
          const { data } = await client
            .from("supply_logs")
            .select("*")
            .order("id", { ascending: false });
          if (data && data.length > 0) logs = data;
        } catch (e) {
          // fallback
        }
      }
      let csv = "ID,Timestamp (UTC),Water Supply Status,Sediment Level (%),Reason,Triggered By\r\n";
      const reversed = [...logs].reverse();
      for (const l of reversed) {
        csv += `${l.id},"${l.timestamp}",${l.status},${l.sediment_level},"${l.reason.replace(/"/g, '""')}",${l.triggered_by}\r\n`;
      }
      return csv;
    }

    return "";
  }
};
