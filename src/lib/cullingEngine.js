import * as turf from '@turf/turf';
import { getRoofClusterCount, updateLeadTier } from './supabaseRPC';

export function applyStatuteWindow(lead) {
  if (!lead.last_storm_date) {
    return { passed: false, reason: 'No storm date recorded', claimDeadline: null, daysRemaining: null };
  }
  
  const stormDate = new Date(lead.last_storm_date);
  let monthsToAdd = 12;
  if (lead.state === 'IN') monthsToAdd = 24;
  else if (lead.state === 'MI') monthsToAdd = 12;
  
  const deadline = new Date(stormDate);
  deadline.setMonth(deadline.getMonth() + monthsToAdd);
  
  const today = new Date();
  const daysRemaining = Math.floor((deadline - today) / (1000 * 60 * 60 * 24));
  
  if (daysRemaining < 0) {
    return { passed: false, reason: 'Statute window expired', claimDeadline: deadline, daysRemaining };
  } else if (daysRemaining < 90) {
    return { passed: true, reason: 'CRITICAL: Window closes in ' + daysRemaining + ' days', claimDeadline: deadline, daysRemaining };
  } else {
    return { passed: true, reason: daysRemaining + ' days remaining', claimDeadline: deadline, daysRemaining };
  }
}

export function applyAutoTier3Flags(lead) {
  if (lead.has_tax_delinquency === true) {
    return { isAutoTier3: true, reason: 'Tax delinquency > 1 year' };
  }
  if (lead.has_mechanic_lien === true) {
    return { isAutoTier3: true, reason: 'Active mechanic lien' };
  }
  return { isAutoTier3: false, reason: '' };
}

export function checkHailSwathIntersection(lead, hailEvents) {
  if (!lead.latitude || !lead.longitude) {
    return { inSwath: false, matchedEvent: null };
  }
  
  const point = turf.point([lead.longitude, lead.latitude]);
  
  for (const hailEvent of hailEvents) {
    if (hailEvent.temp_geom_json) {
      try {
        const geom = JSON.parse(hailEvent.temp_geom_json);
        if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
          const polygon = geom.type === 'Polygon' ? turf.polygon(geom.coordinates) : turf.multiPolygon(geom.coordinates);
          if (turf.booleanPointInPolygon(point, polygon)) {
            return { inSwath: true, matchedEvent: hailEvent };
          }
        }
      } catch (e) {
        // skip silently
      }
    }
  }
  return { inSwath: false, matchedEvent: null };
}

export async function runFullCullingPass(leads, hailEvents, tenantId) {
  const updatedLeads = [];
  
  for (const lead of leads) {
    const updatedLead = { ...lead };
    let isTier3 = false;
    
    // 1. Auto Tier 3
    const autoTier3 = applyAutoTier3Flags(lead);
    if (autoTier3.isAutoTier3) {
      updatedLead.priority_status = 'Tier 3';
      updatedLead.lead_score = 0;
      updatedLead.auto_tier3_reason = autoTier3.reason;
      isTier3 = true;
    }
    
    // 2. Statute Window
    const statute = applyStatuteWindow(lead);
    updatedLead.claim_deadline = statute.claimDeadline ? statute.claimDeadline.toISOString() : null;
    updatedLead.days_until_deadline = statute.daysRemaining;
    
    if (!isTier3 && !statute.passed) {
      updatedLead.priority_status = 'Tier 3';
      updatedLead.statute_reason = statute.reason;
      isTier3 = true;
    }
    
    // 3. Hail Swath Intersection
    const swath = checkHailSwathIntersection(lead, hailEvents);
    if (swath.inSwath) {
      updatedLead.is_hot_storm_lead = true;
      updatedLead.hail_event_id = swath.matchedEvent.id;
    } else {
      updatedLead.is_hot_storm_lead = false;
      updatedLead.hail_event_id = null;
    }
    
    // 4. Roof Cluster Count
    try {
      const clusterCount = await getRoofClusterCount(lead.latitude, lead.longitude, 6, tenantId);
      updatedLead.neighborhood_roof_cluster_count = clusterCount;
    } catch (e) {
      updatedLead.neighborhood_roof_cluster_count = 0;
    }
    
    // Calculate score and tier if not Tier 3
    if (!isTier3) {
      let score = 50; // base score
      if (updatedLead.is_hot_storm_lead) score += 30;
      if (updatedLead.neighborhood_roof_cluster_count > 5) score += 20;
      
      updatedLead.lead_score = score;
      if (score >= 80) updatedLead.priority_status = 'Tier 1';
      else updatedLead.priority_status = 'Tier 2';
    }
    
    updatedLeads.push(updatedLead);
  }
  
  return updatedLeads;
}

export async function writeCullingResults(updatedLeads) {
  let updated = 0;
  const errors = [];
  
  const chunkSize = 100;
  for (let i = 0; i < updatedLeads.length; i += chunkSize) {
    const chunk = updatedLeads.slice(i, i + chunkSize);
    
    for (const lead of chunk) {
      try {
        await updateLeadTier(lead.id, lead.priority_status, lead.lead_score, lead.days_until_deadline, lead.claim_deadline);
        updated++;
      } catch (err) {
        errors.push({ id: lead.id, error: err.message });
      }
    }
  }
  
  return { updated, errors };
}
