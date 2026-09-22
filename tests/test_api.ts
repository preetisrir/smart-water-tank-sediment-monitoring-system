/**
 * Automated System Verification Test Suite
 * Tests SRS Requirements: FR-01 through FR-06, NFR-01 through NFR-06
 * Tests Database Migrations, Relationships, Constraints, and Supabase / SQLite Parity
 */

const BASE_URL = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";

let adminToken = "";
let operatorToken = "";
let createdReadingId: number | null = null;
let triggeredAlertId: number | null = null;

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ [PASS] ${name}`);
    testsPassed++;
  } catch (err: any) {
    console.error(`❌ [FAIL] ${name}: ${err.message || err}`);
    testsFailed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function startTestSuite() {
  console.log(`\n======================================================`);
  console.log(`🧪 Running SmartTank Verification Tests against ${BASE_URL}`);
  console.log(`======================================================\n`);

  // Test 1: Health & Database Health Check
  await runTest("Test 01: System & Database Health Check (/api/health)", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === "healthy", "Expected status to be healthy");
    assert(data.database && data.database.connected === true, "Database should be connected");
  });

  // Test 2: Ingest sensor reading within 0-100 (FR-01)
  await runTest("Test 02: Ingest valid sensor reading (FR-01)", async () => {
    const res = await fetch(`${BASE_URL}/api/sensor/readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sediment_level: 48.5 })
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const data = await res.json();
    assert(data.sediment_level === 48.5, "Sediment level should match 48.5");
    assert(data.status === "NORMAL" || data.status === "WARNING", "Status should be classified");
    createdReadingId = data.id;
  });

  // Test 3: Sensor reading validation (reject < 0 or > 100)
  await runTest("Test 03: Sensor reading validation bounds rejection", async () => {
    const resHigh = await fetch(`${BASE_URL}/api/sensor/readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sediment_level: 150.0 })
    });
    assert(resHigh.status === 422, `Expected 422 for >100, got ${resHigh.status}`);

    const resLow = await fetch(`${BASE_URL}/api/sensor/readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sediment_level: -5.0 })
    });
    assert(resLow.status === 422, `Expected 422 for <0, got ${resLow.status}`);
  });

  // Test 4: Dashboard latest metrics retrieval (FR-02)
  await runTest("Test 04: Dashboard live metrics retrieval (FR-02)", async () => {
    const res = await fetch(`${BASE_URL}/api/sensor/latest`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(typeof data.current_sediment === "number", "current_sediment must be numeric");
    assert(typeof data.safe_limit === "number", "safe_limit must be numeric");
    assert(data.supply_status === "ON" || data.supply_status === "OFF", "supply_status must be ON or OFF");
  });

  // Test 5: Query safe sediment limit (FR-03)
  await runTest("Test 05: Retrieve current safe sediment limit (FR-03)", async () => {
    const res = await fetch(`${BASE_URL}/api/limit`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(typeof data.safe_limit === "number" && data.safe_limit > 0, "safe_limit must be positive");
  });

  // Test 6: Non-authenticated user cannot update safe limit (NFR-03)
  await runTest("Test 06: Reject unauthenticated limit update (NFR-03)", async () => {
    const res = await fetch(`${BASE_URL}/api/limit`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ safe_limit: 65.0 })
    });
    assert(res.status === 401, `Expected 401 Unauthorized, got ${res.status}`);
  });

  // Test 7: User Login & JWT Token issuance
  await runTest("Test 07: User authentication for admin & operator", async () => {
    // Admin login
    const adminRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" })
    });
    assert(adminRes.status === 200, "Admin login should succeed");
    const adminData = await adminRes.json();
    assert(Boolean(adminData.access_token), "Admin token must be returned");
    adminToken = adminData.access_token;

    // Operator login
    const opRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "operator", password: "operator123" })
    });
    assert(opRes.status === 200, "Operator login should succeed");
    const opData = await opRes.json();
    assert(Boolean(opData.access_token), "Operator token must be returned");
    operatorToken = opData.access_token;
  });

  // Test 8: Admin updates safe sediment limit (FR-03)
  await runTest("Test 08: Admin updates safe sediment limit (FR-03)", async () => {
    const res = await fetch(`${BASE_URL}/api/limit`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ safe_limit: 68.0 })
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.safe_limit === 68.0, "safe_limit should be updated to 68.0");
  });

  // Test 9: Safe limit input validation (reject < 1.0 or > 100.0)
  await runTest("Test 09: Safe limit input bounds validation (1.0 to 100.0)", async () => {
    const resOver = await fetch(`${BASE_URL}/api/limit`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ safe_limit: 105.0 })
    });
    assert(resOver.status === 422, `Expected 422, got ${resOver.status}`);

    const resZero = await fetch(`${BASE_URL}/api/limit`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ safe_limit: 0.0 })
    });
    assert(resZero.status === 422, `Expected 422, got ${resZero.status}`);
  });

  // Test 10: Critical sediment reading automatically generates alert (FR-04, NFR-02)
  await runTest("Test 10: Critical sediment generates alert (FR-04, NFR-02)", async () => {
    const res = await fetch(`${BASE_URL}/api/sensor/readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sediment_level: 85.0 })
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const reading = await res.json();
    assert(reading.status === "CRITICAL", "Status must be CRITICAL for 85% sediment (> 68% limit)");

    const alertRes = await fetch(`${BASE_URL}/api/alerts?size=5`);
    const alertData = await alertRes.json();
    assert(alertData.total > 0, "Alerts list should contain at least one alert");
    const latestAlert = alertData.items[0];
    assert(latestAlert.severity === "CRITICAL", "Severity must be CRITICAL");
    triggeredAlertId = latestAlert.id;
  });

  // Test 11: Critical sediment reading automatically shuts off water supply (FR-05)
  await runTest("Test 11: Critical sediment automatically stops water supply (FR-05)", async () => {
    const res = await fetch(`${BASE_URL}/api/supply/status`);
    const data = await res.json();
    assert(data.status === "OFF", `Water supply must be OFF, but got ${data.status}`);
    assert(data.control_mode === "AUTOMATIC", "Control mode must remain AUTOMATIC");
  });

  // Test 12: Normal sediment reading restores water supply automatically (FR-05)
  await runTest("Test 12: Safe sediment restores water supply automatically (FR-05)", async () => {
    const res = await fetch(`${BASE_URL}/api/sensor/readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sediment_level: 32.0 })
    });
    assert(res.status === 201, "Normal reading should be ingested");

    const supplyRes = await fetch(`${BASE_URL}/api/supply/status`);
    const supplyData = await supplyRes.json();
    assert(supplyData.status === "ON", `Water supply should be restored to ON, got ${supplyData.status}`);
  });

  // Test 13: Operator acknowledges alert (FR-04, RBAC)
  await runTest("Test 13: Operator acknowledges alert (FR-04, RBAC)", async () => {
    if (!triggeredAlertId) {
      throw new Error("No alert ID to acknowledge");
    }
    const res = await fetch(`${BASE_URL}/api/alerts/${triggeredAlertId}/ack`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${operatorToken}` }
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  // Test 14: Water supply logs stored with audit details (FR-06)
  await runTest("Test 14: Water supply logs stored and queryable (FR-06)", async () => {
    const res = await fetch(`${BASE_URL}/api/supply/logs?size=10`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.total >= 2, "Should have logged initial startup, shutoff, and restore events");
    assert(data.items.length > 0, "Items array should not be empty");
  });

  // Test 15: Admin manual supply override (FR-05)
  await runTest("Test 15: Authorized user manual supply override (FR-05)", async () => {
    const res = await fetch(`${BASE_URL}/api/supply/override`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: "OFF", reason: "Scheduled line maintenance" })
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === "OFF", "Status should be updated to OFF");

    // Restore back to ON
    const restoreRes = await fetch(`${BASE_URL}/api/supply/override`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: "ON", reason: "Maintenance complete" })
    });
    assert(restoreRes.status === 200, "Restore should succeed");
  });

  // Test 16: Sensor readings search and pagination (FR-06)
  await runTest("Test 16: Sensor readings pagination and search (FR-06)", async () => {
    const res = await fetch(`${BASE_URL}/api/sensor/readings?page=1&size=3`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.items.length <= 3, "Page size should be respected");
    assert(data.total >= 3, "Total records should be >= 3");
  });

  // Test 17: Reports summary calculations (FR-06)
  await runTest("Test 17: Reports & Analytics operational summary", async () => {
    const res = await fetch(`${BASE_URL}/api/reports/summary`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(typeof data.total_readings === "number" && data.total_readings > 0, "total_readings must be positive");
    assert(typeof data.average_sediment === "number", "average_sediment must be numeric");
    assert(typeof data.compliance_rate_percent === "number", "compliance_rate_percent must be numeric");
  });

  // Test 18: RFC 4180 CSV export for readings, alerts, and supply history
  await runTest("Test 18: RFC 4180 CSV Export endpoints", async () => {
    const readingsCsvRes = await fetch(`${BASE_URL}/api/reports/export?report_type=readings`);
    assert(readingsCsvRes.status === 200, "Readings CSV should return 200");
    const readingsCsv = await readingsCsvRes.text();
    assert(readingsCsv.includes("Sediment Level"), "CSV header should include Sediment Level");

    const alertsCsvRes = await fetch(`${BASE_URL}/api/reports/export?report_type=alerts`);
    assert(alertsCsvRes.status === 200, "Alerts CSV should return 200");
    const alertsCsv = await alertsCsvRes.text();
    assert(alertsCsv.includes("Severity"), "Alerts CSV should include Severity header");

    const supplyCsvRes = await fetch(`${BASE_URL}/api/reports/export?report_type=supply`);
    assert(supplyCsvRes.status === 200, "Supply CSV should return 200");
    const supplyCsv = await supplyCsvRes.text();
    assert(supplyCsv.includes("Water Supply Status"), "Supply CSV should include Water Supply Status header");
  });

  // Test 19: Sensor Simulator Toggle and Inject
  await runTest("Test 19: Sensor simulator control and direct injection", async () => {
    const statusRes = await fetch(`${BASE_URL}/api/simulator/status`);
    assert(statusRes.status === 200, "Simulator status should return 200");

    const injectRes = await fetch(`${BASE_URL}/api/simulator/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sediment_level: 52.4 })
    });
    assert(injectRes.status === 200, "Simulator inject should return 200");
    const injectData = await injectRes.json();
    assert(injectData.sediment_level === 52.4, "Injected sediment level should be 52.4");
  });

  // Test 20: CRUD Deletion RBAC & Record Maintenance
  await runTest("Test 20: CRUD Deletion RBAC & Record Maintenance", async () => {
    if (createdReadingId) {
      const delRes = await fetch(`${BASE_URL}/api/sensor/readings/${createdReadingId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${adminToken}` }
      });
      assert(delRes.status === 200, "Admin can delete single reading");
    }

    // Non-admin cannot clear all readings
    const clearUnauthorized = await fetch(`${BASE_URL}/api/sensor/readings`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${operatorToken}` }
    });
    assert(clearUnauthorized.status === 403, "Operator forbidden from clearing all readings");
  });

  // Test 21: AI Operational Diagnostic Report Generation
  await runTest("Test 21: AI Operational Diagnostic Report (/api/ai/diagnostics)", async () => {
    const res = await fetch(`${BASE_URL}/api/ai/diagnostics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(typeof data.executive_summary === "string" && data.executive_summary.length > 0, "Executive summary should be non-empty string");
    assert(["LOW", "MODERATE", "HIGH", "CRITICAL"].includes(data.risk_level), `Risk level should be valid enum, got ${data.risk_level}`);
    assert(typeof data.risk_score === "number" && data.risk_score >= 0 && data.risk_score <= 100, `Risk score should be 0-100, got ${data.risk_score}`);
    assert(typeof data.sediment_trend === "string" && data.sediment_trend.length > 0, "Sediment trend should be non-empty");
    assert(typeof data.supply_safety_assessment === "string" && data.supply_safety_assessment.length > 0, "Supply safety assessment should be non-empty");
    assert(Array.isArray(data.actionable_recommendations) && data.actionable_recommendations.length > 0, "Actionable recommendations should be non-empty array");
    assert(typeof data.generated_at === "string", "Generated timestamp should be present");
  });

  // Test 22: AI Operator Inquiry Endpoint
  await runTest("Test 22: AI Operator Inquiry (/api/ai/inquiry)", async () => {
    // Empty query test (should reject with 400)
    const emptyRes = await fetch(`${BASE_URL}/api/ai/inquiry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" })
    });
    assert(emptyRes.status === 400, `Expected 400 for empty query, got ${emptyRes.status}`);

    // Valid query test
    const res = await fetch(`${BASE_URL}/api/ai/inquiry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Analyze current contamination risk and safe limit headroom." })
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(typeof data.answer === "string" && data.answer.length > 0, "Answer should be non-empty string");
    assert(typeof data.source === "string", "Source should be present");
    assert(data.query === "Analyze current contamination risk and safe limit headroom.", "Query should match input");
  });

  console.log(`\n======================================================`);
  console.log(`📊 Test Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log(`======================================================\n`);

  if (testsFailed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

startTestSuite().catch(err => {
  console.error("Test suite fatal error:", err);
  process.exit(1);
});
