import React, { useState, useEffect } from 'react';
import IngestView from './views/IngestView';
import HailView from './views/HailView';
import LeadsView from './views/LeadsView';
import DialerView from './views/DialerView';
import ScoringView from './views/ScoringView';
import CRMView from './views/CRMView';
import SLVPanel from './components/SLVPanel';
import { supabase } from './lib/supabaseClient';

export default function App() {
  const [activeView, setActiveView] = useState('LEADS');
  const [supabaseConnected, setSupabaseConnected] = useState(false);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const { error } = await supabase.from('leads').select('id').limit(1);
        if (!error || error.message.includes('Auth required')) {
          setSupabaseConnected(true);
        } else {
          setSupabaseConnected(false);
        }
      } catch (err) {
        setSupabaseConnected(false);
      }
    };
    checkConnection();
    const interval = setInterval(checkConnection, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-mono">
      <nav className="fixed top-0 left-0 right-0 h-[56px] bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-6 z-50">
        <div className="flex items-center space-x-2">
          <span className="text-[#06b6d4] text-xl">⚡</span>
          <span className="text-[#06b6d4] font-bold text-xl">PLUGleads</span>
        </div>
        
        <div className="text-zinc-400 font-bold uppercase tracking-widest absolute left-1/2 transform -translate-x-1/2">
          {activeView}
        </div>

        <div className="flex space-x-6 text-sm font-bold items-center">
          {['INGEST', 'CULLING', 'SCORING', 'LEADS', 'DIALER', 'CRM'].map(view => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={`transition-opacity ${activeView === view ? 'text-[#06b6d4] opacity-100' : 'text-[#06b6d4] opacity-40 hover:opacity-100'}`}
            >
              {view}
            </button>
          ))}
          <div className="ml-4 flex items-center justify-center w-6 h-6">
             <div className={`w-2 h-2 rounded-full ${supabaseConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} title={supabaseConnected ? 'Supabase Connected' : 'Supabase Disconnected'} />
          </div>
        </div>
      </nav>
      <main className="pt-[56px]">
        {activeView === 'INGEST' && <IngestView />}
        {activeView === 'CULLING' && <HailView />}
        {activeView === 'SCORING' && <ScoringView />}
        {activeView === 'LEADS' && <LeadsView />}
        {activeView === 'DIALER' && <DialerView />}
        {activeView === 'CRM' && <CRMView />}
      </main>
      <SLVPanel />
    </div>
  );
}
