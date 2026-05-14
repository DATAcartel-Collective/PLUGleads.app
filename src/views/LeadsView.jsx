import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import { ROOFING_PHYSICS } from '../lib/roofingAnimations';
import axios from 'axios';

export default function LeadsView() {
  const [tenantId, setTenantId] = useState('');
  const [batchleadsApiKey, setBatchleadsApiKey] = useState('');
  const [skipTraceSpend, setSkipTraceSpend] = useState(0);

  const [leads, setLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Filters and sort
  const [activeTier, setActiveTier] = useState('ALL'); // ALL, TIER 1, TIER 2, TIER 3
  const [activeSort, setActiveSort] = useState('Score (High→Low)');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal
  const [selectedLead, setSelectedLead] = useState(null);
  const [permits, setPermits] = useState([]);
  const [callLogs, setCallLogs] = useState([]);
  const [smsLogs, setSmsLogs] = useState([]);

  const [phonesRevealed, setPhonesRevealed] = useState(false);
  const [projectValue, setProjectValue] = useState('');
  const [showProjectValueInput, setShowProjectValueInput] = useState(false);

  const [skipTraceModal, setSkipTraceModal] = useState({ isOpen: false, lead: null });

  useEffect(() => {
    if (tenantId) {
      loadLeads();
      loadSkipTraceSpend();
    }
  }, [tenantId]);

  async function loadLeads() {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('lead_score', { ascending: false });
    if (data) {
      setLeads(data);
    }
    setIsLoading(false);
  }

  async function loadSkipTraceSpend() {
    const { data } = await supabase.from('skip_trace_requests').select('cost_per_hit').eq('tenant_id', tenantId);
    if (data) {
      const total = data.reduce((acc, curr) => acc + (curr.cost_per_hit || 0), 0);
      setSkipTraceSpend(total);
    }
  }



  async function confirmSkipTrace() {
    const lead = skipTraceModal.lead;
    setSkipTraceModal({ isOpen: false, lead: null });

    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, skip_trace_status: 'IN_PROGRESS' } : l));
    await supabase.from('leads').update({ skip_trace_status: 'IN_PROGRESS' }).eq('id', lead.id);

    try {
      const response = await axios.post('https://api.batchleads.io/v2/skip-trace', {
        addresses: [{ street: lead.address, city: lead.city, state: lead.state, zip: lead.zip_code || '00000' }]
      }, {
        headers: { Authorization: `Bearer ${batchleadsApiKey}` }
      });

      const phoneNumbers = response.data.results?.[0]?.phone_numbers || [];

      await supabase.from('leads').update({
        phone_numbers: phoneNumbers,
        skip_trace_status: 'COMPLETE',
        skip_traced_at: new Date().toISOString()
      }).eq('id', lead.id);

      await supabase.from('skip_trace_requests').insert({
        tenant_id: tenantId,
        lead_id: lead.id,
        cost_per_hit: 0.02,
        result_count: phoneNumbers.length,
        raw_response: response.data,
        requested_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
      });

      setLeads(prev => prev.map(l => l.id === lead.id ? {
        ...l,
        skip_trace_status: 'COMPLETE',
        phone_numbers: phoneNumbers
      } : l));

      loadSkipTraceSpend();

    } catch (err) {
      await supabase.from('leads').update({ skip_trace_status: 'FAILED' }).eq('id', lead.id);
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, skip_trace_status: 'FAILED' } : l));
    }
  }

  async function openLeadDetails(lead) {
    setSelectedLead(lead);
    setPhonesRevealed(false);
    setShowProjectValueInput(lead.lead_status === 'SOLD');
    setProjectValue(lead.project_value || '');

    // Fetch related records
    const [permitsRes, callsRes, smsRes] = await Promise.all([
      supabase.from('permits').select('*').eq('lead_id', lead.id),
      supabase.from('call_logs').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false }),
      supabase.from('sms_logs').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false })
    ]);

    setPermits(permitsRes.data || []);
    setCallLogs(callsRes.data || []);
    setSmsLogs(smsRes.data || []);
  }

  function closeLeadDetails() {
    setSelectedLead(null);
    setPhonesRevealed(false);
    setShowProjectValueInput(false);
  }

  async function updateLeadStatus(newStatus) {
    if (newStatus === 'SOLD' && !showProjectValueInput) {
      setShowProjectValueInput(true);
      return;
    }

    const updates = { lead_status: newStatus };
    if (newStatus === 'SOLD') {
      updates.project_value = parseFloat(projectValue) || 0;
    }

    await supabase.from('leads').update(updates).eq('id', selectedLead.id);

    setSelectedLead(prev => ({ ...prev, ...updates }));
    setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, ...updates } : l));
  }

  const filteredLeads = leads.filter(lead => {
    if (activeTier !== 'ALL' && lead.priority_status?.toUpperCase() !== activeTier) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const address = lead.address?.toLowerCase() || '';
      const name = lead.homeowner_name?.toLowerCase() || '';
      if (!address.includes(query) && !name.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (activeSort === 'Score (High→Low)') {
      return (b.lead_score || 0) - (a.lead_score || 0);
    } else if (activeSort === 'Deadline (Soonest)') {
      const aDays = a.days_until_deadline ?? Infinity;
      const bDays = b.days_until_deadline ?? Infinity;
      return aDays - bDays;
    } else if (activeSort === 'Assessed Value (High→Low)') {
      return (b.assessed_value || 0) - (a.assessed_value || 0);
    }
    return 0;
  });

  return (
    <div className="p-4 sm:p-6 pb-32 font-mono text-white min-h-screen max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="mb-8 border-b border-zinc-800 pb-4">
        <h1 className="page-title">LEADS DASHBOARD</h1>
        <p className="secondary-text">AI-Scored & Tiered Roofing Prospects</p>
      </div>

      {/* CONFIGURATION INPUTS */}
      <div className="mb-6 flex flex-col md:flex-row gap-4">
        <input
          type="text"
          placeholder="Enter Tenant ID"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          data-testid="leads-tenant-input"
          className="w-full md:w-1/3 bg-[#18181b] border border-[#27272a] text-white px-4 h-[44px] rounded-lg text-[13px] focus:border-[#06b6d4] outline-none font-mono"
        />
        <div className="flex flex-col md:w-1/3">
          <label className="label-text mb-1">BATCHLEADS API KEY</label>
          <input
            type="password"
            placeholder="Batchleads API Key"
            value={batchleadsApiKey}
            onChange={(e) => setBatchleadsApiKey(e.target.value)}
            data-testid="batchleads-api-input"
            className="w-full bg-[#18181b] border border-[#27272a] text-white px-4 h-[44px] rounded-lg text-[13px] focus:border-[#06b6d4] outline-none font-mono"
          />
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="flex flex-col lg:flex-row gap-4 mb-8 items-center justify-between" data-testid="leads-filter-bar">
        <div className="flex space-x-2 overflow-x-auto w-full lg:w-auto pb-2 lg:pb-0">
          {['ALL', 'TIER 1', 'TIER 2', 'TIER 3'].map(tier => (
            <button
              key={tier}
              onClick={() => setActiveTier(tier)}
              className={`px-4 h-[36px] rounded text-[11px] whitespace-nowrap font-bold border transition-colors ${activeTier === tier
                ? 'bg-[#06b6d4] text-[#09090b] border-[#06b6d4]'
                : 'bg-[#18181b] text-zinc-400 border-[#27272a] hover:bg-zinc-800'
                }`}
            >
              {tier}
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row gap-4 w-full lg:w-auto items-center">
          <div data-testid="skip-trace-spend" className="text-green-400 text-[11px] font-bold border border-green-500/30 bg-green-900/20 px-3 h-[36px] flex items-center rounded w-full md:w-auto justify-center">
            SKIP TRACE SPEND: ${skipTraceSpend.toFixed(2)}
          </div>

          <select
            value={activeSort}
            onChange={(e) => setActiveSort(e.target.value)}
            className="bg-[#18181b] border border-[#27272a] text-white px-4 h-[36px] rounded text-[11px] outline-none w-full md:w-auto focus:border-[#06b6d4] font-mono"
          >
            <option>Score (High→Low)</option>
            <option>Deadline (Soonest)</option>
            <option>Assessed Value (High→Low)</option>
          </select>

          <input
            type="text"
            placeholder="Search address or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-[#18181b] border border-[#27272a] text-white px-4 h-[36px] rounded text-[11px] outline-none w-full md:w-64 focus:border-[#06b6d4] font-mono"
          />
        </div>
      </div>

      {/* LEAD CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
        {isLoading ? (
            Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="global-card animate-pulse rounded-xl p-5 h-[320px]"></div>
            ))
        ) : (
            <AnimatePresence>
            {filteredLeads.map(lead => {
                let tierLabel = 'TIER 3';
                let tierClass = 'tier-3-badge';
                let borderColor = '#52525b';
                let progressColor = '#52525b';
                
                if (lead.priority_status === 'Tier 1' || lead.lead_score >= 75) {
                  tierLabel = 'TIER 1';
                  tierClass = 'tier-1-badge';
                  borderColor = '#4ade80';
                  progressColor = '#4ade80';
                } else if (lead.priority_status === 'Tier 2' || (lead.lead_score >= 50 && lead.lead_score < 75)) {
                  tierLabel = 'TIER 2';
                  tierClass = 'tier-2-badge';
                  borderColor = '#facc15';
                  progressColor = '#facc15';
                }
                
                const isTier1 = tierLabel === 'TIER 1';
                const daysLeft = lead.days_until_deadline;
                const isUrgent = daysLeft !== null && daysLeft < 30;

                const circumference = 2 * Math.PI * 26; // ~163.36
                const score = lead.lead_score || 0;
                const strokeDashoffset = circumference - (score / 100) * circumference;
                
                const cardGlow = isTier1 ? { boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 20px rgba(91,33,182,0.3)' } : {};

                return (
                <motion.div
                    key={lead.id}
                    variants={ROOFING_PHYSICS.shingleSlide}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    style={{ borderLeft: `3px solid ${borderColor}`, ...cardGlow }}
                    className={`global-card rounded-xl p-5 flex flex-col`}
                >
                    {/* Top: Tier Badge & Score */}
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex flex-col space-y-2">
                        <div className="flex items-center space-x-2">
                          <span className={`tier-badge ${tierClass}`}>
                            {tierLabel}
                          </span>
                          {lead.skip_trace_status === 'COMPLETE' && (
                          <span className="text-green-400 text-[10px] font-mono font-bold bg-green-900/30 px-2 py-0.5 rounded uppercase">TRACED ✓</span>
                          )}
                          {lead.skip_trace_status === 'FAILED' && (
                          <span className="text-red-400 text-[10px] font-mono font-bold bg-red-900/30 px-2 py-0.5 rounded uppercase">FAILED</span>
                          )}
                        </div>
                        {isUrgent && (
                          <div className="bg-red-500/20 text-red-400 border border-red-500/50 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase animate-pulse w-max">
                            URGENT DEADLINE
                          </div>
                        )}
                      </div>
                      
                      <div className="relative w-[60px] h-[60px] flex items-center justify-center">
                          <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                              <circle cx="30" cy="30" r="26" stroke="#27272a" strokeWidth="4" fill="none" />
                              <motion.circle 
                                  cx="30" cy="30" r="26" 
                                  stroke={progressColor} strokeWidth="4" fill="none" 
                                  strokeDasharray={circumference} 
                                  initial={{ strokeDashoffset: circumference }}
                                  animate={{ strokeDashoffset }}
                                  transition={{ duration: 1.5, ease: "easeOut" }}
                                  strokeLinecap="round"
                              />
                          </svg>
                          <span className="text-[32px] font-bold font-mono text-[#06b6d4] z-10">{score}</span>
                      </div>
                    </div>

                    {/* Address & Homeowner */}
                    <div className="mb-2">
                      <h3 className="font-bold text-[14px] text-white truncate">{lead.homeowner_name || 'Unknown Owner'}</h3>
                      <p className="text-zinc-400 text-[12px] truncate">{lead.address}</p>
                    </div>

                    {/* Phone Numbers Display if Traced */}
                    {lead.skip_trace_status === 'COMPLETE' && lead.phone_numbers && lead.phone_numbers.length > 0 && (
                    <div className="mb-2 bg-[#09090b] border border-[#27272a] p-2 rounded-lg">
                        {lead.phone_numbers.slice(0, 2).map((ph, idx) => (
                        <div key={idx} className="text-[11px] text-zinc-300 tracking-widest font-mono">
                            ***-***-{ph.number?.slice(-4)} <span className="text-zinc-500 ml-1">({ph.type || 'phone'})</span>
                        </div>
                        ))}
                        {lead.phone_numbers.length > 2 && <div className="text-[11px] text-zinc-500 mt-1">+{lead.phone_numbers.length - 2} more...</div>}
                    </div>
                    )}

                    {/* Archetype */}
                    <div className="mb-3 italic text-zinc-500 text-[11px]">
                    {lead.lead_archetype || 'Unclassified'}
                    </div>

                    {/* Dynamic Pitch */}
                    <div className="mb-4 text-[#06b6d4] text-[11px] italic leading-relaxed flex-grow overflow-hidden text-ellipsis line-clamp-2">
                    "{lead.dynamic_sales_pitch || 'No pitch generated.'}"
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2 mt-auto pt-4 border-t border-[#27272a]">
                    <button
                        disabled={!isTier1 || lead.skip_trace_status === 'IN_PROGRESS' || lead.skip_trace_status === 'COMPLETE'}
                        onClick={() => setSkipTraceModal({ isOpen: true, lead })}
                        className={`w-full py-2 rounded-lg text-[11px] font-mono font-bold transition-colors border ${isTier1 && lead.skip_trace_status !== 'COMPLETE' && lead.skip_trace_status !== 'IN_PROGRESS'
                        ? 'bg-transparent text-[#4ade80] border-[#4ade80] hover:bg-[#4ade80]/10'
                        : 'bg-transparent text-zinc-600 cursor-not-allowed border-zinc-800'
                        }`}
                    >
                        {lead.skip_trace_status === 'IN_PROGRESS' ? 'TRACING...' : 'SKIP TRACE'}
                    </button>
                    <button
                        onClick={() => openLeadDetails(lead)}
                        className="w-full bg-transparent hover:bg-[#06b6d4]/10 text-[#06b6d4] py-2 rounded-lg text-[11px] font-mono font-bold transition-colors border border-[#06b6d4]"
                    >
                        VIEW DETAILS
                    </button>
                    </div>
                </motion.div>
                );
            })}
            </AnimatePresence>
        )}

        {!isLoading && filteredLeads.length === 0 && (
          <div className="col-span-1 md:col-span-2 lg:col-span-3 p-12 text-center border-2 border-dashed border-[#27272a] rounded-xl flex flex-col items-center justify-center global-card">
            <svg className="w-16 h-16 text-zinc-600 mb-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 22V12h6v10" />
            </svg>
            <span className="text-zinc-400 font-mono">NO LEADS SCORED YET</span>
          </div>
        )}
      </div>



      {/* SKIP TRACE CONFIRMATION MODAL */}
      <AnimatePresence>
        {skipTraceModal.isOpen && skipTraceModal.lead && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSkipTraceModal({ isOpen: false, lead: null })}
              className="absolute inset-0 bg-black/80"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="global-card border border-[#06b6d4] w-full max-w-md rounded-xl relative z-10 p-6"
            >
              <h2 className="text-xl font-bold text-white mb-4 font-mono">INITIATE SKIP TRACE?</h2>
              <div className="bg-[#09090b] p-4 rounded-lg mb-4 text-sm font-mono space-y-2 border border-[#27272a]">
                <p className="text-zinc-300">Address: <span className="text-white font-bold">{skipTraceModal.lead.address}</span></p>
                <p className="text-zinc-300">Cost: <span className="text-green-400 font-bold">$0.02 per hit</span></p>
              </div>
              <p className="text-zinc-400 text-[13px] mb-6">
                This will query Batchleads.io and add phone numbers to this lead.
              </p>
              <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
                <button
                  onClick={() => setSkipTraceModal({ isOpen: false, lead: null })}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-white py-3 rounded-lg font-bold transition-colors text-[13px] font-mono"
                >
                  CANCEL
                </button>
                <button
                  onClick={confirmSkipTrace}
                  className="w-full bg-[#06b6d4] hover:bg-cyan-400 text-black py-3 rounded-lg font-bold transition-colors text-[13px] font-mono"
                >
                  CONFIRM — NAIL IT
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* LEAD DETAIL MODAL */}
      <AnimatePresence>
        {selectedLead && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeLeadDetails}
              className="absolute inset-0 bg-black/80"
            />
            <motion.div
              data-testid="lead-detail-modal"
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="global-card border border-[#06b6d4] w-full max-w-5xl h-[90vh] rounded-xl relative z-10 flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 border-b border-[#27272a] bg-[#10101a] gap-4">
                <div>
                  <h2 className="text-xl font-bold text-[#06b6d4]">{selectedLead.address}</h2>
                  <p className="text-zinc-400 text-sm">{selectedLead.homeowner_name || 'Unknown Owner'}</p>
                </div>

                {/* LEAD STATUS UPDATE */}
                <div className="flex items-end sm:items-center space-x-4 w-full sm:w-auto">
                  <div className="flex flex-col w-full sm:w-auto">
                    <label className="label-text mb-1">STATUS</label>
                    <select
                      data-testid="lead-status-dropdown"
                      value={selectedLead.lead_status || 'NEW'}
                      onChange={(e) => updateLeadStatus(e.target.value)}
                      className="bg-[#18181b] text-white text-[13px] border border-[#27272a] px-3 h-[36px] rounded-lg outline-none focus:border-[#06b6d4] font-mono"
                    >
                      <option value="NEW">NEW</option>
                      <option value="CONTACTED">CONTACTED</option>
                      <option value="APPOINTMENT_SET">APPOINTMENT SET</option>
                      <option value="DEAD">DEAD</option>
                      <option value="SOLD">SOLD</option>
                    </select>
                  </div>

                  {showProjectValueInput && (
                    <div className="flex flex-col w-full sm:w-auto">
                      <label className="label-text mb-1">PROJECT VALUE ($)</label>
                      <div className="flex space-x-2">
                        <input
                          type="number"
                          value={projectValue}
                          onChange={(e) => setProjectValue(e.target.value)}
                          className="bg-[#18181b] border border-[#27272a] text-white px-3 h-[36px] rounded-lg text-[13px] w-24 outline-none focus:border-[#06b6d4] font-mono"
                        />
                        <button
                          onClick={() => updateLeadStatus('SOLD')}
                          className="bg-green-600 hover:bg-green-500 text-white px-3 rounded-lg text-[11px] font-bold font-mono h-[36px]"
                        >
                          SAVE
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={closeLeadDetails}
                    className="ml-0 sm:ml-4 text-zinc-400 hover:text-white text-2xl font-light w-[36px] h-[36px] flex items-center justify-center rounded-lg bg-[#27272a]"
                  >
                    &times;
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-8 custom-log-scrollbar">

                {/* LEFT COLUMN */}
                <div className="space-y-8">

                  {/* Property Data */}
                  <section>
                    <h3 className="section-header mb-4 border-b border-[#27272a] pb-2">PROPERTY DATA</h3>
                    <div className="grid grid-cols-2 gap-y-2 text-[13px] font-mono">
                      <span className="text-zinc-400">Assessed Value:</span>
                      <span className="text-right">${selectedLead.assessed_value?.toLocaleString() || 'N/A'}</span>
                      <span className="text-zinc-400">Year Built:</span>
                      <span className="text-right">{selectedLead.year_built || 'N/A'}</span>
                      <span className="text-zinc-400">Square Footage:</span>
                      <span className="text-right">{selectedLead.square_footage?.toLocaleString() || 'N/A'}</span>
                      <span className="text-zinc-400">Days Until Deadline:</span>
                      <span className="text-right">{selectedLead.days_until_deadline !== null ? selectedLead.days_until_deadline : 'N/A'}</span>
                      <span className="text-zinc-400">Commission Amount:</span>
                      <span className="text-right text-green-400 font-bold">{selectedLead.commission_amount ? `$${selectedLead.commission_amount}` : '-'}</span>
                    </div>
                  </section>

                  {/* Phone Numbers Reveal */}
                  {selectedLead.phone_numbers && selectedLead.phone_numbers.length > 0 && (
                    <section className="bg-[#18181b] border border-[#27272a] p-4 rounded-lg">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="section-header">CONTACT INFO</h3>
                        {!phonesRevealed && (
                          <button
                            onClick={() => setPhonesRevealed(true)}
                            className="bg-[#06b6d4] text-black px-3 py-1 rounded text-[11px] font-bold hover:bg-cyan-400 font-mono"
                          >
                            REVEAL NUMBERS
                          </button>
                        )}
                      </div>

                      <div className="space-y-2 mb-4">
                        {selectedLead.phone_numbers.map((ph, idx) => (
                          <div key={idx} className="flex justify-between bg-[#09090b] p-2 rounded-lg border border-[#27272a]">
                            <span className="text-[#06b6d4] font-bold tracking-widest text-lg font-mono">
                              {phonesRevealed ? ph.number : `***-***-${ph.number?.slice(-4)}`}
                            </span>
                            <span className="text-zinc-500 text-[11px] uppercase font-mono">{ph.type || 'PHONE'}</span>
                          </div>
                        ))}
                      </div>

                      <p className="text-zinc-500 text-[10px] uppercase leading-tight italic">
                        DATAcartel Collective LLC maintains the right to record all conversations conducted through this platform.
                      </p>
                    </section>
                  )}

                  {/* Images */}
                  <section>
                    <h3 className="section-header mb-4 border-b border-[#27272a] pb-2">SATELLITE IMAGES</h3>
                    <div className="flex flex-col sm:flex-row gap-4">
                      {selectedLead.satellite_image_url ? (
                        <img src={selectedLead.satellite_image_url} alt="Satellite Current" className="w-full sm:w-1/2 rounded-lg border border-[#27272a] object-cover" />
                      ) : (
                        <div className="w-full sm:w-1/2 aspect-square bg-[#18181b] border border-[#27272a] flex items-center justify-center text-zinc-600 text-[13px] text-center p-4 rounded-lg">No Current Image</div>
                      )}
                      {selectedLead.historical_image_url ? (
                        <img src={selectedLead.historical_image_url} alt="Satellite Historical" className="w-full sm:w-1/2 rounded-lg border border-[#27272a] object-cover" />
                      ) : (
                        <div className="w-full sm:w-1/2 aspect-square bg-[#18181b] border border-[#27272a] flex items-center justify-center text-zinc-600 text-[13px] text-center p-4 rounded-lg">No Historical Image</div>
                      )}
                    </div>
                  </section>

                  {/* Permit History */}
                  <section>
                    <h3 className="section-header mb-4 border-b border-[#27272a] pb-2">PERMIT HISTORY</h3>
                    {permits.length === 0 ? (
                      <p className="text-zinc-600 text-[13px] font-mono">No permits found.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[13px] text-left font-mono">
                          <thead className="text-zinc-500 border-b border-[#27272a]">
                            <tr>
                              <th className="py-2 pr-4">Date</th>
                              <th className="py-2 pr-4">Type</th>
                              <th className="py-2">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#27272a] text-zinc-300">
                            {permits.map(p => (
                              <tr key={p.id}>
                                <td className="py-2 pr-4">{new Date(p.created_at).toLocaleDateString()}</td>
                                <td className="py-2 pr-4">{p.permit_type}</td>
                                <td className="py-2">{p.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>

                {/* RIGHT COLUMN */}
                <div className="space-y-8">

                  {/* AI Scoring Output */}
                  <section>
                    <h3 className="section-header mb-4 border-b border-[#27272a] pb-2">AI SCORING OUTPUT</h3>
                    <div className="bg-[#18181b] p-4 rounded-lg border border-[#06b6d4]/30 space-y-4 text-[13px] font-mono">
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400">Score:</span>
                        <span className="text-[24px] font-bold text-[#06b6d4]">{selectedLead.lead_score}</span>
                      </div>
                      <div>
                        <span className="text-zinc-400 block mb-1">Financial Profile:</span>
                        <p className="text-zinc-300">{selectedLead.financial_profile || 'N/A'}</p>
                      </div>
                      {selectedLead.visual_analysis && (
                        <div>
                          <span className="text-zinc-400 block mb-1">Visual Analysis:</span>
                          <pre className="bg-[#09090b] p-3 rounded-lg text-zinc-300 text-[11px] overflow-x-auto border border-[#27272a] custom-log-scrollbar">
                            {JSON.stringify(selectedLead.visual_analysis, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Logs */}
                  <section>
                    <h3 className="section-header mb-4 border-b border-[#27272a] pb-2">COMMUNICATION LOGS</h3>

                    <div className="mb-4">
                      <h4 className="label-text mb-2">CALLS</h4>
                      {callLogs.length === 0 ? (
                        <p className="text-zinc-600 text-[13px] font-mono">No calls logged.</p>
                      ) : (
                        <div className="space-y-2 max-h-32 overflow-y-auto pr-2 custom-log-scrollbar">
                          {callLogs.map(log => (
                            <div key={log.id} className="bg-[#18181b] p-2 rounded-lg text-[11px] border border-[#27272a] flex justify-between font-mono">
                              <span className="text-zinc-400">{new Date(log.created_at).toLocaleString()}</span>
                              <span className="text-white font-bold">{log.outcome}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <h4 className="label-text mb-2">SMS</h4>
                      {smsLogs.length === 0 ? (
                        <p className="text-zinc-600 text-[13px] font-mono">No SMS logged.</p>
                      ) : (
                        <div className="space-y-2 max-h-32 overflow-y-auto pr-2 custom-log-scrollbar">
                          {smsLogs.map(log => (
                            <div key={log.id} className="bg-[#18181b] p-2 rounded-lg text-[11px] border border-[#27272a] flex justify-between font-mono">
                              <span className="text-zinc-400">{new Date(log.created_at).toLocaleString()}</span>
                              <span className="text-white font-bold">{log.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}