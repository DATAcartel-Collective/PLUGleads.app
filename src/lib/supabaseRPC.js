import { supabase } from './supabaseClient';

/*
-- MIGRATION: Run this in Supabase SQL Editor before using this function
CREATE OR REPLACE FUNCTION link_permits_to_leads()
RETURNS void AS $$
BEGIN
  UPDATE permits p
  SET lead_id = l.id
  FROM leads l
  WHERE LOWER(TRIM(p.address)) = LOWER(TRIM(l.address))
    AND p.lead_id IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- MIGRATION:
CREATE OR REPLACE FUNCTION recalculate_deadline_days()
RETURNS void AS $$
BEGIN
  UPDATE leads
  SET days_until_deadline = EXTRACT(DAY FROM (claim_deadline - CURRENT_DATE))::INTEGER
  WHERE claim_deadline IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
*/

export async function linkPermitsToLeads() {
  const { error } = await supabase.rpc('link_permits_to_leads');
  if (error) throw error;
}

export async function recalculateDeadlineDays() {
  const { error } = await supabase.rpc('recalculate_deadline_days');
  if (error) throw error;
}

export async function getRoofClusterCount(latitude, longitude, months = 6, tenantId = null) {
  const { data, error } = await supabase.rpc('get_roof_cluster_count', {
    p_latitude: latitude,
    p_longitude: longitude,
    p_months: months,
    p_tenant_id: tenantId
  });
  if (error) throw error;
  return data;
}

export async function cullingGetLeadsByTenant(tenantId) {
  const { data, error } = await supabase
    .from('leads')
    .select('id, address, state, latitude, longitude, last_storm_date, claim_deadline, days_until_deadline, priority_status, lead_score, has_tax_delinquency, has_mechanic_lien, hail_event_id')
    .eq('tenant_id', tenantId);
  if (error) throw error;
  return data;
}

export async function updateLeadTier(leadId, priorityStatus, leadScore, daysUntilDeadline, claimDeadline) {
  const { error } = await supabase
    .from('leads')
    .update({ priority_status: priorityStatus, lead_score: leadScore, days_until_deadline: daysUntilDeadline, claim_deadline: claimDeadline, updated_at: new Date().toISOString() })
    .eq('id', leadId);
  if (error) throw error;
}
