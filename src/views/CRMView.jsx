import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';

export default function CRMView({ preselectedLeadId }) {
    const [tenantId, setTenantId] = useState('');
    const [leads, setLeads] = useState([]);
    const [selectedLead, setSelectedLead] = useState(null);

    const [notes, setNotes] = useState('');
    const [appointmentDate, setAppointmentDate] = useState('');
    const [status, setStatus] = useState('');
    const [projectValue, setProjectValue] = useState('');

    useEffect(() => {
        if (tenantId) {
            loadRoster();
        }
    }, [tenantId]);

    useEffect(() => {
        const storedLeadId = preselectedLeadId || localStorage.getItem('crm_preselect_lead');
        if (storedLeadId && leads.length > 0) {
            const lead = leads.find(l => l.id === storedLeadId);
            if (lead) {
                openLeadDetails(lead);
                localStorage.removeItem('crm_preselect_lead');
            }
        }
    }, [preselectedLeadId, leads]);

    async function loadRoster() {
        const { data } = await supabase
            .from('leads')
            .select('*, call_logs(*), sms_logs(*)')
            .eq('tenant_id', tenantId)
            .in('lead_status', ['SOLD', 'APPOINTMENT_SET'])
            .order('updated_at', { ascending: false });

        if (data) setLeads(data);
    }

    function openLeadDetails(lead) {
        setSelectedLead(lead);
        setNotes(lead.notes || '');
        setAppointmentDate(lead.appointment_date || '');
        setStatus(lead.lead_status || '');
        setProjectValue(lead.project_value || '');
    }

    function closeLeadDetails() {
        setSelectedLead(null);
    }

    async function handleNotesBlur() {
        if (!selectedLead) return;
        await supabase.from('leads').update({ notes }).eq('id', selectedLead.id);
        updateLocalLead(selectedLead.id, { notes });
    }

    async function handleScheduleFollowup() {
        if (!selectedLead) return;
        await supabase.from('leads').update({ appointment_date: appointmentDate }).eq('id', selectedLead.id);
        updateLocalLead(selectedLead.id, { appointment_date: appointmentDate });
        alert('Follow-up scheduled.');
    }

    async function handleStatusUpdate() {
        if (!selectedLead) return;
        const updates = { lead_status: status };
        if (status === 'SOLD') {
            updates.project_value = parseFloat(projectValue) || 0;
        }

        const { data, error } = await supabase.from('leads').update(updates).eq('id', selectedLead.id).select().single();
        if (data) {
            setSelectedLead(data);
            updateLocalLead(data.id, data);
        }
    }

    function updateLocalLead(id, updates) {
        setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
    }

    const getLastContact = (lead) => {
        let last = null;
        if (lead.call_logs && lead.call_logs.length > 0) {
            const d = new Date(lead.call_logs[0].created_at);
            if (!last || d > last) last = d;
        }
        if (lead.sms_logs && lead.sms_logs.length > 0) {
            const d = new Date(lead.sms_logs[0].created_at);
            if (!last || d > last) last = d;
        }
        return last ? last.toLocaleDateString() : 'Never';
    };

    const totalValue = leads.reduce((sum, l) => sum + (l.project_value || 0), 0);
    const totalComm = leads.reduce((sum, l) => sum + (l.commission_amount || 0), 0);
    // Assuming a field like commission_paid exists or just checking if paid. Will just default to 0 if not present.
    const paidComm = leads.filter(l => l.commission_paid).reduce((sum, l) => sum + (l.commission_amount || 0), 0);
    const outstandingComm = totalComm - paidComm;

    return (
        <div className="p-6 pb-32 font-mono text-white min-h-screen">
            {/* HEADER */}
            <div className="mb-8 border-b border-zinc-800 pb-4 w-full">
                <h1 className="text-3xl font-bold text-[#06b6d4]">CRM — CLIENT ROLODEX</h1>
                <p className="text-zinc-400 text-sm mt-2">Long-term relationship management for converted leads</p>
            </div>

            {/* TENANT INPUT */}
            <div className="mb-8 max-w-sm">
                <input
                    type="text"
                    placeholder="Enter Tenant ID"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    data-testid="crm-tenant-input"
                    className="w-full bg-zinc-900 border border-zinc-700 text-white p-2 rounded text-sm focus:border-[#06b6d4] outline-none"
                />
            </div>

            {/* COMMISSION TRACKER */}
            <div data-testid="commission-tracker" className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-zinc-900 border border-zinc-800 p-4 rounded text-center">
                    <div className="text-zinc-500 text-xs mb-1 uppercase">Pipeline Value</div>
                    <div className="text-2xl font-bold text-white">${totalValue.toLocaleString()}</div>
                </div>
                <div className="bg-zinc-900 border border-[#06b6d4]/30 p-4 rounded text-center shadow-[0_0_15px_rgba(6,182,212,0.1)]">
                    <div className="text-zinc-400 text-xs mb-1 uppercase">Total Commission</div>
                    <div className="text-2xl font-bold text-[#06b6d4]">${totalComm.toLocaleString()}</div>
                </div>
                <div className="bg-zinc-900 border border-green-500/30 p-4 rounded text-center">
                    <div className="text-green-500/70 text-xs mb-1 uppercase">Commission Paid</div>
                    <div className="text-2xl font-bold text-green-400">${paidComm.toLocaleString()}</div>
                </div>
                <div className="bg-zinc-900 border border-yellow-500/30 p-4 rounded text-center">
                    <div className="text-yellow-500/70 text-xs mb-1 uppercase">Outstanding</div>
                    <div className="text-2xl font-bold text-yellow-400">${outstandingComm.toLocaleString()}</div>
                </div>
            </div>

            {/* ROSTER TABLE */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                    <table data-testid="crm-roster" className="w-full text-left text-sm">
                        <thead className="bg-zinc-950 text-[#06b6d4] border-b border-zinc-800">
                            <tr>
                                <th className="p-4 font-bold">Homeowner</th>
                                <th className="p-4 font-bold">Address</th>
                                <th className="p-4 font-bold">Status</th>
                                <th className="p-4 font-bold">Project Value</th>
                                <th className="p-4 font-bold">Commission</th>
                                <th className="p-4 font-bold">Last Contact</th>
                                <th className="p-4 font-bold text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800">
                            {leads.length === 0 ? (
                                <tr>
                                    <td colSpan="7" className="p-12 text-center text-zinc-500">
                                        <div className="flex flex-col items-center justify-center">
                                            <svg className="w-16 h-16 text-zinc-600 mb-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 22V12h6v10" />
                                            </svg>
                                            <span className="font-mono font-bold text-xl uppercase">NO CLIENTS IN ROLODEX</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                leads.map(lead => (
                                    <tr key={lead.id} className="hover:bg-zinc-800/50 transition-colors">
                                        <td className="p-4 font-bold">{lead.homeowner_name || 'Unknown'}</td>
                                        <td className="p-4 truncate max-w-[200px] text-zinc-300">{lead.address}</td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded text-xs font-bold ${lead.lead_status === 'SOLD' ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'
                                                }`}>
                                                {lead.lead_status?.replace('_', ' ')}
                                            </span>
                                        </td>
                                        <td className="p-4">${lead.project_value?.toLocaleString() || '0'}</td>
                                        <td className="p-4 text-green-400 font-bold">${lead.commission_amount?.toLocaleString() || '0'}</td>
                                        <td className="p-4 text-zinc-400">{getLastContact(lead)}</td>
                                        <td className="p-4 text-right">
                                            <button
                                                onClick={() => openLeadDetails(lead)}
                                                className="bg-zinc-800 hover:bg-[#06b6d4] hover:text-black border border-[#06b6d4] text-[#06b6d4] px-3 py-1.5 rounded text-xs font-bold transition-colors"
                                            >
                                                VIEW PROFILE
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* DETAIL SIDE PANEL */}
            <AnimatePresence>
                {selectedLead && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={closeLeadDetails}
                            className="fixed inset-0 bg-black/50 z-40"
                        />
                        <motion.div
                            data-testid="crm-detail-panel"
                            initial={{ x: 480 }}
                            animate={{ x: 0 }}
                            exit={{ x: 480 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="fixed top-0 right-0 w-full max-w-[480px] h-full bg-zinc-900 border-l-2 border-[#06b6d4] z-50 overflow-y-auto custom-scrollbar shadow-2xl flex flex-col"
                        >
                            <div className="p-6 flex-1 flex flex-col">
                                <div className="flex justify-between items-start mb-6 border-b border-zinc-800 pb-4">
                                    <div>
                                        <h2 className="text-2xl font-bold text-[#06b6d4] uppercase tracking-wider">{selectedLead.homeowner_name || 'Client'}</h2>
                                        <p className="text-zinc-400 text-sm mt-1">{selectedLead.address}</p>
                                    </div>
                                    <button onClick={closeLeadDetails} className="text-zinc-500 hover:text-white text-2xl leading-none">&times;</button>
                                </div>

                                {/* Status & Financials */}
                                <div className="bg-zinc-950 p-4 rounded border border-zinc-800 mb-6 space-y-4">
                                    <div>
                                        <label className="text-xs text-zinc-500 uppercase mb-1 block">Lead Status</label>
                                        <div className="flex space-x-2">
                                            <select
                                                value={status}
                                                onChange={(e) => setStatus(e.target.value)}
                                                className="bg-zinc-800 border border-zinc-700 text-white p-2 rounded text-sm flex-1 outline-none focus:border-[#06b6d4]"
                                            >
                                                <option value="APPOINTMENT_SET">APPOINTMENT SET</option>
                                                <option value="SOLD">SOLD</option>
                                                <option value="DEAD">DEAD</option>
                                            </select>
                                        </div>
                                    </div>

                                    {status === 'SOLD' && (
                                        <div>
                                            <label className="text-xs text-zinc-500 uppercase mb-1 block">Project Value ($)</label>
                                            <input
                                                type="number"
                                                value={projectValue}
                                                onChange={(e) => setProjectValue(e.target.value)}
                                                className="bg-zinc-800 border border-zinc-700 text-white p-2 rounded text-sm w-full outline-none focus:border-[#06b6d4]"
                                            />
                                        </div>
                                    )}

                                    <div className="pt-2">
                                        <button
                                            onClick={handleStatusUpdate}
                                            className="w-full bg-[#06b6d4] hover:bg-cyan-400 text-black font-bold py-2 rounded text-sm transition-colors"
                                        >
                                            UPDATE STATUS & FINANCIALS
                                        </button>
                                    </div>

                                    <div className="border-t border-zinc-800 pt-3 mt-3 flex justify-between">
                                        <span className="text-zinc-400 text-sm">Calculated Commission:</span>
                                        <span className="text-green-400 font-bold">${selectedLead.commission_amount?.toLocaleString() || '0'}</span>
                                    </div>
                                </div>

                                {/* Follow-Up Scheduling */}
                                <div className="mb-6">
                                    <h3 className="text-sm font-bold text-[#06b6d4] mb-2 uppercase">Schedule Follow-Up</h3>
                                    <div className="flex space-x-2">
                                        <input
                                            type="datetime-local"
                                            value={appointmentDate ? new Date(appointmentDate).toISOString().slice(0, 16) : ''}
                                            onChange={(e) => setAppointmentDate(e.target.value)}
                                            className="bg-zinc-800 border border-zinc-700 text-white p-2 rounded text-sm flex-1 outline-none focus:border-[#06b6d4] [color-scheme:dark]"
                                        />
                                        <button
                                            data-testid="schedule-followup-button"
                                            onClick={handleScheduleFollowup}
                                            className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 rounded text-xs font-bold transition-colors border border-zinc-600"
                                        >
                                            SAVE
                                        </button>
                                    </div>
                                </div>

                                {/* Notes */}
                                <div className="mb-6 flex-1 flex flex-col">
                                    <h3 className="text-sm font-bold text-[#06b6d4] mb-2 uppercase">Client Notes</h3>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        onBlur={handleNotesBlur}
                                        placeholder="Add notes... (auto-saves on blur)"
                                        className="w-full bg-zinc-800 border border-zinc-700 text-white p-3 rounded text-sm outline-none focus:border-[#06b6d4] flex-1 min-h-[120px] resize-none"
                                    />
                                </div>

                                {/* Communication Logs */}
                                <div className="mb-6">
                                    <h3 className="text-sm font-bold text-[#06b6d4] mb-2 uppercase border-b border-zinc-800 pb-1">Communication History</h3>

                                    <div className="space-y-4 mt-4">
                                        <div>
                                            <h4 className="text-xs text-zinc-500 uppercase mb-2">Calls</h4>
                                            {(!selectedLead.call_logs || selectedLead.call_logs.length === 0) ? (
                                                <p className="text-zinc-600 text-xs italic">No calls logged.</p>
                                            ) : (
                                                <div className="space-y-2">
                                                    {selectedLead.call_logs.map(log => (
                                                        <div key={log.id} className="bg-zinc-950 p-2 rounded border border-zinc-800 flex justify-between items-center text-xs">
                                                            <span className="text-zinc-400">{new Date(log.created_at).toLocaleString()}</span>
                                                            <span className="font-bold text-white">{log.outcome}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div>
                                            <h4 className="text-xs text-zinc-500 uppercase mb-2">SMS</h4>
                                            {(!selectedLead.sms_logs || selectedLead.sms_logs.length === 0) ? (
                                                <p className="text-zinc-600 text-xs italic">No SMS logged.</p>
                                            ) : (
                                                <div className="space-y-2">
                                                    {selectedLead.sms_logs.map(log => (
                                                        <div key={log.id} className="bg-zinc-950 p-3 rounded border border-zinc-800 text-xs flex flex-col">
                                                            <div className="flex justify-between items-center mb-1 border-b border-zinc-800 pb-1">
                                                                <span className="text-zinc-400">{new Date(log.created_at).toLocaleString()}</span>
                                                                <span className="font-bold text-green-400">{log.status}</span>
                                                            </div>
                                                            <p className="text-zinc-300 mt-1 italic">"{log.final_body}"</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}