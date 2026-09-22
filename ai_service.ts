import { GoogleGenAI, Type } from "@google/genai";

export interface SystemTelemetryContext {
  total_readings: number;
  current_sediment: number;
  average_sediment: number;
  max_sediment: number;
  min_sediment: number;
  current_safe_limit: number;
  current_status: string;
  current_supply_status: string;
  control_mode: string;
  total_alerts: number;
  unacknowledged_alerts: number;
  supply_shutoff_incidents: number;
  compliance_rate_percent: number;
  recent_readings: Array<{ sediment_level: number; timestamp: string; status: string }>;
  recent_alerts: Array<{ severity: string; message: string; timestamp: string; acknowledged: boolean }>;
  recent_supply_logs: Array<{ status: string; reason: string; timestamp: string }>;
}

export interface AIDiagnosticReport {
  executive_summary: string;
  risk_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  risk_score: number; // 0 to 100
  sediment_trend: string;
  supply_safety_assessment: string;
  actionable_recommendations: string[];
  generated_at: string;
  source: "gemini-3.8-flash" | "rule-based-fallback";
}

let aiClient: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return aiClient;
}

/**
 * Generate a comprehensive diagnostic report using Gemini 3.8 Flash
 */
export async function generateAIDiagnosticReport(context: SystemTelemetryContext): Promise<AIDiagnosticReport> {
  const ai = getGenAI();
  const now = new Date().toISOString();

  if (!ai) {
    // Graceful fallback if API key is not yet configured in environment
    return buildFallbackReport(context, now);
  }

  const prompt = `You are the Lead Water Quality & Tank Infrastructure Intelligence Specialist for the SmartTank System.
Analyze the following live sensor telemetry and operational history:

Telemetry Context:
- Current Sediment Level: ${context.current_sediment.toFixed(1)}% (Threshold: ${context.current_safe_limit.toFixed(1)}%)
- Current Operational Status: ${context.current_status}
- Water Supply Valve: ${context.current_supply_status} (Mode: ${context.control_mode})
- Historical Average Sediment: ${context.average_sediment.toFixed(1)}%
- Historical Peak Sediment: ${context.max_sediment.toFixed(1)}%
- Historical Minimum Sediment: ${context.min_sediment.toFixed(1)}%
- Total Ingested Readings: ${context.total_readings}
- Safety Compliance Rate: ${context.compliance_rate_percent.toFixed(1)}%
- Total Alerts Triggered: ${context.total_alerts} (Unacknowledged: ${context.unacknowledged_alerts})
- Preventative Water Supply Shutoffs: ${context.supply_shutoff_incidents}
- Recent Readings: ${JSON.stringify(context.recent_readings.slice(0, 5))}
- Recent Alerts: ${JSON.stringify(context.recent_alerts.slice(0, 3))}
- Recent Supply Logs: ${JSON.stringify(context.recent_supply_logs.slice(0, 3))}

Provide an objective, technical, and actionable operational analysis in the requested JSON structure.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are an expert industrial automation and water quality control AI. Provide concise, professional, data-grounded assessments.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executive_summary: {
              type: Type.STRING,
              description: "2-3 sentence overview of current water tank health, sediment headroom, and operational readiness."
            },
            risk_level: {
              type: Type.STRING,
              description: "Risk category: LOW, MODERATE, HIGH, or CRITICAL"
            },
            risk_score: {
              type: Type.NUMBER,
              description: "Estimated contamination risk index from 0 to 100 based on headroom to safe limit and alert history."
            },
            sediment_trend: {
              type: Type.STRING,
              description: "Analysis of sediment accumulation rate, fluctuation patterns, and stability."
            },
            supply_safety_assessment: {
              type: Type.STRING,
              description: "Evaluation of the automated water supply valve actuation, safety cutoffs, and downstream contamination protection."
            },
            actionable_recommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "3 to 4 prioritized, specific operational steps for operators or administrators."
            }
          },
          required: [
            "executive_summary",
            "risk_level",
            "risk_score",
            "sediment_trend",
            "supply_safety_assessment",
            "actionable_recommendations"
          ]
        }
      }
    });

    const text = response.text?.trim();
    if (!text) {
      return buildFallbackReport(context, now);
    }

    const parsed = JSON.parse(text);
    return {
      executive_summary: parsed.executive_summary,
      risk_level: (["LOW", "MODERATE", "HIGH", "CRITICAL"].includes(parsed.risk_level) ? parsed.risk_level : "MODERATE") as any,
      risk_score: Math.max(0, Math.min(100, Math.round(parsed.risk_score || 25))),
      sediment_trend: parsed.sediment_trend,
      supply_safety_assessment: parsed.supply_safety_assessment,
      actionable_recommendations: Array.isArray(parsed.actionable_recommendations) ? parsed.actionable_recommendations : [],
      generated_at: now,
      source: "gemini-3.8-flash"
    };
  } catch (err) {
    console.error("Gemini API error generating diagnostic report:", err);
    return buildFallbackReport(context, now);
  }
}

/**
 * Handle targeted operator inquiries grounded in live telemetry
 */
export async function answerOperatorInquiry(query: string, context: SystemTelemetryContext): Promise<{ answer: string; source: string }> {
  const ai = getGenAI();

  if (!ai) {
    return {
      answer: `Telemetry Assessment: The water tank sediment level is currently ${context.current_sediment.toFixed(1)}% with a safety threshold of ${context.current_safe_limit.toFixed(1)}%. Current valve supply status is ${context.current_supply_status} in ${context.control_mode} mode with a ${context.compliance_rate_percent.toFixed(1)}% compliance rate.`,
      source: "system-rules"
    };
  }

  const prompt = `You are the SmartTank Operational Intelligence Assistant. Answer the operator's query directly, accurately, and professionally based exclusively on the current system telemetry provided below.

Telemetry State:
- Current Sediment: ${context.current_sediment.toFixed(1)}% (Safe Limit: ${context.current_safe_limit.toFixed(1)}%)
- Status: ${context.current_status}
- Supply Valve: ${context.current_supply_status} (${context.control_mode})
- Average Sediment: ${context.average_sediment.toFixed(1)}%
- Peak Sediment: ${context.max_sediment.toFixed(1)}%
- Total Readings: ${context.total_readings}
- Compliance: ${context.compliance_rate_percent.toFixed(1)}%
- Total Alerts: ${context.total_alerts} (${context.unacknowledged_alerts} unacknowledged)
- Preventative Shutoffs: ${context.supply_shutoff_incidents}

Operator Query: "${query}"

Guidelines:
- Keep the response direct, factual, and under 150 words.
- Reference actual telemetry numbers when relevant.
- Advise on immediate tank safety precautions if sediment is near or above the limit.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are an industrial water monitoring AI assistant. Respond in clear, crisp paragraphs with bullet points only where necessary."
      }
    });

    const text = response.text?.trim() || "No response could be generated.";
    return {
      answer: text,
      source: "gemini-3.8-flash"
    };
  } catch (err: any) {
    console.error("Gemini API error answering inquiry:", err);
    return {
      answer: `Unable to complete AI inquiry due to error: ${err.message || "Upstream service error"}. Current telemetry: Sediment is at ${context.current_sediment.toFixed(1)}% (Threshold: ${context.current_safe_limit.toFixed(1)}%).`,
      source: "error-fallback"
    };
  }
}

function buildFallbackReport(context: SystemTelemetryContext, now: string): AIDiagnosticReport {
  const margin = context.current_safe_limit - context.current_sediment;
  let riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" = "LOW";
  let riskScore = 15;

  if (margin <= 0) {
    riskLevel = "CRITICAL";
    riskScore = 95;
  } else if (margin <= 10) {
    riskLevel = "HIGH";
    riskScore = 75;
  } else if (margin <= 25) {
    riskLevel = "MODERATE";
    riskScore = 45;
  }

  const recs: string[] = [];
  if (riskLevel === "CRITICAL") {
    recs.push("Verify automatic valve shutoff closure to prevent sediment flow downstream.");
    recs.push("Initiate manual sediment purge or drainage valve cycle immediately.");
    recs.push("Check tank inlet filtration for silt intrusion or rupture.");
  } else if (riskLevel === "HIGH") {
    recs.push("Schedule tank bottom flushing within the next operational shift.");
    recs.push("Monitor optical turbidity sensor calibration for drift.");
    recs.push("Review safe limit threshold settings with system administrator.");
  } else {
    recs.push("Maintain standard quarterly tank inspection schedule.");
    recs.push("Verify automated supply shutoff failsafe test during next routine cycle.");
    recs.push("Continue continuous sensor logging and periodic CSV data archival.");
  }

  return {
    executive_summary: `SmartTank is operating with ${context.current_sediment.toFixed(1)}% sediment concentration against a ${context.current_safe_limit.toFixed(1)}% threshold (${margin > 0 ? margin.toFixed(1) + "% safety margin" : "THRESHOLD BREACHED"}). Water supply valve is currently ${context.current_supply_status}.`,
    risk_level: riskLevel,
    risk_score: riskScore,
    sediment_trend: `Average sediment across ${context.total_readings} logged readings is ${context.average_sediment.toFixed(1)}% with a historical maximum of ${context.max_sediment.toFixed(1)}%. Safety compliance rate stands at ${context.compliance_rate_percent.toFixed(1)}%.`,
    supply_safety_assessment: `The system has logged ${context.supply_shutoff_incidents} preventative supply shutoff incidents. Current control mode is ${context.control_mode} with ${context.unacknowledged_alerts} unacknowledged alerts.`,
    actionable_recommendations: recs,
    generated_at: now,
    source: "rule-based-fallback"
  };
}
