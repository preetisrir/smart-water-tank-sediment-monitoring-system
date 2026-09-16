-- ====================================================================
-- SmartTank: Sediment Monitoring & Automatic Water Supply Control
-- Supabase PostgreSQL Database Schema
-- ====================================================================

-- 1. Create Tables

-- Users Table (Role-based access: Admin & Operator)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
    full_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- System Settings Table (Singleton holding safe sediment threshold)
CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    safe_limit DOUBLE PRECISION NOT NULL DEFAULT 70.0 CHECK (safe_limit >= 1.0 AND safe_limit <= 100.0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(50) NOT NULL DEFAULT 'system',
    CONSTRAINT single_system_settings_row CHECK (id = 1)
);

-- Water Supply State Table (Singleton tracking live valve/supply state)
CREATE TABLE IF NOT EXISTS water_supply_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    status VARCHAR(10) NOT NULL DEFAULT 'ON' CHECK (status IN ('ON', 'OFF')),
    control_mode VARCHAR(20) NOT NULL DEFAULT 'AUTOMATIC' CHECK (control_mode IN ('AUTOMATIC', 'MANUAL')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(50) NOT NULL DEFAULT 'system',
    CONSTRAINT single_supply_state_row CHECK (id = 1)
);

-- Sensor Readings Table (Continuous time-series telemetry)
CREATE TABLE IF NOT EXISTS sensor_readings (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sediment_level DOUBLE PRECISION NOT NULL CHECK (sediment_level >= 0.0 AND sediment_level <= 100.0),
    limit_at_time DOUBLE PRECISION NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('NORMAL', 'WARNING', 'CRITICAL')),
    supply_status VARCHAR(10) NOT NULL CHECK (supply_status IN ('ON', 'OFF'))
);

-- Alerts Table (Critical sediment breach incidents)
CREATE TABLE IF NOT EXISTS alerts (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sediment_level DOUBLE PRECISION NOT NULL,
    limit_at_time DOUBLE PRECISION NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'CRITICAL' CHECK (severity IN ('CRITICAL', 'WARNING', 'INFO')),
    message TEXT NOT NULL,
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(50)
);

-- Supply Logs Table (Audit trail of every valve change & automated shutoff)
CREATE TABLE IF NOT EXISTS supply_logs (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(10) NOT NULL CHECK (status IN ('ON', 'OFF')),
    sediment_level DOUBLE PRECISION NOT NULL,
    reason TEXT NOT NULL,
    triggered_by VARCHAR(50) NOT NULL
);

-- 2. Indexes for High Performance Queries
CREATE INDEX IF NOT EXISTS idx_sensor_readings_timestamp ON sensor_readings (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_status ON sensor_readings (status);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts (acknowledged);
CREATE INDEX IF NOT EXISTS idx_supply_logs_timestamp ON supply_logs (timestamp DESC);

-- 3. Default Seed Data

-- Initial Users (Passwords: admin123, operator123)
-- bcrypt hash for 'admin123': $2a$10$wT0E2w2TjV3i9Fq8XkC6x.6x7gQWqTf7rU/KkO2l/B6R9tP6O8E0m (or generated dynamically)
INSERT INTO users (id, username, password_hash, role, full_name)
VALUES 
    (1, 'admin', '$2a$10$k1gq7T6oHhU6o1wG0qH3hO5hYp1F9f1J8qY8wL1r0kH5jK7mN9p2q', 'admin', 'System Administrator'),
    (2, 'operator', '$2a$10$k1gq7T6oHhU6o1wG0qH3hO5hYp1F9f1J8qY8wL1r0kH5jK7mN9p2q', 'operator', 'Tank Field Operator')
ON CONFLICT (id) DO NOTHING;

-- Initial Settings
INSERT INTO system_settings (id, safe_limit, updated_at, updated_by)
VALUES (1, 70.0, NOW(), 'system')
ON CONFLICT (id) DO NOTHING;

-- Initial Supply State
INSERT INTO water_supply_state (id, status, control_mode, updated_at, updated_by)
VALUES (1, 'ON', 'AUTOMATIC', NOW(), 'system')
ON CONFLICT (id) DO NOTHING;

-- Initial Supply Log
INSERT INTO supply_logs (timestamp, status, sediment_level, reason, triggered_by)
VALUES (NOW(), 'ON', 62.0, 'System initial startup - normal supply active', 'AUTOMATIC')
ON CONFLICT DO NOTHING;

-- Initial Baseline Readings
INSERT INTO sensor_readings (timestamp, sediment_level, limit_at_time, status, supply_status)
VALUES 
    (NOW() - INTERVAL '15 minutes', 34.2, 70.0, 'NORMAL', 'ON'),
    (NOW() - INTERVAL '10 minutes', 42.0, 70.0, 'NORMAL', 'ON'),
    (NOW() - INTERVAL '5 minutes', 58.5, 70.0, 'WARNING', 'ON'),
    (NOW() - INTERVAL '1 minute', 62.0, 70.0, 'WARNING', 'ON')
ON CONFLICT DO NOTHING;

-- 4. Enable Row Level Security (RLS) with Public Read / Service Role Access
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_supply_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply_logs ENABLE ROW LEVEL SECURITY;

-- Allow anon/service role policies for backend API access
CREATE POLICY "Allow all access to system_settings" ON system_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to water_supply_state" ON water_supply_state FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to sensor_readings" ON sensor_readings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to alerts" ON alerts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to supply_logs" ON supply_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow read on users" ON users FOR SELECT USING (true);
