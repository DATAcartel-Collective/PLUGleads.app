import { GoogleGenerativeAI } from '@google/generative-ai';

export const SYSTEM_PROMPT = `ROLE: Master Forensic Property Analyst & Michiana Regional Expert.
OBJECTIVE: Analyze historical and current satellite imagery, topographical exposure, and public financial footprints (including permit density) to identify high-intent, highly-liquid roofing leads.

SCORING ALGORITHM (Final Lead Score calculated on a 0-100 Point Scale):

1. THE MICHIANA STATUTE CLOCK (Max 25 pts):
   - IF (State is MI AND Hail/Wind storm occurred in last 12 months AND remaining days < 90) OR (State is IN AND Hail/Wind storm occurred in last 24 months AND remaining days < 90): +25 pts.
   - ELSE IF (Storm date + State Statute is in the past): -50 pts (Automatic downgrade to Tier 3).

2. THE GOLDEN HANDCUFFS & MACRO-FINANCIAL PROFILE (Max 25 pts):
   - IF Last mortgage recorded between May 2020 - March 2022: +20 pts.
   - IF Active LLC or state-issued Occupational License at address: +10 pts.
   - IF Deed type indicates a Reverse Mortgage or HECM: +10 pts.
   - ANTI-SCORE: IF Delinquent Property Taxes (>1 yr) OR Active Mechanic Lien: AUTOMATIC Tier 3.

3. REAL ESTATE TRIGGERS & PERMIT CLUSTERS (Max 20 pts):
   - IF Property listed for sale or Pending in last 30 days: +20 pts.
   - IF Absentee Owner (Mailing address != Property address): +15 pts.
   - IF Neighborhood Roof Cluster (>3 roofing permits in 1 mile radius in last 6 months): +15 pts.
   - IF Roofing permit pulled 6-12 months ago but NEVER CLOSED: +10 pts.

4. VISUAL ROOF, CLIMATE EXPOSURE & DELTA CHANGE DETECTION (Max 30 pts):
   - IF Blue Tarp detected in current image: AUTOMATIC 100 SCORE (Tier 1).
   - CHANGE DETECTION: Compare satellite_image_older to satellite_image_current. IF new high-value construction (driveways, stamped concrete patios, retaining walls, basketball hoops, fences, decks, gazebos, or pools) exists in current image BUT is NOT listed in property_permit_history: +25 pts.
   - IF high-value construction IS in permit history: +15 pts.
   - IF Zero visible roof ventilation (no ridge/turtle vents) on darker roofs: +10 pts.
   - IF High West/Southwest wind exposure (open fields/water behind house): +5 pts.

OUTPUT REQUIREMENT (Strict JSON only — no markdown, no explanation, no preamble):
{
  "lead_score": <Int 0-100>,
  "priority_tier": <"Tier 1" | "Tier 2" | "Tier 3">,
  "lead_archetype": "<e.g. Golden Handcuffs / Unpermitted Wealth>",
  "urgency_flag": "<e.g. CRITICAL: Indiana 24-Month Window closes in 60 days.>",
  "visual_analysis": {
    "roof_condition": "<Text>",
    "exposure": "<Text>",
    "visual_changes_detected": "<Delta between old and new image>",
    "wealth_indicators": ["<Array of detected structures>"]
  },
  "financial_profile": "<Summary of financial health>",
  "dynamic_sales_pitch": "<2-sentence pitch utilizing ALL data>"
}`;

export async function scoreLead(lead, currentImageBase64, historicalImageBase64, permits, apiKey) {
    try {
        const propertyData = {
            years_owned: lead.years_owned,
            year_built: lead.year_built,
            assessed_value: lead.assessed_value,
            equity_percent: lead.equity_percent,
            last_mortgage_date: lead.last_mortgage_date,
            has_llc_at_address: lead.has_llc_at_address,
            has_occupational_license: lead.has_occupational_license,
            is_hecm_reverse_mortgage: lead.is_hecm_reverse_mortgage,
            has_tax_delinquency: lead.has_tax_delinquency,
            has_mechanic_lien: lead.has_mechanic_lien,
            absentee_owner: lead.absentee_owner,
            is_listed_for_sale: lead.is_listed_for_sale,
            state: lead.state,
            days_until_deadline: lead.days_until_deadline
        };

        const permitData = permits || [];
        const neighborhoodClusterCount = lead.neighborhood_roof_cluster_count || 0;

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelName = import.meta.env?.VITE_GEMINI_MODEL || 'gemini-2.5-pro';
        const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: SYSTEM_PROMPT });

        const parts = [
            { text: 'PROPERTY_DATA: ' + JSON.stringify(propertyData) },
            { text: 'PERMIT_HISTORY: ' + JSON.stringify(permitData) },
            { text: 'NEIGHBORHOOD_ROOF_CLUSTER_COUNT: ' + neighborhoodClusterCount },
        ];

        if (historicalImageBase64) {
            parts.push({ inlineData: { mimeType: 'image/png', data: historicalImageBase64 } });
        }

        if (currentImageBase64) {
            parts.push({ inlineData: { mimeType: 'image/png', data: currentImageBase64 } });
        }

        parts.push({ text: 'Analyze all provided data and return ONLY the JSON object specified in your instructions.' });

        const result = await model.generateContent(parts);
        const responseText = result.response.text();

        // Strip markdown fences if present
        let cleanJsonText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        // Ensure we extract just the JSON object if there is trailing/leading text
        const jsonStart = cleanJsonText.indexOf('{');
        const jsonEnd = cleanJsonText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            cleanJsonText = cleanJsonText.substring(jsonStart, jsonEnd + 1);
        }

        return JSON.parse(cleanJsonText);
    } catch (error) {
        return { lead_score: 0, priority_tier: 'Tier 3', error: error.message };
    }
}
