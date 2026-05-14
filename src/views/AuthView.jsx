import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function AuthView({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Check if user is already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        onLogin(session.user);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        onLogin(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [onLogin]);

  const loginWithEmail = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
    }
    setLoading(false);
  };

  const loginWithGoogle = async () => {
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative z-10 bg-[#0a0a0f]" style={{
        backgroundImage: 'linear-gradient(rgba(0, 255, 255, 0.15) 1px, transparent 1px), linear-gradient(to right, rgba(0, 255, 255, 0.15) 1px, #0a0a0f 1px)',
        backgroundSize: '20px 20px',
        color: '#e2e8f0',
        fontFamily: "'Poppins', sans-serif"
    }}>
      <div className="bg-[#10101a] border border-[#00ffff]/20 rounded-lg p-8 max-w-md w-full mx-4 shadow-[0_0_20px_rgba(0,255,255,0.1)] relative overflow-hidden group hover:border-[#00ffff] hover:shadow-[0_0_30px_rgba(0,255,255,0.2)] transition-all duration-300">
        <div className="absolute top-0 left-[-100%] w-full h-[2px] bg-gradient-to-r from-transparent via-[#00ffff] to-transparent animate-[scan_3s_ease-in-out_infinite]" />
        
        <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-2 tracking-wider" style={{ fontFamily: "'Orbitron', sans-serif" }}>
                <span className="text-[#00ffff]">PLUGleads</span>
            </h1>
            <div className="text-[#00ffff]/60 text-sm tracking-widest mb-4">
                <span>DATA</span><span className="text-white">cartel</span>
            </div>
            <div className="text-xl font-semibold text-[#00ffff]/80 mb-2">COLLECTIVE</div>
            <p className="text-gray-400 text-sm">Roofing Lead Intelligence System</p>
        </div>
        
        <form onSubmit={loginWithEmail}>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email" 
              className="bg-[#10101a]/80 border border-[#00ffff]/20 text-[#e2e8f0] px-4 py-3 rounded-lg w-full mb-3 focus:outline-none focus:border-[#00ffff] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)]" 
              autoComplete="email" 
            />
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password" 
              className="bg-[#10101a]/80 border border-[#00ffff]/20 text-[#e2e8f0] px-4 py-3 rounded-lg w-full mb-4 focus:outline-none focus:border-[#00ffff] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)]" 
              autoComplete="current-password" 
            />
            
            <button 
              type="submit"
              disabled={loading}
              className="w-full px-6 py-4 bg-[#00ffff]/10 border-2 border-[#00ffff] text-[#00ffff] rounded-lg hover:bg-[#00ffff]/20 hover:-translate-y-0.5 hover:shadow-[0_0_20px_rgba(0,255,255,0.2)] transition-all font-semibold mb-3 flex items-center justify-center"
            >
                {loading ? <span className="w-5 h-5 border-2 border-[#00ffff]/30 border-t-[#00ffff] rounded-full animate-spin"></span> : <span>AUTHENTICATE</span>}
            </button>
            
            <div className="text-center mb-4">
                <span className="text-gray-500 text-sm">OR</span>
            </div>
            
            <button 
              type="button"
              onClick={loginWithGoogle}
              disabled={loading}
              className="w-full flex items-center justify-center space-x-3 px-6 py-3 bg-[#0a0a0f] border border-[#00ffff]/20 text-gray-300 rounded-lg hover:border-[#00ffff]/50 transition-all"
            >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span className="font-medium">Sign in with Google</span>
            </button>
            
            {error && <div className="mt-4 p-3 bg-red-500/10 border border-red-500 rounded text-red-400 text-sm">{error}</div>}
        </form>
        
        <div className="mt-6 text-center">
            <div className="text-xs text-gray-500">SECURE MULTI-USER ACCESS</div>
            <div className="flex justify-center mt-2 space-x-1">
                <div className="w-2 h-2 bg-[#00ffff] rounded-full animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]"></div>
                <div className="w-2 h-2 bg-[#00ffff] rounded-full animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]" style={{ animationDelay: '0.3s' }}></div>
                <div className="w-2 h-2 bg-[#00ffff] rounded-full animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]" style={{ animationDelay: '0.6s' }}></div>
            </div>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes scan {
          0% { left: -100%; }
          100% { left: 100%; }
        }
      `}} />
    </div>
  );
}
