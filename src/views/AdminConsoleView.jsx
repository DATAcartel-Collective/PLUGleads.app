import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import IngestView from './IngestView';
import HailView from './HailView';
import ScoringView from './ScoringView';

function SettingsView() {
  return (
    <div className="p-8 max-w-4xl mx-auto text-zinc-300">
      <h3 className="text-2xl font-bold text-[#06b6d4] mb-6">System Settings & Integrations</h3>
      
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
        <h4 className="text-xl font-semibold text-white mb-4">Authentication Settings</h4>
        <p className="mb-4 text-sm text-zinc-400">
          OAuth is now handled natively via Supabase Google Auth. You no longer need to manually enter a Client ID. 
          The backend manages the authentication handshake securely.
        </p>
        <div className="flex items-center space-x-2 text-sm text-green-400 bg-green-900/20 border border-green-800 p-3 rounded">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span>Google OAuth Integration Active</span>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
        <h4 className="text-xl font-semibold text-white mb-4">Legacy / Separate Versions</h4>
        <p className="mb-4 text-sm text-zinc-400">
          A separate Firebase-based architecture test version is available. You can launch it below to test its UI, animations, and functionality independently.
        </p>
        <a 
          href="/firebase-version.html" 
          target="_blank" 
          rel="noopener noreferrer"
          className="inline-block px-4 py-2 bg-[#06b6d4]/10 border border-[#06b6d4] text-[#06b6d4] rounded hover:bg-[#06b6d4]/20 transition-colors font-bold text-sm"
        >
          LAUNCH FIREBASE PROTOTYPE
        </a>
      </div>
    </div>
  );
}

export default function AdminConsoleView() {
  const [activeTab, setActiveTab] = useState('INGEST');

  const tabs = [
    { id: 'INGEST', label: 'DATA INGESTION' },
    { id: 'HAIL', label: 'HAIL / CULLING' },
    { id: 'SCORING', label: 'SCORING ENGINE' },
    { id: 'SETTINGS', label: 'SETTINGS' }
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="bg-zinc-900 border-b border-zinc-800 p-4 flex space-x-6 items-center z-10 sticky top-0">
        <h2 className="text-[#06b6d4] font-bold text-lg uppercase mr-4 tracking-wider">ADMIN CONSOLE</h2>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`font-mono text-sm uppercase tracking-wide transition-colors ${
              activeTab === tab.id
                ? 'text-[#06b6d4] font-bold border-b-2 border-[#06b6d4] pb-1'
                : 'text-zinc-500 hover:text-zinc-300 pb-1'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {activeTab === 'INGEST' && <IngestView />}
            {activeTab === 'HAIL' && <HailView />}
            {activeTab === 'SCORING' && <ScoringView />}
            {activeTab === 'SETTINGS' && <SettingsView />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
