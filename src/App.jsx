import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ROOFING_PHYSICS } from './lib/roofingAnimations';
import AdminConsoleView from './views/AdminConsoleView';
import LeadsView from './views/LeadsView';
import DialerView from './views/DialerView';
import CRMView from './views/CRMView';
import AuthView from './views/AuthView';
import { supabase } from './lib/supabaseClient';

export default function App() {
  const [session, setSession] = useState(null);
  const [activeView, setActiveView] = useState('LEADS');
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [userRole, setUserRole] = useState('ADMIN'); // 'ADMIN' | 'REP'
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

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

  if (!session) {
    return <AuthView onLogin={() => {}} />;
  }

  const ALL_VIEWS = ['ADMIN', 'LEADS', 'DIALER', 'CRM'];
  const REP_VIEWS = ['DIALER', 'CRM'];
  const visibleViews = userRole === 'ADMIN' ? ALL_VIEWS : REP_VIEWS;

  return (
    <div className="min-h-screen bg-[#09090b] text-white font-mono overflow-x-hidden">
      <nav className="fixed top-0 left-0 right-0 h-[56px] bg-[#09090b] border-b border-[#06b6d4]/20 flex items-center justify-between px-[24px] z-50">
        <div className="flex items-center space-x-2 whitespace-nowrap">
          <span className="text-[18px]">⚡</span>
          <span className="text-[#06b6d4] font-bold text-[18px] font-mono whitespace-nowrap">PLUGleads</span>
        </div>

        <div className="hidden md:flex flex-row space-x-[24px] items-center justify-center flex-1 ml-8">
          {visibleViews.map(view => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={`transition-all uppercase cursor-pointer text-[12px] tracking-widest font-mono ${activeView === view ? 'text-[#06b6d4] opacity-100' : 'text-zinc-400 opacity-40 hover:opacity-100'}`}
            >
              {view}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-4">
          <div className={`w-[8px] h-[8px] rounded-full ${supabaseConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} title={supabaseConnected ? 'Supabase Connected' : 'Supabase Disconnected'} />
          
          <button className="md:hidden text-zinc-400 p-1" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="md:hidden fixed top-[56px] left-0 right-0 bg-[#09090b] border-b border-[#06b6d4]/20 z-40 p-4 flex flex-col space-y-4"
          >
            {visibleViews.map(view => (
              <button
                key={view}
                onClick={() => { setActiveView(view); setMobileMenuOpen(false); }}
                className={`font-mono text-[12px] tracking-widest uppercase text-left transition-all ${activeView === view ? 'text-[#06b6d4] opacity-100' : 'text-zinc-400 opacity-40'}`}
              >
                {view}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <main className="pt-[56px] h-screen overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            variants={ROOFING_PHYSICS.shingleSlide}
            initial="initial"
            animate="animate"
            exit="exit"
            className="min-h-full"
          >
            {activeView === 'ADMIN' && <AdminConsoleView />}
            {activeView === 'LEADS' && <LeadsView />}
            {activeView === 'DIALER' && <DialerView />}
            {activeView === 'CRM' && <CRMView />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
