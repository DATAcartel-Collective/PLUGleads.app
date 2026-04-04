import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { scoreLead } from '../lib/geminiScorer';
import { fetchHistoricalImageAsBase64, fetchSatelliteImageAsBase64 } from '../lib/satelliteImageFetcher';

export default function ScoringView() {
    const [tenantId, setTenantId] = useState('');
    const [mapsApiKey, setMapsApiKey] = useState('');
    const [geminiApiKey, setGeminiApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY || '');

    const [leads, setLeads] = useState([]);
    const [scoringState, setScoringState] = useState({}); // { [leadId]: 'scoring' | 'success' | 'error' }
    const [scoringErrors, setScoringErrors] = useState({});
    const [scoringResults, setScoringResults] = useState({}); // { [leadId]: resultData }
    const [expandedLeadId, setExpandedLeadId] = useState(null);

    const [isBatchScoring, setIsBatchScoring] = useState(false);
    const [currentBatchIndex, setCurrentBatchIndex] = useState(-1);
    const [batchComplete, setBatchComplete] = useState(false);
    const [batchScoreCount, setBatchScoreCount] = useState(0);

    useEffect(() => {
        if (tenantId) {
            loadQueue();
        }
    }, [tenantId]);

    async function loadQueue() {
        const { data, error } = await supabase
            .from('leads')
            .select('*, permits(*)')
            .eq('tenant_id', tenantId)
            .neq('priority_status', 'Tier 3')
            .is('ai_scored_at', null)
            .order('created_at', { ascending: true });

        if (data) {
            setLeads(data);
        }
    }

    async function writeScoreToSupabase(leadId, scoreResult) {
        const updateData = {
            ai_scored_at: new Date().toISOString(),
            lead_score: scoreResult.lead_score,
            priority_status: scoreResult.priority_tier
        };
        const { error } = await supabase
            .from('leads')
            .update(updateData)
            .eq('id', leadId);

        if (error) {
            throw error;
        }
    }

    async function handleScoreLead(lead) {
        if (!mapsApiKey || !geminiApiKey) {
            setScoringErrors(prev => ({ ...prev, [lead.id]: 'API Keys required.' }));
            return;
        }

        setScoringState(prev => ({ ...prev, [lead.id]: 'scoring' }));
        setScoringErrors(prev => ({ ...prev, [lead.id]: null }));

        try {
            const currentImageRes = await fetchSatelliteImageAsBase64(lead.latitude, lead.longitude, 19, '640x640', mapsApiKey);
            const histImageRes = await fetchHistoricalImageAsBase64(lead.latitude, lead.longitude, mapsApiKey);

            if (currentImageRes.error) throw new Error('Maps API Error: ' + currentImageRes.error);

            const scoreResult = await scoreLead(
                lead,
                currentImageRes.base64,
                histImageRes.base64,
                lead.permits,
                geminiApiKey
            );

            if (scoreResult.error) {
                throw new Error('Gemini API Error: ' + scoreResult.error);
            }

            await writeScoreToSupabase(lead.id, scoreResult);

            setScoringResults(prev => ({ ...prev, [lead.id]: scoreResult }));
            setScoringState(prev => ({ ...prev, [lead.id]: 'success' }));

            // Update lead locally so table reflects it
            setLeads(prevLeads => prevLeads.map(l => l.id === lead.id ? {
                ...l,
                lead_score: scoreResult.lead_score,
                priority_status: scoreResult.priority_tier,
                ai_scored_at: new Date().toISOString()
            } : l));

            return true;
        } catch (err) {
            setScoringErrors(prev => ({ ...prev, [lead.id]: err.message }));
            setScoringState(prev => ({ ...prev, [lead.id]: 'error' }));
            return false;
        }
    }

    async function handleBatchScore() {
        setIsBatchScoring(true);
        setBatchComplete(false);
        setBatchScoreCount(0);

        const unscored = leads.filter(l => !l.ai_scored_at && scoringState[l.id] !== 'success');

        let count = 0;
        for (let i = 0; i < unscored.length; i++) {
            const lead = unscored[i];
            setCurrentBatchIndex(i);
            const success = await handleScoreLead(lead);
            if (success) count++;
            await new Promise(r => setTimeout(r, 2000)); // 2 second delay to respect rate limits
        }

        setIsBatchScoring(false);
        setCurrentBatchIndex(-1);
        setBatchScoreCount(count);
        setBatchComplete(true);
    }

    const unscoredLeads = leads.filter(l => !l.ai_scored_at && scoringState[l.id] !== 'success');
    const currentBatchLead = isBatchScoring && unscoredLeads[currentBatchIndex] ? unscoredLeads[currentBatchIndex] : null;
    const progressPercent = unscoredLeads.length > 0 && isBatchScoring
        ? Math.round((currentBatchIndex / unscoredLeads.length) * 100)
        : 0;

    return (
        <div className="p-6 pb-32">
            {/* HEADER */}
            <div className="mb-8 border-b border-zinc-800 pb-4">
                <h1 className="text-2xl font-mono font-bold text-[#06b6d4]">PHASE 3 — AI SCORING ENGINE</h1>
                <p className="text-zinc-400 font-mono text-sm">Gemini 1.5 Pro Multimodal Visual Analysis</p>
            </div>

            {/* CONFIGURATION INPUTS */}
            <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                <input
                    type="text"
                    placeholder="Tenant ID"
                    value={tenantId}
                    onChange={e => setTenantId(e.target.value)}
                    data-testid="scoring-tenant-input"
                    className="bg-zinc-900 border border-zinc-700 text-white p-2 rounded font-mono text-sm"
                />
                <input
                    type="password"
                    placeholder="Google Maps Static API Key"
                    value={mapsApiKey}
                    onChange={e => setMapsApiKey(e.target.value)}
                    data-testid="maps-api-input"
                    className="bg-zinc-900 border border-zinc-700 text-white p-2 rounded font-mono text-sm"
                />
                <input
                    type="password"
                    placeholder="Gemini API Key — or set VITE_GEMINI_API_KEY in .env"
                    value={geminiApiKey}
                    onChange={e => setGeminiApiKey(e.target.value)}
                    data-testid="gemini-api-input"
                    className="bg-zinc-900 border border-zinc-700 text-white p-2 rounded font-mono text-sm"
                />
            </div>

            {/* GSAP Drip-Edge progress bar (Always Mounted) */}
            <div className="mb-6 bg-zinc-900 border border-zinc-800 p-4 rounded" data-testid="scoring-progress-bar">
                <div className="flex justify-between items-center mb-2 font-mono text-sm">
                    <span className="text-zinc-400">BATCH PROGRESS</span>
                    <span className="text-[#06b6d4]">{progressPercent}%</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded overflow-hidden">
                    <div
                        className="h-full bg-[#06b6d4] transition-all duration-500 ease-out"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
                {isBatchScoring && currentBatchLead && (
                    <div className="mt-2 text-xs font-mono text-[#06b6d4] animate-pulse">
                        SCORING: {currentBatchLead.address}...
                    </div>
                )}
                {batchComplete && (
                    <div className="mt-2 text-xs font-mono text-green-400">
                        ✅ BATCH SCORING COMPLETE — {batchScoreCount} LEADS SCORED
                    </div>
                )}
            </div>

            {/* BATCH SCORING BUTTON */}
            <div className="mb-8">
                <button
                    onClick={handleBatchScore}
                    disabled={isBatchScoring || !tenantId || unscoredLeads.length === 0}
                    data-testid="batch-score-button"
                    className="w-full bg-[#06b6d4] hover:bg-cyan-400 text-zinc-950 font-bold font-mono py-4 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isBatchScoring ? 'SCORING IN PROGRESS...' : 'SCORE ALL UNSCORED LEADS'}
                </button>
            </div>

            {/* LEAD QUEUE */}
            <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
                <table className="w-full text-left font-mono text-sm" data-testid="lead-score-queue">
                    <thead className="bg-zinc-950 text-zinc-400">
                        <tr>
                            <th className="p-4 border-b border-zinc-800">Address</th>
                            <th className="p-4 border-b border-zinc-800">State</th>
                            <th className="p-4 border-b border-zinc-800">Assessed Value</th>
                            <th className="p-4 border-b border-zinc-800">Storm Date</th>
                            <th className="p-4 border-b border-zinc-800">Days Left</th>
                            <th className="p-4 border-b border-zinc-800">Current Score</th>
                            <th className="p-4 border-b border-zinc-800">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {leads.map(lead => {
                            const state = scoringState[lead.id];
                            const result = scoringResults[lead.id];
                            const isExpanded = expandedLeadId === lead.id;

                            return (
                                <React.Fragment key={lead.id}>
                                    <tr className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                                        <td className="p-4">{lead.address}</td>
                                        <td className="p-4">{lead.state}</td>
                                        <td className="p-4">${lead.assessed_value?.toLocaleString() || 'N/A'}</td>
                                        <td className="p-4">{lead.last_storm_date || 'N/A'}</td>
                                        <td className="p-4">{lead.days_until_deadline || 'N/A'}</td>
                                        <td className="p-4">
                                            {lead.lead_score ? (
                                                <div className="flex items-center space-x-2">
                                                    <span className="text-[#06b6d4] font-bold">{lead.lead_score}</span>
                                                    <span className="bg-zinc-800 px-2 py-1 rounded text-xs">{lead.priority_status}</span>
                                                </div>
                                            ) : '-'}
                                        </td>
                                        <td className="p-4">
                                            {state === 'scoring' ? (
                                                <div className="w-6 h-6 border-2 border-[#06b6d4] border-t-transparent rounded-full animate-spin"></div>
                                            ) : state === 'success' ? (
                                                <button
                                                    onClick={() => setExpandedLeadId(isExpanded ? null : lead.id)}
                                                    className="text-xs bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1 rounded transition-colors"
                                                >
                                                    {isExpanded ? 'HIDE RESULT' : 'VIEW RESULT'}
                                                </button>
                                            ) : (
                                                <div className="flex flex-col space-y-1">
                                                    <button
                                                        onClick={() => handleScoreLead(lead)}
                                                        disabled={isBatchScoring}
                                                        className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1 rounded text-xs transition-colors disabled:opacity-50"
                                                    >
                                                        SCORE THIS LEAD
                                                    </button>
                                                    {state === 'error' && (
                                                        <span className="text-red-400 text-[10px] break-words max-w-[150px]">
                                                            {scoringErrors[lead.id]}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>

                                    {/* F. SCORE RESULT CARD */}
                                    {isExpanded && result && (
                                        <tr>
                                            <td colSpan="7" className="p-0 border-b border-zinc-800">
                                                <div className="bg-zinc-950 p-6 shadow-inner border-l-4 border-[#06b6d4]">
                                                    <div className="flex justify-between items-start mb-4">
                                                        <div>
                                                            <span className="bg-[#06b6d4]/20 text-[#06b6d4] px-3 py-1 rounded text-xs font-bold uppercase tracking-wider">
                                                                ARCHETYPE: {result.lead_archetype}
                                                            </span>
                                                        </div>
                                                        <div className="bg-red-900/30 border border-red-500/50 text-red-400 px-3 py-1 rounded text-xs font-bold uppercase">
                                                            {result.urgency_flag}
                                                        </div>
                                                    </div>

                                                    <div className="mb-6">
                                                        <p className="text-[#06b6d4] italic text-lg leading-relaxed border-l-2 border-[#06b6d4] pl-4">
                                                            "{result.dynamic_sales_pitch}"
                                                        </p>
                                                    </div>

                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                        <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
                                                            <h4 className="text-zinc-500 text-xs mb-3 font-bold">VISUAL ANALYSIS SUMMARY</h4>
                                                            <div className="space-y-2 text-sm text-zinc-300">
                                                                <p><span className="text-zinc-500">Condition:</span> {result.visual_analysis?.roof_condition}</p>
                                                                <p><span className="text-zinc-500">Exposure:</span> {result.visual_analysis?.exposure}</p>
                                                                <p><span className="text-zinc-500">Changes:</span> {result.visual_analysis?.visual_changes_detected}</p>
                                                                <p><span className="text-zinc-500">Wealth Markers:</span> {result.visual_analysis?.wealth_indicators?.join(', ') || 'None detected'}</p>
                                                            </div>
                                                        </div>

                                                        <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
                                                            <h4 className="text-zinc-500 text-xs mb-3 font-bold">FINANCIAL PROFILE SUMMARY</h4>
                                                            <p className="text-sm text-zinc-300">
                                                                {result.financial_profile}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}

                        {leads.length === 0 && (
                            <tr>
                                <td colSpan="7" className="p-8 text-center text-zinc-500 font-mono">
                                    Enter Tenant ID to load unscored leads queue.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
