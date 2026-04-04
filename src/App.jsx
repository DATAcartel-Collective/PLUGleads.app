import React, { useState } from 'react';
import IngestView from './views/IngestView';
import HailView from './views/HailView';
import LeadsView from './views/LeadsView';
import DialerView from './views/DialerView';
import ScoringView from './views/ScoringView';
import CRMView from './views/CRMView';
import SLVPanel from './components/SLVPanel';

export default function App() {
  const [activeView, setActiveView] = useState('LEADS');

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <nav className="fixed top-0 left-0 right-0 h-[56px] bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-6 z-50">
        <div className="text-[#06b6d4] font-bold font-mono text-xl">
          PLUGleads
        </div>
        <div className="flex space-x-6 font-mono text-sm">
          <button
            data-nav="INGEST"
            onClick={() => setActiveView('INGEST')}
            className={`text-[#06b6d4] transition-opacity ${activeView === 'INGEST' ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`}
          >
            INGEST
          </button>
          <button
            data-nav="LEADS"
            onClick={() => setActiveView('LEADS')}
            className={`text-[#06b6d4] transition-opacity ${activeView === 'LEADS' ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`}
          >
            LEADS
          </button>
          <button
            data-nav="STORMS"
            onClick={() => setActiveView('STORMS')}
            className={`text-[#06b6d4] transition-opacity ${activeView === 'STORMS' ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`}
          >
            STORMS
          </button>
          <button
            data-nav="DIALER"
            onClick={() => setActiveView('DIALER')}
            className={`text-[#06b6d4] transition-opacity ${activeView === 'DIALER' ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`}
          >
            DIALER
          </button>
          <button
            data-nav="SCORING"
            onClick={() => setActiveView('SCORING')}
            className={`text-[#06b6d4] transition-opacity ${activeView === 'SCORING' ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`}
          >
            SCORING
          </button>
          <button
            data-nav="CRM"
            onClick={() => setActiveView('CRM')}
            className={`text-[#06b6d4] transition-opacity ${activeView === 'CRM' ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`}
          >
            CRM
          </button>
        </div>
      </nav>
      <main className="pt-[56px]">
        {activeView === 'INGEST' && <IngestView />}
        {activeView === 'LEADS' && <LeadsView />}
        {activeView === 'STORMS' && <HailView />}
        {activeView === 'DIALER' && <DialerView />}
        {activeView === 'SCORING' && <ScoringView />}
        {activeView === 'CRM' && <CRMView />}
      </main>
      <SLVPanel />
    </div>
  );
}
