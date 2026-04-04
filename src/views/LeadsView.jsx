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

  // Audit Log
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);

  useEffect(() => {
    if (tenantId) {
      loadLeads();
      loadSkipTraceSpend();
      if (isLogOpen) loadAuditLogs();
    }
  }, [tenantId, isLogOpen]);

  async function loadLeads() {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('lead_score', { ascending: false });
    if (data) {
      setLeads(data);
    }
  }

  async function loadSkipTraceSpend() {
    const { data } = await supabase.from('skip_trace_requests').select('cost_per_hit').eq('tenant_id', tenantId);
    if (data) {
      const total = data.reduce((acc, curr) => acc + (curr.cost_per_hit || 0), 0);
      setSkipTraceSpend(total);
    }
  }

  async function loadAuditLogs() {
    const { data } = await supabase.from('skip_trace_requests')
      .select('requested_at, completed_at, cost_per_hit, result_count, lead_id, leads(address)')
      .eq('tenant_id', tenantId)
      .order('requested_at', { ascending: false })
      .limit(50);
    if (data) {
      setAuditLogs(data);
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
      if (isLogOpen) loadAuditLogs();

    } catch (error) {
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
    <div className="p-6 pb-32 font-mono text-white min-h-screen">
      {/* HEADER */}
      <div className="mb-8 border-b border-zinc-800 pb-4">
        <h1 className="text-3xl font-bold text-[#06b6d4]">LEADS DASHBOARD</h1>
        <p className="text-zinc-400 text-sm">AI-Scored & Tiered Roofing Prospects</p>
      </div>

      {/* CONFIGURATION INPUTS */}
      <div className="mb-6 flex flex-col md:flex-row gap-4">
        <input
          type="text"
          placeholder="Enter Tenant ID"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          data-testid="leads-tenant-input"
          className="w-full md:w-1/3 bg-zinc-900 border border-zinc-700 text-white p-2 rounded text-sm focus:border-[#06b6d4] outline-none"
        />
        <div className="flex flex-col md:w-1/3">
          <label className="text-xs text-zinc-400 mb-1">BATCHLEADS API KEY</label>
          <input
            type="password"
            placeholder="Batchleads API Key"
            value={batchleadsApiKey}
            onChange={(e) => setBatchleadsApiKey(e.target.value)}
            data-testid="batchleads-api-input"
            className="w-full bg-zinc-900 border border-zinc-700 text-white p-2 rounded text-sm focus:border-[#06b6d4] outline-none"
          />
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="flex flex-col lg:flex-row gap-4 mb-8 items-center justify-between" data-testid="leads-filter-bar">
        <div className="flex space-x-2">
          {['ALL', 'TIER 1', 'TIER 2', 'TIER 3'].map(tier => (
            <button
              key={tier}
              onClick={() => setActiveTier(tier)}
              className={`px-4 py-1.5 rounded text-sm font-bold border transition-colors ${activeTier === tier
                ? 'bg-[#06b6d4] text-zinc-950 border-[#06b6d4]'
                : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:bg-zinc-800'
                }`}
            >
              {tier}
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row gap-4 w-full lg:w-auto items-center">
          <div data-testid="skip-trace-spend" className="text-green-400 text-sm font-bold border border-green-500/30 bg-green-900/20 px-3 py-1.5 rounded mr-4">
            SKIP TRACE SPEND: ${skipTraceSpend.toFixed(2)}
          </div>

          <select
            value={activeSort}
            onChange={(e) => setActiveSort(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 text-white p-2 rounded text-sm outline-none w-full md:w-auto focus:border-[#06b6d4]"
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
            className="bg-zinc-900 border border-zinc-700 text-white p-2 rounded text-sm outline-none w-full md:w-64 focus:border-[#06b6d4]"
          />
        </div>
      </div>

      {/* LEAD CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <AnimatePresence>
          {filteredLeads.map(lead => {
            const isTier1 = lead.priority_status === 'Tier 1';
            const isTier2 = lead.priority_status === 'Tier 2';
            const borderClass = isTier1 ? 'border-green-500' : isTier2 ? 'border-yellow-500' : 'border-zinc-500';
            const badgeClass = isTier1 ? 'bg-green-900/50 text-green-400' : isTier2 ? 'bg-yellow-900/50 text-yellow-400' : 'bg-zinc-700 text-zinc-300';

            const daysLeft = lead.days_until_deadline;
            let daysClass = 'text-green-400';
            if (daysLeft < 30) daysClass = 'text-red-400';
            else if (daysLeft <= 60) daysClass = 'text-yellow-400';

            return (
              <motion.div
                key={lead.id}
                variants={ROOFING_PHYSICS.shingleSlide}
                initial="initial"
                animate="animate"
                exit="exit"
                className={`bg-zinc-800 border-2 ${borderClass} rounded-lg p-5 flex flex-col ${isTier1 ? 'animate-storm-front' : ''}`}
              >
                {/* Top: Tier Badge & Score */}
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${badgeClass}`}>
                      {lead.priority_status || 'TIER 3'}
                    </span>
                    {lead.skip_trace_status === 'COMPLETE' && (
                      <span className="text-green-400 text-xs font-bold bg-green-900/30 px-2 py-1 rounded">TRACED ✓</span>
                    )}
                    {lead.skip_trace_status === 'FAILED' && (
                      <span className="text-red-400 text-xs font-bold bg-red-900/30 px-2 py-1 rounded">FAILED</span>
                    )}
                  </div>
                  <span className="text-3xl font-bold text-[#06b6d4]">{lead.lead_score || 0}</span>
                </div>

                {/* Address & Homeowner */}
                <div className="mb-2">
                  <h3 className="font-bold text-lg truncate">{lead.address}</h3>
                  <p className="text-zinc-400 text-sm truncate">{lead.homeowner_name || 'Unknown Owner'}</p>
                </div>

                {/* Phone Numbers Display if Traced */}
                {lead.skip_trace_status === 'COMPLETE' && lead.phone_numbers && lead.phone_numbers.length > 0 && (
                  <div className="mb-2 bg-zinc-900 border border-zinc-700 p-2 rounded">
                    {lead.phone_numbers.slice(0, 2).map((ph, idx) => (
                      <div key={idx} className="text-xs text-zinc-300 tracking-widest">
                        ***-***-{ph.number?.slice(-4)} <span className="text-zinc-500 ml-1">({ph.type || 'phone'})</span>
                      </div>
                    ))}
                    {lead.phone_numbers.length > 2 && <div className="text-xs text-zinc-500 mt-1">+{lead.phone_numbers.length - 2} more...</div>}
                  </div>
                )}

                {/* Archetype */}
                <div className="mb-2 italic text-zinc-400 text-sm">
                  {lead.lead_archetype || 'Unclassified'}
                </div>

                {/* Urgency Flag */}
                {lead.urgency_flag && (
                  <div className={`mb-2 text-xs font-bold ${lead.urgency_flag.includes('CRITICAL') ? 'text-red-400' : 'text-yellow-400'}`}>
                    {lead.urgency_flag}
                  </div>
                )}

                {/* Deadline */}
                <div className={`mb-3 text-sm font-bold ${daysClass}`}>
                  {daysLeft !== null && daysLeft !== undefined ? `${daysLeft} DAYS LEFT` : 'NO DEADLINE'}
                </div>

                {/* Dynamic Pitch */}
                <div className="mb-4 text-[#06b6d4] text-xs italic line-clamp-2 leading-relaxed flex-grow">
                  "{lead.dynamic_sales_pitch || 'No pitch generated.'}"
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-2 mt-auto pt-4 border-t border-zinc-700">
                  <button
                    disabled={!isTier1 || lead.skip_trace_status === 'IN_PROGRESS' || lead.skip_trace_status === 'COMPLETE'}
                    onClick={() => setSkipTraceModal({ isOpen: true, lead })}
                    className={`flex-1 py-2 rounded text-xs font-bold transition-colors ${isTier1 && lead.skip_trace_status !== 'COMPLETE' && lead.skip_trace_status !== 'IN_PROGRESS'
                      ? 'bg-zinc-950 text-[#06b6d4] border border-[#06b6d4] hover:bg-[#06b6d4] hover:text-black'
                      : 'bg-zinc-900 text-zinc-600 cursor-not-allowed border border-zinc-800'
                      }`}
                  >
                    {lead.skip_trace_status === 'IN_PROGRESS' ? 'TRACING...' : 'SKIP TRACE'}
                  </button>
                  <button
                    onClick={() => openLeadDetails(lead)}
                    className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white py-2 rounded text-xs font-bold transition-colors"
                  >
                    VIEW DETAILS
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {filteredLeads.length === 0 && (
          <div className="col-span-1 md:col-span-3 p-12 text-center border-2 border-dashed border-zinc-800 rounded-lg text-zinc-500">
            NO LEADS IN PIPELINE
          </div>
        )}
      </div>

      {/* SKIP TRACE AUDIT LOG PANEL */}
      <div className="border border-[#06b6d4]/50 rounded-lg overflow-hidden bg-zinc-900">
        <button
          data-testid="skip-trace-log-toggle"
          onClick={() => setIsLogOpen(!isLogOpen)}
          className="w-full text-left p-4 bg-[#06b6d4]/10 hover:bg-[#06b6d4]/20 transition-colors flex justify-between items-center"
        >
          <span className="font-bold text-[#06b6d4]">SKIP TRACE AUDIT LOG</span>
          <span className="text-[#06b6d4]">{isLogOpen ? '▼' : '▶'}</span>
        </button>

        {isLogOpen && (
          <div className="p-4 overflow-x-auto">
            <table data-testid="skip-trace-log" className="w-full text-sm text-left">
              <thead className="text-zinc-500 border-b border-zinc-800">
                <tr>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Address</th>
                  <th className="p-3">Phone Numbers Found</th>
                  <th className="p-3">Cost</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="p-6 text-center text-zinc-600">No logs found.</td>
                  </tr>
                ) : (
                  auditLogs.map((log, i) => (
                    <tr key={i} className="text-zinc-300">
                      <td className="p-3">{new Date(log.requested_at).toLocaleString()}</td>
                      <td className="p-3 truncate max-w-[200px]">{log.leads?.address || 'Unknown'}</td>
                      <td className="p-3 font-bold text-[#06b6d4]">{log.result_count}</td>
                      <td className="p-3 text-green-400">${log.cost_per_hit}</td>
                      <td className="p-3">
                        <span className="bg-green-900/30 text-green-400 px-2 py-1 rounded text-xs font-bold">COMPLETED</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
              className="bg-zinc-900 border border-[#06b6d4] w-full max-w-md rounded-lg shadow-2xl relative z-10 p-6"
            >
              <h2 className="text-xl font-bold text-white mb-4">INITIATE SKIP TRACE?</h2>
              <div className="bg-zinc-950 p-4 rounded mb-4 text-sm font-mono space-y-2 border border-zinc-800">
                <p className="text-zinc-300">Address: <span className="text-white font-bold">{skipTraceModal.lead.address}</span></p>
                <p className="text-zinc-300">Cost: <span className="text-green-400 font-bold">$0.02 per hit</span></p>
              </div>
              <p className="text-zinc-400 text-sm mb-6">
                This will query Batchleads.io and add phone numbers to this lead.
              </p>
              <div className="flex space-x-3">
                <button
                  onClick={() => setSkipTraceModal({ isOpen: false, lead: null })}
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-2 rounded font-bold transition-colors text-sm"
                >
                  CANCEL
                </button>
                <button
                  onClick={confirmSkipTrace}
                  className="flex-1 bg-[#06b6d4] hover:bg-cyan-400 text-black py-2 rounded font-bold transition-colors text-sm"
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
              className="bg-zinc-950 border-2 border-[#06b6d4] w-full max-w-5xl h-[90vh] rounded-lg shadow-2xl relative z-10 flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex justify-between items-center p-4 border-b border-zinc-800 bg-zinc-900">
                <div>
                  <h2 className="text-xl font-bold text-[#06b6d4]">{selectedLead.address}</h2>
                  <p className="text-zinc-400 text-sm">{selectedLead.homeowner_name || 'Unknown Owner'}</p>
                </div>

                {/* LEAD STATUS UPDATE */}
                <div className="flex items-center space-x-4">
                  <div className="flex flex-col">
                    <label className="text-zinc-500 text-[10px] mb-1">STATUS</label>
                    <select
                      data-testid="lead-status-dropdown"
                      value={selectedLead.lead_status || 'NEW'}
                      onChange={(e) => updateLeadStatus(e.target.value)}
                      className="bg-zinc-800 text-white text-sm border border-zinc-700 p-1.5 rounded outline-none focus:border-[#06b6d4]"
                    >
                      <option value="NEW">NEW</option>
                      <option value="CONTACTED">CONTACTED</option>
                      <option value="APPOINTMENT_SET">APPOINTMENT SET</option>
                      <option value="DEAD">DEAD</option>
                      <option value="SOLD">SOLD</option>
                    </select>
                  </div>

                  {showProjectValueInput && (
                    <div className="flex flex-col">
                      <label className="text-zinc-500 text-[10px] mb-1">PROJECT VALUE ($)</label>
                      <div className="flex space-x-2">
                        <input
                          type="number"
                          value={projectValue}
                          onChange={(e) => setProjectValue(e.target.value)}
                          className="bg-zinc-800 border border-zinc-700 text-white p-1.5 rounded text-sm w-24 outline-none focus:border-[#06b6d4]"
                        />
                        <button
                          onClick={() => updateLeadStatus('SOLD')}
                          className="bg-green-600 hover:bg-green-500 text-white px-2 rounded text-xs font-bold"
                        >
                          SAVE
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={closeLeadDetails}
                    className="ml-4 text-zinc-400 hover:text-white text-3xl font-light w-10 h-10 flex items-center justify-center rounded bg-zinc-800"
                  >
                    &times;
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-8 custom-scrollbar">

                {/* LEFT COLUMN */}
                <div className="space-y-8">

                  {/* Property Data */}
                  <section>
                    <h3 className="text-zinc-500 font-bold text-sm mb-4 border-b border-zinc-800 pb-2">PROPERTY DATA</h3>
                    <div className="grid grid-cols-2 gap-y-2 text-sm">
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
                    <section className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-zinc-400 font-bold text-sm">CONTACT INFO</h3>
                        {!phonesRevealed && (
                          <button
                            onClick={() => setPhonesRevealed(true)}
                            className="bg-[#06b6d4] text-black px-3 py-1 rounded text-xs font-bold hover:bg-cyan-400"
                          >
                            REVEAL NUMBERS
                          </button>
                        )}
                      </div>

                      <div className="space-y-2 mb-4">
                        {selectedLead.phone_numbers.map((ph, idx) => (
                          <div key={idx} className="flex justify-between bg-zinc-950 p-2 rounded border border-zinc-800">
                            <span className="text-[#06b6d4] font-bold tracking-widest text-lg">
                              {phonesRevealed ? ph.number : `***-***-${ph.number?.slice(-4)}`}
                            </span>
                            <span className="text-zinc-500 text-xs uppercase">{ph.type || 'PHONE'}</span>
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
                    <h3 className="text-zinc-500 font-bold text-sm mb-4 border-b border-zinc-800 pb-2">SATELLITE IMAGES</h3>
                    <div className="flex gap-4">
                      {selectedLead.satellite_image_url ? (
                        <img src={selectedLead.satellite_image_url} alt="Satellite Current" className="w-1/2 rounded border border-zinc-700 object-cover" />
                      ) : (
                        <div className="w-1/2 aspect-square bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 text-xs text-center p-4 rounded">No Current Image</div>
                      )}
                      {selectedLead.historical_image_url ? (
                        <img src={selectedLead.historical_image_url} alt="Satellite Historical" className="w-1/2 rounded border border-zinc-700 object-cover" />
                      ) : (
                        <div className="w-1/2 aspect-square bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 text-xs text-center p-4 rounded">No Historical Image</div>
                      )}
                    </div>
                  </section>

                  {/* Permit History */}
                  <section>
                    <h3 className="text-zinc-500 font-bold text-sm mb-4 border-b border-zinc-800 pb-2">PERMIT HISTORY</h3>
                    {permits.length === 0 ? (
                      <p className="text-zinc-600 text-sm">No permits found.</p>
                    ) : (
                      <table className="w-full text-xs text-left">
                        <thead className="text-zinc-500 border-b border-zinc-800">
                          <tr>
                            <th className="py-2">Date</th>
                            <th className="py-2">Type</th>
                            <th className="py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800 text-zinc-300">
                          {permits.map(p => (
                            <tr key={p.id}>
                              <td className="py-2">{new Date(p.created_at).toLocaleDateString()}</td>
                              <td className="py-2">{p.permit_type}</td>
                              <td className="py-2">{p.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>
                </div>

                {/* RIGHT COLUMN */}
                <div className="space-y-8">

                  {/* AI Scoring Output */}
                  <section>
                    <h3 className="text-zinc-500 font-bold text-sm mb-4 border-b border-zinc-800 pb-2">AI SCORING OUTPUT</h3>
                    <div className="bg-zinc-900 p-4 rounded border border-[#06b6d4]/30 space-y-4 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400">Score:</span>
                        <span className="text-2xl font-bold text-[#06b6d4]">{selectedLead.lead_score}</span>
                      </div>
                      <div>
                        <span className="text-zinc-400 block mb-1">Financial Profile:</span>
                        <p className="text-zinc-300">{selectedLead.financial_profile || 'N/A'}</p>
                      </div>
                      {selectedLead.visual_analysis && (
                        <div>
                          <span className="text-zinc-400 block mb-1">Visual Analysis:</span>
                          <pre className="bg-zinc-950 p-3 rounded text-zinc-300 text-xs overflow-x-auto border border-zinc-800">
                            {JSON.stringify(selectedLead.visual_analysis, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Logs */}
                  <section>
                    <h3 className="text-zinc-500 font-bold text-sm mb-4 border-b border-zinc-800 pb-2">COMMUNICATION LOGS</h3>

                    <div className="mb-4">
                      <h4 className="text-xs text-zinc-400 mb-2 uppercase">Calls</h4>
                      {callLogs.length === 0 ? (
                        <p className="text-zinc-600 text-xs">No calls logged.</p>
                      ) : (
                        <div className="space-y-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                          {callLogs.map(log => (
                            <div key={log.id} className="bg-zinc-900 p-2 rounded text-xs border border-zinc-800 flex justify-between">
                              <span className="text-zinc-400">{new Date(log.created_at).toLocaleString()}</span>
                              <span className="text-white font-bold">{log.outcome}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <h4 className="text-xs text-zinc-400 mb-2 uppercase">SMS</h4>
                      {smsLogs.length === 0 ? (
                        <p className="text-zinc-600 text-xs">No SMS logged.</p>
                      ) : (
                        <div className="space-y-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                          {smsLogs.map(log => (
                            <div key={log.id} className="bg-zinc-900 p-2 rounded text-xs border border-zinc-800 flex justify-between">
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