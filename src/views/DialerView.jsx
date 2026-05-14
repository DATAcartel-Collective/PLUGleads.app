import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { ROOFING_PHYSICS } from '../lib/roofingAnimations';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default function DialerView() {
    const [tenantId, setTenantId] = useState('');
    const [queue, setQueue] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);

    const [callState, setCallState] = useState('IDLE'); // IDLE, IN_PROGRESS, ENDED
    const [callDuration, setCallDuration] = useState(0);

    const [geminiApiKey, setGeminiApiKey] = useState(() => {
        try { return localStorage.getItem('plugleads_gemini_key') || import.meta.env.VITE_GEMINI_API_KEY || ''; }
        catch (e) { return import.meta.env.VITE_GEMINI_API_KEY || ''; }
    });

    const [selectedOutcome, setSelectedOutcome] = useState('');

    // SMS Panel State
    const [smsState, setSmsState] = useState('HIDDEN'); // HIDDEN, DRAFT, CONFIRM, SENT
    const [aiDraft, setAiDraft] = useState('');
    const [finalBody, setFinalBody] = useState('');
    const [wasEdited, setWasEdited] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    const x = useMotionValue(0);
    const overlayOpacityRight = useTransform(x, [0, 100], [0, 1]);
    const overlayOpacityLeft = useTransform(x, [0, -100], [0, 1]);

    useEffect(() => {
        if (tenantId) {
            loadQueue();
        }
    }, [tenantId]);

    useEffect(() => {
        let interval;
        if (callState === 'IN_PROGRESS') {
            interval = setInterval(() => setCallDuration(d => d + 1), 1000);
        } else if (interval) {
            clearInterval(interval);
        }
        return () => clearInterval(interval);
    }, [callState]);

    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (tenantId) {
            loadQueue();
        }
    }, [tenantId]);

    async function loadQueue() {
        setIsLoading(true);
        const { data } = await supabase
            .from('leads')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('priority_status', 'Tier 1')
            .eq('skip_trace_status', 'COMPLETE')
            .neq('lead_status', 'DEAD')
            .neq('lead_status', 'SOLD')
            .order('lead_score', { ascending: false });

        if (data) {
            const validLeads = data.filter(l => l.phone_numbers && Array.isArray(l.phone_numbers) && l.phone_numbers.length > 0);
            setQueue(validLeads);
            setCurrentIndex(0);
            setCallState('IDLE');
            setCallDuration(0);
            resetSmsState();
        }
        setIsLoading(false);
    }

    const currentLead = queue[currentIndex];

    const resetSmsState = () => {
        setSmsState('HIDDEN');
        setAiDraft('');
        setFinalBody('');
        setWasEdited(false);
        setIsEditing(false);
        setSelectedOutcome('');
    };

    const handleNext = () => {
        if (currentIndex < queue.length - 1) {
            setCurrentIndex(i => i + 1);
            setCallState('IDLE');
            setCallDuration(0);
            x.set(0);
            resetSmsState();
        }
    };

    const handlePrev = () => {
        if (currentIndex > 0) {
            setCurrentIndex(i => i - 1);
            setCallState('IDLE');
            setCallDuration(0);
            x.set(0);
            resetSmsState();
        }
    };

    const handleDragEnd = (e, info) => {
        if (info.offset.x > 100 && callState === 'IDLE') {
            // Swipe Right -> Initiate Call
            initiateCall();
            x.set(0); // Snap card back to center immediately so it stays put during the call
        } else if (info.offset.x < -100 && callState === 'IDLE') {
            // Swipe Left -> Skip to Next
            handleNext();
        }
    };

    const initiateCall = async () => {
        if (!currentLead) return;
        setCallState('IN_PROGRESS');
        setCallDuration(0);

        try {
            await supabase.functions.invoke('initiate-call', {
                body: { lead_id: currentLead.id, tenant_id: tenantId }
            });
        } catch (err) {
            console.error("Call initiation error", err);
        }
    };

    const handleOutcome = async (outcome) => {
        if (!currentLead) return;

        setSelectedOutcome(outcome);

        // Log call
        await supabase.from('call_logs').insert({
            tenant_id: tenantId,
            lead_id: currentLead.id,
            contractor_id: null,
            outcome: outcome,
            duration_seconds: callDuration,
            called_at: new Date().toISOString()
        });

        // Update status
        let newStatus = currentLead.lead_status;
        if (outcome === 'APPOINTMENT SET') newStatus = 'APPOINTMENT_SET';
        if (outcome === 'NOT INTERESTED') newStatus = 'DEAD';

        if (newStatus !== currentLead.lead_status) {
            await supabase.from('leads').update({ lead_status: newStatus }).eq('id', currentLead.id);
        }

        setCallState('ENDED');
        setSmsState('HIDDEN'); // reveal panel option
    };

    const generateAiMessage = async () => {
        if (!geminiApiKey || !currentLead) return;
        setIsGenerating(true);
        setSmsState('DRAFT');

        try {
            const genAI = new GoogleGenerativeAI(geminiApiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

            const prompt = `Write a short, informal, friendly follow-up text message (under 160 characters) for a roofing contractor to send after a ${selectedOutcome} call with a homeowner. The homeowner's name is ${currentLead.homeowner_name}. The property is at ${currentLead.address}. Sales context: ${currentLead.dynamic_sales_pitch}. Keep it casual and genuine, not salesy.`;

            const result = await model.generateContent(prompt);
            const text = result.response.text().trim();

            setAiDraft(text);
            setFinalBody(text);
        } catch (e) {
            console.error("Failed to generate SMS", e);
            setFinalBody("Hi, just following up regarding your roof. Let me know if you have any questions!");
        }
        setIsGenerating(false);
    };

    const confirmSendSms = async () => {
        if (!currentLead) return;

        await supabase.from('sms_logs').insert({
            tenant_id: tenantId,
            lead_id: currentLead.id,
            contractor_id: null,
            ai_generated_body: aiDraft,
            final_body: finalBody,
            was_edited: wasEdited,
            contractor_confirmed: true,
            status: 'SENT',
            sent_at: new Date().toISOString()
        });

        setSmsState('SENT');

        setTimeout(() => {
            handleNext();
        }, 1500);
    };

    const formatTime = (secs) => {
        const m = Math.floor(secs / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    return (
        <div className="p-6 pb-32 font-mono text-white min-h-screen flex flex-col items-center">
            {/* HEADER */}
            <div className="mb-8 border-b border-zinc-800 pb-4 w-full max-w-2xl text-center">
                <h1 className="text-3xl font-bold text-[#06b6d4]">DIALER — LEAD EXECUTION</h1>
                <p className="text-zinc-400 text-sm mt-2">Swipe Right to Call • Swipe Left to Skip</p>
            </div>

            <div className="mb-6 w-full max-w-sm flex flex-col space-y-4">
                <input
                    type="text"
                    placeholder="Enter Tenant ID to load queue"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 text-white p-2 rounded text-center text-sm focus:border-[#06b6d4] outline-none"
                />
            </div>

            {/* QUEUE COUNTER */}
            {queue.length > 0 && (
                <div className="text-zinc-400 text-sm mb-6 font-bold tracking-widest">
                    LEAD {currentIndex + 1} OF {queue.length}
                </div>
            )}

            {/* SWIPE CARD INTERFACE */}
            <div className="relative w-[380px] h-[480px] perspective-1000">
                <AnimatePresence mode="wait">
                    {currentLead ? (
                        <motion.div
                            key={currentLead.id}
                            data-testid="dialer-card"
                            variants={ROOFING_PHYSICS.shingleSlide}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            style={{ x }}
                            drag={callState === 'IDLE' ? "x" : false}
                            dragConstraints={{ left: -200, right: 200 }}
                            onDragEnd={handleDragEnd}
                            whileDrag={{ scale: 1.05 }}
                            className={`absolute inset-0 bg-zinc-800 border-2 rounded-2xl shadow-xl flex flex-col overflow-hidden cursor-grab active:cursor-grabbing ${callState === 'IN_PROGRESS' ? 'border-[#06b6d4] animate-pulse shadow-[#06b6d4]/50' : 'border-[#06b6d4]'
                                } ${smsState === 'CONFIRM' ? 'z-50' : ''}`}
                        >
                            {/* Confirmation Overlay within card */}
                            {smsState === 'CONFIRM' && (
                                <div className="absolute inset-0 bg-black/90 z-20 flex flex-col items-center justify-center p-6 text-center">
                                    <h3 className="text-white font-bold text-lg mb-4">ARE YOU SURE YOU WANT TO SEND THIS MESSAGE?</h3>
                                    <div className="bg-zinc-800 p-4 rounded text-sm mb-6 border border-zinc-700 w-full text-left italic">
                                        "{finalBody}"
                                    </div>
                                    <div className="flex space-x-3 w-full">
                                        <button
                                            onClick={() => setSmsState('DRAFT')}
                                            className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white py-3 rounded font-bold transition-colors text-xs"
                                        >
                                            NO — GO BACK
                                        </button>
                                        <button
                                            onClick={confirmSendSms}
                                            className="flex-1 bg-[#06b6d4] hover:bg-cyan-400 text-black py-3 rounded font-bold transition-colors text-xs"
                                        >
                                            YES — SEND IT
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Overlays */}
                            <motion.div
                                style={{ opacity: overlayOpacityRight }}
                                className="absolute inset-0 bg-green-500/80 z-10 flex justify-center items-center pointer-events-none"
                            >
                                <span className="text-white font-bold text-2xl rotate-12 drop-shadow-md">CALL LEAD</span>
                            </motion.div>
                            <motion.div
                                style={{ opacity: overlayOpacityLeft }}
                                className="absolute inset-0 bg-red-500/80 z-10 flex justify-center items-center pointer-events-none"
                            >
                                <span className="text-white font-bold text-2xl -rotate-12 drop-shadow-md">SKIP</span>
                            </motion.div>

                            {/* Top Section */}
                            <div className="bg-zinc-950 p-4 border-b border-zinc-800 flex justify-between items-center">
                                <span className="bg-green-900/50 text-green-400 px-3 py-1 rounded text-xs font-bold">
                                    {currentLead.priority_status}
                                </span>
                                <span className="text-4xl font-bold text-[#06b6d4] drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]">
                                    {currentLead.lead_score}
                                </span>
                            </div>

                            {/* Middle Section */}
                            <div className="p-6 flex-1 flex flex-col justify-center text-center">
                                <h2 className="text-2xl font-bold mb-1 truncate">{currentLead.address}</h2>
                                <p className="text-zinc-400 text-lg mb-4">{currentLead.homeowner_name || 'Unknown Owner'}</p>

                                <div className="text-zinc-500 text-sm italic mb-4">
                                    {currentLead.lead_archetype || 'Unclassified'}
                                </div>

                                {currentLead.urgency_flag && (
                                    <div className={`text-xs font-bold p-2 rounded mx-auto inline-block mb-4 max-w-[90%] ${currentLead.urgency_flag.includes('CRITICAL') ? 'bg-red-900/30 text-red-400 border border-red-500/50' : 'bg-yellow-900/30 text-yellow-400 border border-yellow-500/50'
                                        }`}>
                                        {currentLead.urgency_flag}
                                    </div>
                                )}

                                <div className={`text-sm font-bold mb-4 ${currentLead.days_until_deadline < 30 ? 'text-red-400' : 'text-green-400'
                                    }`}>
                                    {currentLead.days_until_deadline !== null ? `${currentLead.days_until_deadline} DAYS LEFT` : ''}
                                </div>

                                <div className="text-[#06b6d4] text-sm italic leading-relaxed border-t border-zinc-700 pt-4">
                                    "{currentLead.dynamic_sales_pitch || 'Pitch not generated.'}"
                                </div>
                            </div>

                        </motion.div>
                    ) : isLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center border-2 border-dashed border-zinc-800 rounded-2xl">
                            <div className="animate-pulse flex flex-col items-center">
                                <div className="w-16 h-16 bg-zinc-800 rounded-full mb-4"></div>
                                <div className="h-6 w-32 bg-zinc-800 rounded mb-2"></div>
                                <div className="h-4 w-24 bg-zinc-800 rounded"></div>
                            </div>
                        </div>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center border-2 border-dashed border-zinc-800 rounded-2xl text-zinc-500">
                            <svg className="w-16 h-16 text-zinc-600 mb-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 22V12h6v10" />
                            </svg>
                            <span className="font-mono font-bold text-xl">NO LEADS IN QUEUE</span>
                        </div>
                    )}
                </AnimatePresence>
            </div>

            {/* CONTROLS BELOW CARD */}
            {currentLead && (
                <div className="w-full max-w-sm mt-8 space-y-4">

                    {callState === 'IN_PROGRESS' && (
                        <div className="text-center mb-2">
                            <div className="text-[#06b6d4] font-bold text-2xl mb-1">{formatTime(callDuration)}</div>
                            <div className="text-xs text-zinc-400 animate-pulse uppercase tracking-widest">Call in progress...</div>
                        </div>
                    )}

                    {callState === 'IDLE' && (
                        <button
                            data-testid="call-button"
                            onClick={initiateCall}
                            className="w-full bg-[#06b6d4] hover:bg-cyan-400 text-zinc-950 font-bold py-4 rounded-xl text-lg transition-transform active:scale-95 shadow-lg shadow-[#06b6d4]/20"
                        >
                            📞 CALL {currentLead.homeowner_name?.split(' ')[0] || 'OWNER'}
                        </button>
                    )}

                    {(callState === 'IN_PROGRESS' || callState === 'ENDED') && (
                        <div data-testid="outcome-buttons" className="grid grid-cols-2 gap-2">
                            <div className="col-span-2 text-center text-xs text-zinc-500 mb-2 mt-4 uppercase">Log Call Outcome</div>
                            <button onClick={() => handleOutcome('NO ANSWER')} className={`bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-2 rounded text-xs font-bold transition-colors ${selectedOutcome === 'NO ANSWER' ? 'border border-[#06b6d4]' : ''}`}>
                                NO ANSWER
                            </button>
                            <button onClick={() => handleOutcome('VOICEMAIL')} className={`bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-2 rounded text-xs font-bold transition-colors ${selectedOutcome === 'VOICEMAIL' ? 'border border-[#06b6d4]' : ''}`}>
                                VOICEMAIL
                            </button>
                            <button onClick={() => handleOutcome('CALLBACK REQUESTED')} className={`bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-2 rounded text-xs font-bold transition-colors ${selectedOutcome === 'CALLBACK REQUESTED' ? 'border border-[#06b6d4]' : ''}`}>
                                CALLBACK REQ.
                            </button>
                            <button onClick={() => handleOutcome('NOT INTERESTED')} className={`bg-red-900/50 hover:bg-red-800/50 text-red-400 py-2 rounded text-xs font-bold transition-colors border ${selectedOutcome === 'NOT INTERESTED' ? 'border-red-400' : 'border-red-500/30'}`}>
                                NOT INTERESTED
                            </button>
                            <button onClick={() => handleOutcome('APPOINTMENT SET')} className={`col-span-2 bg-green-600 hover:bg-green-500 text-white py-3 rounded text-sm font-bold transition-colors shadow-lg mt-2 ${selectedOutcome === 'APPOINTMENT SET' ? 'ring-2 ring-white shadow-green-500/50' : 'shadow-green-500/20'}`}>
                                APPOINTMENT SET
                            </button>
                        </div>
                    )}

                    {/* SMS DRAFT PANEL */}
                    {callState === 'ENDED' && (
                        <div className="mt-6 bg-zinc-900 border border-[#06b6d4]/30 rounded-xl p-4 shadow-xl">
                            <h3 className="text-[#06b6d4] font-bold mb-3 tracking-wider text-center">FOLLOW-UP TEXT</h3>

                            {smsState === 'HIDDEN' && (
                                <button
                                    onClick={generateAiMessage}
                                    disabled={!geminiApiKey || isGenerating}
                                    className="w-full bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-600 py-3 rounded text-sm font-bold transition-colors disabled:opacity-50"
                                >
                                    {isGenerating ? 'GENERATING...' : 'GENERATE AI MESSAGE'}
                                </button>
                            )}

                            {(smsState === 'DRAFT' || smsState === 'CONFIRM') && (
                                <div className="space-y-3">
                                    <textarea
                                        data-testid="sms-draft-textarea"
                                        readOnly={!isEditing}
                                        value={finalBody}
                                        onChange={(e) => {
                                            setFinalBody(e.target.value);
                                            if (!wasEdited) setWasEdited(true);
                                        }}
                                        className={`w-full h-24 bg-zinc-950 border rounded p-3 text-sm resize-none outline-none focus:border-[#06b6d4] ${isEditing ? 'border-[#06b6d4] text-white' : 'border-zinc-700 text-zinc-300'
                                            }`}
                                    />
                                    <div className="flex space-x-2">
                                        <button
                                            data-testid="sms-edit-button"
                                            onClick={() => setIsEditing(!isEditing)}
                                            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-2 rounded text-xs font-bold transition-colors"
                                        >
                                            {isEditing ? 'DONE EDITING' : 'EDIT MESSAGE'}
                                        </button>
                                        <button
                                            data-testid="sms-send-button"
                                            onClick={() => setSmsState('CONFIRM')}
                                            disabled={isEditing}
                                            className="flex-1 bg-[#06b6d4] hover:bg-cyan-400 text-black py-2 rounded text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            SEND MESSAGE
                                        </button>
                                    </div>
                                </div>
                            )}

                            {smsState === 'SENT' && (
                                <div className="text-center py-4 bg-green-900/20 border border-green-500/50 rounded text-green-400 font-bold">
                                    ✓ MESSAGE SENT
                                </div>
                            )}
                        </div>
                    )}

                    {/* DISCLAIMER TEXT */}
                    <div className="mt-4 text-center">
                        <p className="text-zinc-600 text-xs italic leading-tight px-4">
                            DATAcartel Collective LLC maintains the right to record all conversations conducted through this platform. Poaching leads sourced through PLUGleads to avoid the 6.67% commission will result in permanent platform ban and fraud liability.
                        </p>
                    </div>

                    {/* MANUAL NAVIGATION */}
                    <div className="flex justify-between items-center pt-6 border-t border-zinc-800 mt-6">
                        <button
                            onClick={handlePrev}
                            disabled={currentIndex === 0 || callState === 'IN_PROGRESS'}
                            className="text-zinc-500 hover:text-white font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            ← PREV
                        </button>
                        <button
                            onClick={handleNext}
                            disabled={currentIndex === queue.length - 1 || callState === 'IN_PROGRESS'}
                            className="text-zinc-500 hover:text-white font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            NEXT →
                        </button>
                    </div>

                </div>
            )}
        </div>
    );
}