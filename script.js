/**
 * SMART WATER TANK SEDIMENT MONITORING & CONTROL SYSTEM
 * Production Frontend JavaScript - Full API Integration & Real-Time Sync
 */

// =========================================================
// APPLICATION STATE
// =========================================================
const appState = {
    token: localStorage.getItem("tank_token") || null,
    user: JSON.parse(localStorage.getItem("tank_user") || "null"),
    currentSediment: 0.0,
    safeLimit: 70.0,
    status: "NORMAL",
    supplyStatus: "ON",
    activeAlertsCount: 0,
    currentPage: "dashboard",
    currentRecordTab: "readings",
    recordsPage: 1,
    recordsTotal: 0,
    recordsSearch: "",
    recordsStatus: "ALL",
    alertsSearch: "",
    alertsSeverity: "ALL",
    supplySearch: "",
    isSimRunning: false,
    pollInterval: null
};

// =========================================================
// API CLIENT HELPER
// =========================================================
async function apiRequest(endpoint, method = "GET", body = null, requiresAuth = false, retryCount = 2) {
    const headers = {
        "Content-Type": "application/json"
    };

    if (appState.token) {
        headers["Authorization"] = `Bearer ${appState.token}`;
    } else if (requiresAuth) {
        showToast("Authentication required. Please log in.", "warning");
        openLoginModal();
        throw new Error("Unauthorized");
    }

    const options = {
        method,
        headers
    };

    if (body && method !== "GET") {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(endpoint, options);

        if (response.status === 401) {
            if (appState.token) {
                // Token expired or invalid
                logout(false);
                showToast("Session expired. Please log in again.", "warning");
            }
            throw new Error("Unauthorized");
        }

        const contentType = response.headers.get("content-type") || "";
        const isJson = contentType.includes("application/json");

        if (!response.ok) {
            let errMsg = `Request failed with status ${response.status}`;
            if (isJson) {
                const errData = await response.json().catch(() => ({}));
                if (errData && errData.detail) errMsg = errData.detail;
            }
            throw new Error(errMsg);
        }

        if (!isJson) {
            // Received HTML (such as reverse proxy warmup page during server reload)
            if (method === "GET" && retryCount > 0) {
                await new Promise(resolve => setTimeout(resolve, 600));
                return apiRequest(endpoint, method, body, requiresAuth, retryCount - 1);
            }
            throw new Error("Backend server is warming up or returned non-JSON response.");
        }

        return await response.json();
    } catch (err) {
        if (method === "GET" && retryCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 600));
            return apiRequest(endpoint, method, body, requiresAuth, retryCount - 1);
        }
        console.warn(`[API] ${method} ${endpoint}:`, err.message || err);
        throw err;
    }
}

// =========================================================
// TOAST NOTIFICATIONS
// =========================================================
function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    let icon = "✓";
    if (type === "error") icon = "✕";
    if (type === "warning") icon = "⚠";

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// =========================================================
// NAVIGATION & PAGE SWITCHING (NFR-04 <= 3 clicks)
// =========================================================
function showPage(pageId) {
    const pages = document.querySelectorAll(".page");
    const navItems = document.querySelectorAll(".nav-item");

    pages.forEach(p => p.classList.remove("active-page"));
    navItems.forEach(n => n.classList.remove("active"));

    const targetPage = document.getElementById(pageId);
    const targetNav = document.querySelector(`.nav-item[data-page="${pageId}"]`);

    if (targetPage) targetPage.classList.add("active-page");
    if (targetNav) targetNav.classList.add("active");

    appState.currentPage = pageId;
    closeMobileSidebar();
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Load page-specific data immediately
    if (pageId === "dashboard") {
        fetchLatestTelemetry();
        loadRecentReadings();
    } else if (pageId === "monitoring") {
        fetchLatestTelemetry();
        loadMonitoringStream();
    } else if (pageId === "limit") {
        loadSafeLimitPage();
    } else if (pageId === "alerts") {
        loadAlerts();
    } else if (pageId === "supply") {
        loadSupplyPage();
    } else if (pageId === "records") {
        loadRecords();
    } else if (pageId === "reports") {
        loadReportsSummary();
    }
}

function closeMobileSidebar() {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    if (sidebar) sidebar.classList.remove("mobile-open");
    if (overlay) overlay.classList.remove("active");
}

// =========================================================
// AUTHENTICATION & ACCESS CONTROL (NFR-03)
// =========================================================
function openLoginModal() {
    const modal = document.getElementById("loginModal");
    const errMsg = document.getElementById("loginErrorMsg");
    if (errMsg) errMsg.style.display = "none";
    if (modal) modal.style.display = "flex";
}

function closeLoginModal() {
    const modal = document.getElementById("loginModal");
    if (modal) modal.style.display = "none";
}

function fillCredentials(username, password) {
    document.getElementById("loginUsername").value = username;
    document.getElementById("loginPassword").value = password;
}

async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    const errMsg = document.getElementById("loginErrorMsg");

    try {
        const data = await apiRequest("/api/auth/login", "POST", { username, password });
        appState.token = data.access_token;
        appState.user = data.user;
        localStorage.setItem("tank_token", data.access_token);
        localStorage.setItem("tank_user", JSON.stringify(data.user));

        updateAuthUI();
        closeLoginModal();
        showToast(`Welcome back, ${data.user.full_name}!`, "success");

        // Refresh currently visible page permissions
        if (appState.currentPage === "limit") loadSafeLimitPage();
    } catch (err) {
        if (errMsg) {
            errMsg.textContent = err.message || "Login failed. Check your credentials.";
            errMsg.style.display = "block";
        }
    }
}

function logout(notify = true) {
    appState.token = null;
    appState.user = null;
    localStorage.removeItem("tank_token");
    localStorage.removeItem("tank_user");

    updateAuthUI();
    if (notify) showToast("Logged out successfully.", "success");
    if (appState.currentPage === "limit") loadSafeLimitPage();
}

function updateAuthUI() {
    const userNameEl = document.getElementById("userName");
    const userRoleEl = document.getElementById("userRole");
    const userAvatarEl = document.getElementById("userAvatar");
    const authBtn = document.getElementById("authActionBtn");

    if (appState.user) {
        userNameEl.textContent = appState.user.full_name || appState.user.username;
        userRoleEl.textContent = appState.user.role === "admin" ? "System Administrator" : "Tank Field Operator";
        userAvatarEl.textContent = (appState.user.username || "AU").substring(0, 2).toUpperCase();
        authBtn.textContent = "Logout";
        authBtn.onclick = () => logout(true);
    } else {
        userNameEl.textContent = "Guest Viewer";
        userRoleEl.textContent = "Read-Only Access";
        userAvatarEl.textContent = "GV";
        authBtn.textContent = "Login";
        authBtn.onclick = openLoginModal;
    }
}

async function verifyStoredAuth() {
    if (!appState.token) {
        updateAuthUI();
        return;
    }
    try {
        const user = await apiRequest("/api/auth/me", "GET");
        appState.user = user;
        localStorage.setItem("tank_user", JSON.stringify(user));
        updateAuthUI();
    } catch {
        logout(false);
    }
}

// =========================================================
// REAL-TIME TELEMETRY & TANK VISUALIZER (FR-01, FR-02, NFR-01)
// =========================================================
async function fetchLatestTelemetry() {
    try {
        const data = await apiRequest("/api/sensor/latest", "GET");

        appState.currentSediment = data.current_sediment;
        appState.safeLimit = data.safe_limit;
        appState.status = data.status;
        appState.supplyStatus = data.supply_status;
        appState.activeAlertsCount = data.active_alerts_count;

        updateDashboardUI(data);
        updateTankVisualizer(data.current_sediment, data.safe_limit, data.status, data.supply_status);
        updateMonitoringMeter(data.current_sediment, data.safe_limit, data.status);
        updateBadges(data.active_alerts_count);

        const connText = document.getElementById("connectionStatusText");
        const connLatency = document.getElementById("connectionLatencyText");
        if (connText) connText.textContent = data.database_type ? `Connected: ${data.database_type}` : "Connected to Supabase PostgreSQL";
        if (connLatency) connLatency.textContent = `Sync OK (${new Date().toLocaleTimeString()})`;

        const lastUpdated = document.getElementById("lastUpdatedTime");
        if (lastUpdated) {
            lastUpdated.textContent = new Date().toLocaleTimeString();
        }
    } catch (err) {
        const connText = document.getElementById("connectionStatusText");
        const connLatency = document.getElementById("connectionLatencyText");
        if (connText) connText.textContent = "Connection Reconnecting";
        if (connLatency) connLatency.textContent = "Attempting to reach backend...";
    }
}

function updateDashboardUI(data) {
    // Current Sediment Card
    const dashSediment = document.getElementById("dashboardSediment");
    const dashProgress = document.getElementById("dashboardProgress");
    const dashBadge = document.getElementById("dashSedimentBadge");
    const dashSubtext = document.getElementById("dashSedimentSubtext");

    if (dashSediment) dashSediment.textContent = data.current_sediment.toFixed(1);
    if (dashProgress) {
        dashProgress.style.width = `${Math.min(100, data.current_sediment)}%`;
        dashProgress.className = `progress-value ${data.status.toLowerCase()}-progress`;
    }
    if (dashBadge) {
        dashBadge.textContent = data.status;
        dashBadge.className = `state-badge ${data.status.toLowerCase()}`;
    }
    if (dashSubtext) {
        const margin = (data.safe_limit - data.current_sediment).toFixed(1);
        if (margin >= 0) {
            dashSubtext.textContent = `Safe margin: ${margin}% remaining`;
        } else {
            dashSubtext.textContent = `Exceeded threshold by ${Math.abs(margin)}%!`;
        }
    }

    // Safe Limit Card
    const dashLimit = document.getElementById("dashboardLimit");
    if (dashLimit) dashLimit.textContent = data.safe_limit.toFixed(1);

    // Water Supply Card
    const dashSupplyStatus = document.getElementById("dashboardSupplyStatus");
    const dashSupplyBadge = document.getElementById("dashSupplyBadge");
    const dashSupplyReason = document.getElementById("dashSupplyReason");
    const dashSupplyIcon = document.getElementById("dashSupplyIcon");

    if (dashSupplyStatus) {
        dashSupplyStatus.textContent = data.supply_status === "ON" ? "ACTIVE" : "STOPPED";
        dashSupplyStatus.style.color = data.supply_status === "ON" ? "var(--normal)" : "var(--critical)";
    }
    if (dashSupplyBadge) {
        dashSupplyBadge.textContent = data.supply_status;
        dashSupplyBadge.className = `supply-pill ${data.supply_status.toLowerCase()}`;
    }
    if (dashSupplyReason) {
        if (data.supply_status === "ON") {
            dashSupplyReason.textContent = "Normal distribution active";
        } else {
            dashSupplyReason.textContent = `Auto-shutoff: sediment > safe limit (${data.safe_limit}%)`;
        }
    }
    if (dashSupplyIcon) {
        dashSupplyIcon.textContent = data.supply_status === "ON" ? "💧" : "🚫";
    }

    // Alerts Card
    const dashAlertsCount = document.getElementById("dashboardAlertsCount");
    const dashAlertsBadge = document.getElementById("dashAlertsBadge");
    const dashAlertsCaption = document.getElementById("dashAlertsCaption");

    if (dashAlertsCount) dashAlertsCount.textContent = data.active_alerts_count;
    if (dashAlertsBadge) {
        dashAlertsBadge.textContent = `${data.active_alerts_count} UNACKED`;
        dashAlertsBadge.className = `state-badge ${data.active_alerts_count > 0 ? "critical" : "neutral"}`;
    }
    if (dashAlertsCaption) {
        dashAlertsCaption.textContent = data.active_alerts_count > 0
            ? "Requires operator review"
            : "No active contamination alerts";
    }
}

function updateTankVisualizer(sediment, limit, status, supplyStatus) {
    const tankSedimentBed = document.getElementById("tankSedimentBed");
    const tankSedimentLabel = document.getElementById("tankSedimentLabel");
    const tankLimitLine = document.getElementById("tankLimitLine");
    const tankLimitValue = document.getElementById("tankLimitValue");
    const pipeValve = document.getElementById("pipeValve");
    const pipeFlow = document.getElementById("pipeFlowIndicator");

    const legendSediment = document.getElementById("tankLegendSediment");
    const legendLimit = document.getElementById("tankLegendLimit");
    const legendSupply = document.getElementById("tankLegendSupply");

    if (tankSedimentBed) {
        tankSedimentBed.style.height = `${Math.min(96, Math.max(4, sediment))}%`;
        tankSedimentBed.className = `tank-sediment ${status === "CRITICAL" ? "critical-state" : status === "WARNING" ? "warning-state" : ""}`;
    }
    if (tankSedimentLabel) {
        tankSedimentLabel.textContent = `Sediment: ${sediment.toFixed(1)}%`;
    }
    if (tankLimitLine) {
        tankLimitLine.style.bottom = `${Math.min(95, Math.max(5, limit))}%`;
    }
    if (tankLimitValue) {
        tankLimitValue.textContent = `${limit.toFixed(1)}%`;
    }
    if (pipeValve) {
        pipeValve.textContent = `VALVE: ${supplyStatus}`;
        pipeValve.className = `pipe-valve ${supplyStatus === "OFF" ? "closed" : ""}`;
    }
    if (pipeFlow) {
        if (supplyStatus === "OFF") {
            pipeFlow.classList.add("stopped");
        } else {
            pipeFlow.classList.remove("stopped");
        }
    }

    if (legendSediment) legendSediment.textContent = `${sediment.toFixed(1)}% of tank bed`;
    if (legendLimit) legendLimit.textContent = `${limit.toFixed(1)}% safe threshold`;
    if (legendSupply) legendSupply.textContent = `Supply is ${supplyStatus}`;
}

function updateMonitoringMeter(sediment, limit, status) {
    const monitoringValue = document.getElementById("monitoringValue");
    const meterCircle = document.getElementById("meterCircle");
    const meterStateBadge = document.getElementById("meterStateBadge");
    const meterThresholdVal = document.getElementById("meterThresholdVal");
    const meterMarginVal = document.getElementById("meterMarginVal");

    if (monitoringValue) monitoringValue.textContent = sediment.toFixed(1);
    if (meterThresholdVal) meterThresholdVal.textContent = `${limit.toFixed(1)}%`;

    if (meterMarginVal) {
        const diff = (limit - sediment).toFixed(1);
        meterMarginVal.textContent = diff >= 0 ? `+${diff}% (Safe)` : `${diff}% (Breached)`;
        meterMarginVal.style.color = diff >= 0 ? "var(--normal)" : "var(--critical)";
    }

    if (meterCircle) {
        const percent = Math.min(100, Math.max(0, sediment));
        let color = "var(--normal)";
        if (status === "WARNING") color = "var(--warning)";
        if (status === "CRITICAL") color = "var(--critical)";

        meterCircle.style.background = `conic-gradient(${color} 0% ${percent}%, var(--surface-soft) ${percent}% 100%)`;
    }

    if (meterStateBadge) {
        meterStateBadge.textContent = status;
        meterStateBadge.className = `state-badge ${status.toLowerCase()}`;
    }
}

function updateBadges(alertCount) {
    const sideCount = document.getElementById("sidebarAlertCount");
    const headCount = document.getElementById("headerAlertCount");

    if (sideCount) sideCount.textContent = alertCount;
    if (headCount) headCount.textContent = alertCount;
}

// =========================================================
// RECENT READINGS & MONITORING STREAM
// =========================================================
async function loadRecentReadings() {
    const tbody = document.querySelector("#dashReadingsTable tbody");
    if (!tbody) return;

    try {
        const data = await apiRequest("/api/sensor/readings?size=6", "GET");
        if (data.items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No readings recorded yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.items.map(row => {
            const timeFormatted = formatTimestamp(row.timestamp);
            return `
                <tr>
                    <td><strong>${timeFormatted}</strong></td>
                    <td><strong>${row.sediment_level.toFixed(1)}%</strong></td>
                    <td>${row.limit_at_time.toFixed(1)}%</td>
                    <td><span class="state-badge ${row.status.toLowerCase()}">${row.status}</span></td>
                    <td><span class="supply-pill ${row.supply_status.toLowerCase()}">${row.supply_status}</span></td>
                </tr>
            `;
        }).join("");
    } catch {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Failed to load sensor stream.</td></tr>`;
    }
}

async function loadMonitoringStream() {
    const tbody = document.querySelector("#monitoringStreamTable tbody");
    if (!tbody) return;

    try {
        const data = await apiRequest("/api/sensor/readings?size=15", "GET");
        if (data.items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No records found.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.items.map(row => {
            return `
                <tr>
                    <td>#${row.id}</td>
                    <td>${formatTimestamp(row.timestamp)}</td>
                    <td><strong>${row.sediment_level.toFixed(1)}%</strong></td>
                    <td>${row.limit_at_time.toFixed(1)}%</td>
                    <td><span class="state-badge ${row.status.toLowerCase()}">${row.status}</span></td>
                    <td><span class="supply-pill ${row.supply_status.toLowerCase()}">${row.supply_status}</span></td>
                </tr>
            `;
        }).join("");
    } catch {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Failed to load monitoring stream.</td></tr>`;
    }
}

// =========================================================
// SENSOR SIMULATION & INJECTION
// =========================================================
async function injectReading(level) {
    try {
        const result = await apiRequest("/api/simulator/inject", "POST", { sediment_level: level });
        showToast(`Injected sediment reading: ${result.sediment_level.toFixed(1)}% (${result.status})`,
            result.status === "CRITICAL" ? "error" : result.status === "WARNING" ? "warning" : "success");
        await fetchLatestTelemetry();
        if (appState.currentPage === "dashboard") loadRecentReadings();
        if (appState.currentPage === "monitoring") loadMonitoringStream();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function handleCustomInject() {
    const input = document.getElementById("customSedimentInput");
    const val = parseFloat(input.value);

    if (isNaN(val) || val < 0 || val > 100) {
        showToast("Please enter a valid sediment value between 0% and 100%.", "warning");
        return;
    }
    await injectReading(val);
}

async function toggleSimulationState(checked) {
    try {
        const res = await apiRequest("/api/simulator/toggle", "POST", { enable: checked });
        appState.isSimRunning = res.is_running;
        showToast(res.is_running ? "Sensor simulation active (reading every 3s)" : "Sensor simulation stopped.", "success");
    } catch (err) {
        showToast("Failed to toggle simulation", "error");
    }
}

// =========================================================
// SAFE SEDIMENT LIMIT CONFIGURATION (FR-03, NFR-03)
// =========================================================
async function loadSafeLimitPage() {
    const authWarning = document.getElementById("limitAuthWarning");
    const limitInput = document.getElementById("limitInput");
    const saveBtn = document.getElementById("saveLimitBtn");
    const currentLimitDisplay = document.getElementById("currentLimitDisplay");
    const lastModifiedBy = document.getElementById("limitLastModifiedBy");
    const lastModifiedTime = document.getElementById("limitLastModifiedTime");
    const limitCurrentSediment = document.getElementById("limitCurrentSediment");

    try {
        const data = await apiRequest("/api/limit", "GET");
        if (currentLimitDisplay) currentLimitDisplay.textContent = `${data.safe_limit.toFixed(1)}%`;
        if (limitInput) limitInput.value = data.safe_limit;
        if (lastModifiedBy) lastModifiedBy.textContent = data.updated_by || "system";
        if (lastModifiedTime) lastModifiedTime.textContent = data.updated_at ? formatTimestamp(data.updated_at) : "Initial Default";
        if (limitCurrentSediment) limitCurrentSediment.textContent = `${appState.currentSediment.toFixed(1)}%`;
    } catch (err) {
        console.error("Failed to load limit info:", err);
    }

    // Role-based access control check (NFR-03)
    const isAuthorized = appState.user && (appState.user.role === "admin" || appState.user.role === "operator");
    if (isAuthorized) {
        if (authWarning) authWarning.style.display = "none";
        if (limitInput) limitInput.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
    } else {
        if (authWarning) authWarning.style.display = "flex";
        if (limitInput) limitInput.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
    }
}

async function handleSaveLimit(event) {
    event.preventDefault();
    const limitInput = document.getElementById("limitInput");
    const messageEl = document.getElementById("limitMessage");
    const val = parseFloat(limitInput.value);

    if (isNaN(val) || val < 1 || val > 100) {
        if (messageEl) {
            messageEl.textContent = "Safe limit must be between 1% and 100%.";
            messageEl.style.color = "var(--critical)";
        }
        return;
    }

    try {
        const result = await apiRequest("/api/limit", "PUT", { safe_limit: val }, true);
        showToast(`Safe limit updated to ${result.safe_limit.toFixed(1)}%!`, "success");
        if (messageEl) {
            messageEl.textContent = `Safe limit saved successfully (${result.safe_limit}%).`;
            messageEl.style.color = "var(--normal)";
        }
        await fetchLatestTelemetry();
        loadSafeLimitPage();
    } catch (err) {
        if (messageEl) {
            messageEl.textContent = err.message || "Failed to update limit.";
            messageEl.style.color = "var(--critical)";
        }
    }
}

// =========================================================
// ALERTS FEED (FR-04, NFR-02)
// =========================================================
async function loadAlerts() {
    const container = document.getElementById("alertsContainer");
    const totalEl = document.getElementById("alertStatTotal");
    const unackedEl = document.getElementById("alertStatUnacked");
    const limitEl = document.getElementById("alertStatLimit");

    if (limitEl) limitEl.textContent = `${appState.safeLimit.toFixed(1)}%`;

    try {
        const severity = appState.alertsSeverity !== "ALL" ? `&severity=${appState.alertsSeverity}` : "";
        const search = appState.alertsSearch ? `&search=${encodeURIComponent(appState.alertsSearch)}` : "";

        const data = await apiRequest(`/api/alerts?page=1&size=50${severity}${search}`, "GET");

        if (totalEl) totalEl.textContent = data.total;
        if (unackedEl) unackedEl.textContent = data.unacknowledged_count;

        if (data.items.length === 0) {
            container.innerHTML = `<div class="empty-state">No alerts found matching your criteria.</div>`;
            return;
        }

        container.innerHTML = data.items.map(alert => {
            const isUnacked = !alert.acknowledged;
            return `
                <div class="alert-item-card ${isUnacked ? "unacked" : ""}">
                    <div class="alert-left">
                        <div class="alert-icon-box ${alert.severity.toLowerCase()}">
                            ${alert.severity === "CRITICAL" ? "✕" : "!"}
                        </div>
                        <div class="alert-info">
                            <strong>${escapeHtml(alert.message)}</strong>
                            <p>Recorded at: ${formatTimestamp(alert.timestamp)} &bull; Sediment: ${alert.sediment_level.toFixed(1)}% (Threshold: ${alert.limit_at_time.toFixed(1)}%)</p>
                        </div>
                    </div>
                    <div class="alert-actions">
                        ${isUnacked ? `
                            <button class="secondary-button small-btn" onclick="app.ackAlert(${alert.id})">
                                Acknowledge
                            </button>
                        ` : `
                            <span class="state-badge neutral">Acknowledged by ${escapeHtml(alert.acknowledged_by || "user")}</span>
                        `}
                        <button class="btn-icon-action" onclick="app.deleteAlert(${alert.id})" title="Delete alert">
                            🗑
                        </button>
                    </div>
                </div>
            `;
        }).join("");
    } catch {
        container.innerHTML = `<div class="empty-state">Failed to load alerts feed.</div>`;
    }
}

async function ackAlert(alertId) {
    try {
        await apiRequest(`/api/alerts/${alertId}/ack`, "POST", null, true);
        showToast(`Alert #${alertId} acknowledged.`, "success");
        loadAlerts();
        fetchLatestTelemetry();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function deleteAlert(alertId) {
    if (!confirm(`Delete alert #${alertId}?`)) return;
    try {
        await apiRequest(`/api/alerts/${alertId}`, "DELETE", null, true);
        showToast(`Alert #${alertId} deleted.`, "success");
        loadAlerts();
        fetchLatestTelemetry();
    } catch (err) {
        showToast(err.message, "error");
    }
}

// =========================================================
// WATER SUPPLY PAGE (FR-05, FR-06)
// =========================================================
async function loadSupplyPage() {
    const pagePill = document.getElementById("supplyPagePill");
    const pageIcon = document.getElementById("supplyAnimatedIcon");
    const pageStatusText = document.getElementById("supplyPageStatusText");
    const pageReasonText = document.getElementById("supplyPageReasonText");
    const sedimentVal = document.getElementById("supplySedimentVal");
    const limitVal = document.getElementById("supplyLimitVal");
    const controlMode = document.getElementById("supplyControlMode");

    try {
        const data = await apiRequest("/api/supply/status", "GET");

        if (pagePill) {
            pagePill.textContent = data.status;
            pagePill.className = `supply-pill ${data.status.toLowerCase()}`;
        }
        if (pageIcon) {
            pageIcon.textContent = data.status === "ON" ? "💧" : "🚫";
            pageIcon.className = `supply-animated-icon ${data.status === "OFF" ? "stopped" : ""}`;
        }
        if (pageStatusText) {
            pageStatusText.textContent = data.status === "ON" ? "Water Supply ON (Active Flow)" : "Water Supply OFF (Pipeline Stopped)";
            pageStatusText.style.color = data.status === "ON" ? "var(--normal)" : "var(--critical)";
        }
        if (pageReasonText) pageReasonText.textContent = data.last_reason;
        if (sedimentVal) sedimentVal.textContent = `${data.sediment_level.toFixed(1)}%`;
        if (limitVal) limitVal.textContent = `${data.safe_limit.toFixed(1)}%`;
        if (controlMode) controlMode.textContent = data.control_mode;

        loadSupplyLogs();
    } catch (err) {
        console.error("Failed to load supply info:", err);
    }
}

async function toggleSupply(targetStatus) {
    if (!appState.user) {
        showToast("Please sign in as an authorized user to override water supply.", "warning");
        openLoginModal();
        return;
    }

    if (!confirm(`Are you sure you want to force water supply ${targetStatus}?`)) return;

    try {
        const res = await apiRequest("/api/supply/override", "POST", { status: targetStatus }, true);
        showToast(`Water supply manually switched to ${res.status}`, "success");
        await fetchLatestTelemetry();
        loadSupplyPage();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function loadSupplyLogs() {
    const tbody = document.querySelector("#supplyLogsTable tbody");
    if (!tbody) return;

    try {
        const search = appState.supplySearch ? `&search=${encodeURIComponent(appState.supplySearch)}` : "";
        const data = await apiRequest(`/api/supply/logs?size=25${search}`, "GET");

        if (data.items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No supply log records found.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.items.map(log => {
            return `
                <tr>
                    <td>#${log.id}</td>
                    <td>${formatTimestamp(log.timestamp)}</td>
                    <td><span class="supply-pill ${log.status.toLowerCase()}">${log.status}</span></td>
                    <td>${log.sediment_level.toFixed(1)}%</td>
                    <td>${escapeHtml(log.reason)}</td>
                    <td><strong>${escapeHtml(log.triggered_by)}</strong></td>
                </tr>
            `;
        }).join("");
    } catch {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Failed to load supply history.</td></tr>`;
    }
}

// =========================================================
// RECORDS PAGE & CRUD OPERATIONS (FR-06)
// =========================================================
function switchRecordTab(tabName) {
    appState.currentRecordTab = tabName;

    document.querySelectorAll(".record-tab").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.recordTab === tabName);
    });

    document.getElementById("tab-readings").style.display = tabName === "readings" ? "block" : "none";
    document.getElementById("tab-alerts-rec").style.display = tabName === "alerts-rec" ? "block" : "none";
    document.getElementById("tab-supply-rec").style.display = tabName === "supply-rec" ? "block" : "none";

    loadRecords();
}

async function loadRecords() {
    if (appState.currentRecordTab === "readings") {
        await loadSensorReadingsTable();
    } else if (appState.currentRecordTab === "alerts-rec") {
        await loadAlertsRecordsTable();
    } else if (appState.currentRecordTab === "supply-rec") {
        await loadSupplyRecordsTable();
    }
}

async function loadSensorReadingsTable() {
    const tbody = document.getElementById("recordsTableBody");
    const paginationInfo = document.getElementById("recordsPaginationInfo");
    const prevBtn = document.getElementById("recordsPrevBtn");
    const nextBtn = document.getElementById("recordsNextBtn");

    try {
        const status = appState.recordsStatus !== "ALL" ? `&status=${appState.recordsStatus}` : "";
        const search = appState.recordsSearch ? `&search=${encodeURIComponent(appState.recordsSearch)}` : "";
        const page = appState.recordsPage;
        const size = 15;

        const data = await apiRequest(`/api/sensor/readings?page=${page}&size=${size}${status}${search}`, "GET");
        appState.recordsTotal = data.total;

        if (paginationInfo) {
            const start = data.total === 0 ? 0 : (page - 1) * size + 1;
            const end = Math.min(page * size, data.total);
            paginationInfo.textContent = `Showing ${start} - ${end} of ${data.total} records`;
        }

        if (prevBtn) prevBtn.disabled = page <= 1;
        if (nextBtn) nextBtn.disabled = page * size >= data.total;

        if (data.items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No sensor readings found.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.items.map(row => {
            return `
                <tr>
                    <td>#${row.id}</td>
                    <td>${formatTimestamp(row.timestamp)}</td>
                    <td><strong>${row.sediment_level.toFixed(1)}%</strong></td>
                    <td>${row.limit_at_time.toFixed(1)}%</td>
                    <td><span class="state-badge ${row.status.toLowerCase()}">${row.status}</span></td>
                    <td><span class="supply-pill ${row.supply_status.toLowerCase()}">${row.supply_status}</span></td>
                    <td>
                        <button class="btn-icon-action" onclick="app.deleteReadingRecord(${row.id})" title="Delete reading">
                            🗑
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    } catch {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Failed to load records.</td></tr>`;
    }
}

async function deleteReadingRecord(id) {
    if (!confirm(`Delete sensor reading #${id}?`)) return;
    try {
        await apiRequest(`/api/sensor/readings/${id}`, "DELETE", null, true);
        showToast(`Reading #${id} deleted.`, "success");
        loadRecords();
        fetchLatestTelemetry();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function loadAlertsRecordsTable() {
    const tbody = document.getElementById("recordsAlertsBody");
    try {
        const data = await apiRequest("/api/alerts?page=1&size=30", "GET");
        if (data.items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No alert records recorded.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.items.map(alert => {
            return `
                <tr>
                    <td>#${alert.id}</td>
                    <td>${formatTimestamp(alert.timestamp)}</td>
                    <td><strong>${alert.sediment_level.toFixed(1)}%</strong></td>
                    <td>${alert.limit_at_time.toFixed(1)}%</td>
                    <td><span class="state-badge ${alert.severity.toLowerCase()}">${alert.severity}</span></td>
                    <td>${escapeHtml(alert.message)}</td>
                    <td>${alert.acknowledged ? `<span class="state-badge normal">Yes (${escapeHtml(alert.acknowledged_by || "")})</span>` : '<span class="state-badge critical">No</span>'}</td>
                    <td>
                        <button class="btn-icon-action" onclick="app.deleteAlert(${alert.id})" title="Delete alert">
                            🗑
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    } catch {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Failed to load alert records.</td></tr>`;
    }
}

async function loadSupplyRecordsTable() {
    const tbody = document.getElementById("recordsSupplyBody");
    try {
        const data = await apiRequest("/api/supply/logs?size=30", "GET");
        if (data.items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No supply log records recorded.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.items.map(log => {
            return `
                <tr>
                    <td>#${log.id}</td>
                    <td>${formatTimestamp(log.timestamp)}</td>
                    <td><span class="supply-pill ${log.status.toLowerCase()}">${log.status}</span></td>
                    <td>${log.sediment_level.toFixed(1)}%</td>
                    <td>${escapeHtml(log.reason)}</td>
                    <td><strong>${escapeHtml(log.triggered_by)}</strong></td>
                    <td>
                        <button class="btn-icon-action" onclick="app.deleteSupplyRecord(${log.id})" title="Delete log">
                            🗑
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    } catch {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Failed to load supply records.</td></tr>`;
    }
}

async function deleteSupplyRecord(id) {
    if (!confirm(`Delete supply log entry #${id}?`)) return;
    try {
        await apiRequest(`/api/supply/logs/${id}`, "DELETE", null, true);
        showToast(`Supply log #${id} deleted.`, "success");
        loadRecords();
    } catch (err) {
        showToast(err.message, "error");
    }
}

// =========================================================
// REPORTS & ANALYTICS
// =========================================================
async function loadReportsSummary() {
    try {
        const data = await apiRequest("/api/reports/summary", "GET");

        const totalEl = document.getElementById("repTotalReadings");
        const avgEl = document.getElementById("repAvgSediment");
        const maxEl = document.getElementById("repMaxSediment");
        const compEl = document.getElementById("repComplianceRate");
        const shutoffsEl = document.getElementById("repShutoffs");
        const alertsEl = document.getElementById("repAlerts");

        if (totalEl) totalEl.textContent = data.total_readings;
        if (avgEl) avgEl.textContent = `${data.average_sediment.toFixed(1)}%`;
        if (maxEl) maxEl.textContent = `${data.max_sediment.toFixed(1)}%`;
        if (compEl) compEl.textContent = `${data.compliance_rate_percent.toFixed(1)}%`;
        if (shutoffsEl) shutoffsEl.textContent = data.supply_shutoff_incidents;
        if (alertsEl) alertsEl.textContent = data.total_alerts;
    } catch (err) {
        console.error("Failed to load reports summary:", err);
    }
}

// =========================================================
// AI OPERATIONAL INTELLIGENCE & DIAGNOSTICS
// =========================================================
let currentAiReportData = null;

async function generateAIDiagnosticReportUI() {
    const btn = document.getElementById("btnGenerateAiReport");
    const statusBadge = document.getElementById("aiReportStatusBadge");
    const emptyEl = document.getElementById("aiReportEmpty");
    const loadingEl = document.getElementById("aiReportLoading");
    const errorEl = document.getElementById("aiReportError");
    const resultEl = document.getElementById("aiReportResult");
    const errorTextEl = document.getElementById("aiReportErrorText");

    if (emptyEl) emptyEl.style.display = "none";
    if (errorEl) errorEl.style.display = "none";
    if (resultEl) resultEl.style.display = "none";
    if (loadingEl) loadingEl.style.display = "block";

    if (btn) btn.disabled = true;
    if (statusBadge) {
        statusBadge.textContent = "Analyzing...";
        statusBadge.className = "ai-status-pill generating";
    }

    try {
        const report = await apiRequest("/api/ai/diagnostics", "POST");
        currentAiReportData = report;

        // Populate fields
        const riskLevelEl = document.getElementById("aiReportRiskLevel");
        const riskScoreEl = document.getElementById("aiReportRiskScore");
        const riskProgressEl = document.getElementById("aiReportRiskProgress");
        const execSummaryEl = document.getElementById("aiReportExecutiveSummary");
        const trendEl = document.getElementById("aiReportSedimentTrend");
        const safetyEl = document.getElementById("aiReportSupplySafety");
        const recsListEl = document.getElementById("aiReportRecommendationsList");
        const timestampEl = document.getElementById("aiReportTimestamp");

        const riskClass = (report.risk_level || "low").toLowerCase();
        if (riskLevelEl) {
            riskLevelEl.textContent = report.risk_level;
            riskLevelEl.className = `ai-risk-badge ${riskClass}`;
        }

        if (riskScoreEl) {
            riskScoreEl.textContent = `${report.risk_score}/100`;
        }

        if (riskProgressEl) {
            riskProgressEl.style.width = `${Math.min(100, Math.max(5, report.risk_score))}%`;
            if (report.risk_score > 70) {
                riskProgressEl.style.background = "var(--critical)";
            } else if (report.risk_score > 40) {
                riskProgressEl.style.background = "var(--warning)";
            } else {
                riskProgressEl.style.background = "var(--normal)";
            }
        }

        if (timestampEl) {
            const timeStr = report.generated_at ? new Date(report.generated_at).toLocaleTimeString() : "Just now";
            timestampEl.textContent = `Generated: ${timeStr} (${report.source === "gemini-3.8-flash" ? "Gemini 3.8 Flash" : "Telemetry Diagnostics"})`;
        }

        if (execSummaryEl) execSummaryEl.textContent = report.executive_summary;
        if (trendEl) trendEl.textContent = report.sediment_trend;
        if (safetyEl) safetyEl.textContent = report.supply_safety_assessment;

        if (recsListEl) {
            if (Array.isArray(report.actionable_recommendations) && report.actionable_recommendations.length > 0) {
                recsListEl.innerHTML = report.actionable_recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join("");
            } else {
                recsListEl.innerHTML = `<li>Continue regular sediment sensor monitoring and safe limit compliance checks.</li>`;
            }
        }

        if (loadingEl) loadingEl.style.display = "none";
        if (resultEl) resultEl.style.display = "flex";

        if (statusBadge) {
            statusBadge.textContent = "AI Analysis Complete";
            statusBadge.className = "ai-status-pill ready";
        }
        showToast("AI Diagnostic report generated successfully.", "success");
    } catch (err) {
        if (loadingEl) loadingEl.style.display = "none";
        if (errorEl) errorEl.style.display = "block";
        if (errorTextEl) errorTextEl.textContent = err.message || "Failed to generate diagnostic report.";

        if (statusBadge) {
            statusBadge.textContent = "Error";
            statusBadge.className = "ai-status-pill";
        }
        showToast("Error generating AI report: " + err.message, "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleAIInquiry(customQuery) {
    const inputEl = document.getElementById("aiInquiryInput");
    const query = (customQuery || (inputEl ? inputEl.value : "")).trim();

    if (!query) {
        showToast("Please enter an inquiry for the AI Analyst.", "warning");
        if (inputEl) inputEl.focus();
        return;
    }

    if (inputEl && !customQuery) {
        inputEl.value = "";
    }

    const loadingEl = document.getElementById("aiInquiryLoading");
    const resultBox = document.getElementById("aiInquiryResultBox");
    const resultText = document.getElementById("aiInquiryResultText");
    const submitBtn = document.getElementById("btnSubmitAiInquiry");

    if (loadingEl) loadingEl.style.display = "flex";
    if (resultBox) resultBox.style.display = "none";
    if (submitBtn) submitBtn.disabled = true;

    try {
        const data = await apiRequest("/api/ai/inquiry", "POST", { query });
        if (resultText) resultText.textContent = data.answer;
        if (resultBox) resultBox.style.display = "block";
    } catch (err) {
        if (resultText) resultText.textContent = "AI Analyst inquiry failed: " + (err.message || "Unknown error");
        if (resultBox) resultBox.style.display = "block";
    } finally {
        if (loadingEl) loadingEl.style.display = "none";
        if (submitBtn) submitBtn.disabled = false;
    }
}

function copyCurrentAiReport() {
    if (!currentAiReportData) {
        showToast("No report to copy.", "warning");
        return;
    }
    const r = currentAiReportData;
    const recs = (r.actionable_recommendations || []).map((x, i) => `${i + 1}. ${x}`).join("\n");
    const text = `SMARTTANK AI OPERATIONAL DIAGNOSTIC REPORT
Generated: ${new Date(r.generated_at).toLocaleString()}
Contamination Risk Level: ${r.risk_level} (Score: ${r.risk_score}/100)

EXECUTIVE SUMMARY:
${r.executive_summary}

SEDIMENT DYNAMICS:
${r.sediment_trend}

VALVE & WATER SUPPLY ASSESSMENT:
${r.supply_safety_assessment}

RECOMMENDATIONS:
${recs}
`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => showToast("AI Diagnostic report copied to clipboard.", "success"))
            .catch(() => showToast("Failed to copy report to clipboard.", "error"));
    } else {
        showToast("Clipboard copy not supported in this browser context.", "warning");
    }
}

// =========================================================
// HELPER UTILITIES
// =========================================================
function formatTimestamp(isoStr) {
    if (!isoStr) return "--";
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return isoStr;
        return d.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }) + " · " + d.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    } catch {
        return isoStr;
    }
}

function escapeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// =========================================================
// INITIALIZATION & EVENT LISTENERS
// =========================================================
document.addEventListener("DOMContentLoaded", () => {

    // Sidebar navigation listeners
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", function() {
            showPage(this.dataset.page);
        });
    });

    // Page links within cards
    document.querySelectorAll("[data-page-link]").forEach(link => {
        link.addEventListener("click", function() {
            showPage(this.dataset.pageLink);
        });
    });

    // Mobile menu toggle
    const menuBtn = document.getElementById("menuButton");
    const overlay = document.getElementById("sidebarOverlay");
    const sidebar = document.getElementById("sidebar");

    if (menuBtn && sidebar && overlay) {
        menuBtn.addEventListener("click", () => {
            sidebar.classList.toggle("mobile-open");
            overlay.classList.toggle("active");
        });
        overlay.addEventListener("click", closeMobileSidebar);
    }

    // Notification button
    const notifBtn = document.getElementById("notificationButton");
    if (notifBtn) {
        notifBtn.addEventListener("click", () => showPage("alerts"));
    }

    // Modal close buttons
    const closeLoginBtn = document.getElementById("closeLoginModalBtn");
    const cancelLoginBtn = document.getElementById("cancelLoginBtn");
    if (closeLoginBtn) closeLoginBtn.addEventListener("click", closeLoginModal);
    if (cancelLoginBtn) cancelLoginBtn.addEventListener("click", closeLoginModal);

    // Login form submission
    const loginForm = document.getElementById("loginForm");
    if (loginForm) loginForm.addEventListener("submit", handleLogin);

    // Safe Limit form submission
    const limitForm = document.getElementById("limitForm");
    if (limitForm) limitForm.addEventListener("submit", handleSaveLimit);

    // Custom sensor injection
    const injectBtn = document.getElementById("injectBtn");
    if (injectBtn) injectBtn.addEventListener("click", handleCustomInject);

    // Simulator toggle
    const simToggle = document.getElementById("simToggle");
    if (simToggle) {
        simToggle.addEventListener("change", function() {
            toggleSimulationState(this.checked);
        });
    }

    // Records sub-tabs
    document.querySelectorAll("[data-record-tab]").forEach(btn => {
        btn.addEventListener("click", function() {
            switchRecordTab(this.dataset.recordTab);
        });
    });

    // Records search input (debounced)
    const recordSearch = document.getElementById("recordSearch");
    if (recordSearch) {
        recordSearch.addEventListener("input", debounce(function() {
            appState.recordsSearch = this.value.trim();
            appState.recordsPage = 1;
            loadRecords();
        }, 300));
    }

    // Records status filter
    const recordsStatusFilter = document.getElementById("recordsStatusFilter");
    if (recordsStatusFilter) {
        recordsStatusFilter.addEventListener("change", function() {
            appState.recordsStatus = this.value;
            appState.recordsPage = 1;
            loadRecords();
        });
    }

    // Records pagination
    const prevBtn = document.getElementById("recordsPrevBtn");
    const nextBtn = document.getElementById("recordsNextBtn");
    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            if (appState.recordsPage > 1) {
                appState.recordsPage--;
                loadRecords();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            if (appState.recordsPage * 15 < appState.recordsTotal) {
                appState.recordsPage++;
                loadRecords();
            }
        });
    }

    // Alerts filter & search
    const alertSevFilter = document.getElementById("alertSeverityFilter");
    const alertSearch = document.getElementById("alertSearchInput");
    if (alertSevFilter) {
        alertSevFilter.addEventListener("change", function() {
            appState.alertsSeverity = this.value;
            loadAlerts();
        });
    }
    if (alertSearch) {
        alertSearch.addEventListener("input", debounce(function() {
            appState.alertsSearch = this.value.trim();
            loadAlerts();
        }, 300));
    }

    // Supply search
    const supplySearch = document.getElementById("supplySearchInput");
    if (supplySearch) {
        supplySearch.addEventListener("input", debounce(function() {
            appState.supplySearch = this.value.trim();
            loadSupplyLogs();
        }, 300));
    }

    // AI Diagnostics & Operational Intelligence wiring
    const btnGenerateAi = document.getElementById("btnGenerateAiReport");
    if (btnGenerateAi) {
        btnGenerateAi.addEventListener("click", () => generateAIDiagnosticReportUI());
    }

    const btnRetryAi = document.getElementById("btnRetryAiReport");
    if (btnRetryAi) {
        btnRetryAi.addEventListener("click", () => generateAIDiagnosticReportUI());
    }

    const btnCopyAi = document.getElementById("btnCopyAiReport");
    if (btnCopyAi) {
        btnCopyAi.addEventListener("click", () => copyCurrentAiReport());
    }

    const aiInquiryForm = document.getElementById("aiInquiryForm");
    if (aiInquiryForm) {
        aiInquiryForm.addEventListener("submit", (e) => {
            e.preventDefault();
            handleAIInquiry();
        });
    }

    const btnSubmitAiInquiry = document.getElementById("btnSubmitAiInquiry");
    if (btnSubmitAiInquiry) {
        btnSubmitAiInquiry.addEventListener("click", (e) => {
            e.preventDefault();
            handleAIInquiry();
        });
    }

    const btnCloseInquiry = document.getElementById("btnCloseInquiryResult");
    if (btnCloseInquiry) {
        btnCloseInquiry.addEventListener("click", () => {
            const box = document.getElementById("aiInquiryResultBox");
            if (box) box.style.display = "none";
        });
    }

    const promptChips = document.querySelectorAll(".ai-chip-btn");
    promptChips.forEach(chip => {
        chip.addEventListener("click", function() {
            const q = this.getAttribute("data-query");
            const input = document.getElementById("aiInquiryInput");
            if (input) input.value = q;
            handleAIInquiry(q);
        });
    });

    // Initial setup
    verifyStoredAuth();
    fetchLatestTelemetry();
    loadRecentReadings();

    // Check simulator status on startup
    apiRequest("/api/simulator/status", "GET")
        .then(res => {
            appState.isSimRunning = res.is_running;
            if (simToggle) simToggle.checked = res.is_running;
        })
        .catch(() => {});

    // Periodic telemetry polling (3s per NFR-01)
    appState.pollInterval = setInterval(() => {
        fetchLatestTelemetry();
        if (appState.currentPage === "dashboard") loadRecentReadings();
        if (appState.currentPage === "monitoring") loadMonitoringStream();
    }, 3000);
});

// Global app interface for inline event attributes
window.app = {
    injectReading,
    openLoginModal,
    closeLoginModal,
    fillCredentials,
    ackAlert,
    deleteAlert,
    deleteReadingRecord,
    deleteSupplyRecord,
    toggleSupply,
    generateAIDiagnosticReport: generateAIDiagnosticReportUI,
    askAiAnalyst: handleAIInquiry,
    copyAiReport: copyCurrentAiReport,
    refreshAll: () => {
        fetchLatestTelemetry();
        loadRecentReadings();
        showToast("Telemetry refreshed.", "success");
    }
};