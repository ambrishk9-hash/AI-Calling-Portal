
import React, { useState, useEffect, useRef } from 'react';
import { Phone, Loader2, AlertCircle, CheckCircle, Mic, Globe, Settings, Server, RefreshCw, PhoneOff, PhoneForwarded, BellRing } from 'lucide-react';
import { VOICE_OPTIONS, API_BASE_URL } from '../constants';

const CallNow: React.FC = () => {
  // State for Call Logic
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Puck');
  const [recordCall, setRecordCall] = useState(false);
  const [status, setStatus] = useState<'idle' | 'calling' | 'ringing' | 'connected' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [callId, setCallId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  
  // Timers and Refs
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // State for Server Configuration
  const [apiUrl, setApiUrl] = useState(API_BASE_URL);
  const [showConfig, setShowConfig] = useState(false);
  const [serverStatus, setServerStatus] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');

  // Check connection on mount or url change
  useEffect(() => {
    checkConnection();
    return () => {
        stopDurationTimer();
        stopPolling();
    };
  }, []);

  const checkConnection = async () => {
    setServerStatus('checking');
    try {
        const cleanUrl = apiUrl.replace(/\/$/, '');
        const res = await fetch(`${cleanUrl}/`);
        if (res.ok) {
            setServerStatus('online');
            if (status === 'idle') setMessage('');
        } else {
            setServerStatus('offline');
        }
    } catch (e) {
        setServerStatus('offline');
    }
  };

  // --- POLLING LOGIC ---
  const startPolling = () => {
      stopPolling();
      pollTimerRef.current = setInterval(checkCallStatus, 1000); // Poll every 1s
  };

  const stopPolling = () => {
      if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
      }
  };

  const checkCallStatus = async () => {
      try {
        const cleanUrl = apiUrl.replace(/\/$/, '');
        const res = await fetch(`${cleanUrl}/api/call-status`);
        const data = await res.json();
        
        // Handle Answered State (Webhook or WebSocket trigger)
        if (data.status === 'answered' && status !== 'connected') {
            setStatus('connected');
            setMessage(`Call Answered! Agent ${data.agent} is active.`);
            startDurationTimer();
        } 
        // Handle Completed State (Webhook trigger)
        else if (data.status === 'completed' || data.status === 'failed') {
            stopPolling();
            stopDurationTimer();
            setDuration(0);
            setStatus('idle');
            setMessage(data.status === 'failed' ? 'Call Failed.' : 'Call Finished.');
            setCallId(null);
            
            // Allow user to see "Finished" briefly before clearing
            setTimeout(() => { if(status === 'idle') setMessage(''); }, 3000);
        }
        else if (data.status === 'idle' && status === 'connected') {
            // Safety fallback if backend reset status but we missed 'completed' event
            hangup();
        }
      } catch (e) {
          console.error("Polling error", e);
      }
  };
  // ---------------------

  const startDurationTimer = () => {
      stopDurationTimer();
      setDuration(0);
      durationTimerRef.current = setInterval(() => {
          setDuration(prev => prev + 1);
      }, 1000);
  };

  const stopDurationTimer = () => {
      if (durationTimerRef.current) {
          clearInterval(durationTimerRef.current);
          durationTimerRef.current = null;
      }
  };

  const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;

    setStatus('calling');
    setMessage('Connecting to Tata Broadband Network...');

    try {
      const cleanUrl = apiUrl.replace(/\/$/, '');
      const endpoint = `${cleanUrl}/api/dial`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            phone, 
            name: name || 'Valued Customer', 
            voice: selectedVoice,
            record: recordCall, 
            provider: 'tata-broadband' 
        }),
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        setCallId(data.callId);
        // Switch to Ringing State
        setStatus('ringing'); 
        setMessage('Waiting for user to answer...');
        startPolling(); // Start watching for answer
      } else {
        throw new Error(data.error || data.message || 'Failed to connect call.');
      }
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      if (err.message && err.message.includes('Failed to fetch')) {
        setMessage('Cannot reach Server. Check Config ⚙️');
        setShowConfig(true); 
        setServerStatus('offline');
      } else {
        setMessage(`Connection Failed: ${err.message}`);
      }
    }
  };

  const hangup = () => {
      setStatus('idle');
      setMessage('');
      setCallId(null);
      setDuration(0);
      stopDurationTimer();
      stopPolling();
  };

  return (
    <div className="max-w-2xl mx-auto animate-fade-in relative">
        
        {/* Header with Config Toggle */}
        <div className="mb-8 flex justify-between items-start">
            <div>
                <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <Phone className="text-indigo-600" /> Call Now
                </h2>
                <p className="text-slate-500">Real-time dialing via Tata Broadband.</p>
            </div>
            <button 
                onClick={() => setShowConfig(!showConfig)}
                className={`p-2 rounded-lg transition-colors border ${showConfig ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                title="Server Configuration"
            >
                <Settings size={20} />
            </button>
        </div>

        {/* Server Configuration Panel */}
        {(showConfig || serverStatus === 'offline') && (
            <div className="mb-6 bg-slate-50 border border-slate-200 rounded-xl p-4 animate-slide-in-top">
                <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <Server size={16} /> Backend Server Connection
                </h3>
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={apiUrl} 
                        onChange={(e) => setApiUrl(e.target.value)} 
                        placeholder="http://localhost:3000 or https://your-ngrok.app"
                        className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <button 
                        onClick={checkConnection}
                        className="bg-white border border-slate-300 text-slate-700 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors"
                        title="Test Connection"
                    >
                        <RefreshCw size={18} className={serverStatus === 'checking' ? 'animate-spin' : ''} />
                    </button>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-500">Status:</span>
                    {serverStatus === 'online' && <span className="text-green-600 flex items-center gap-1"><CheckCircle size={12}/> Online (Ready)</span>}
                    {serverStatus === 'offline' && <span className="text-red-600 flex items-center gap-1"><AlertCircle size={12}/> Offline (Run 'node server.js')</span>}
                    {serverStatus === 'checking' && <span className="text-orange-500">Checking...</span>}
                    {serverStatus === 'unknown' && <span className="text-slate-400">Unknown</span>}
                </div>
            </div>
        )}

        <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
            <div className="p-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-2"></div>
            
            <div className="p-8">
                <form onSubmit={handleCall} className="space-y-6">
                    
                    {/* Voice Selection */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                            <Mic size={16} className="text-indigo-500" /> Select Agent Persona
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {VOICE_OPTIONS.map((voice) => (
                                <div 
                                    key={voice.id}
                                    onClick={() => setSelectedVoice(voice.id)}
                                    className={`
                                        cursor-pointer p-3 rounded-lg border flex items-center gap-3 transition-all
                                        ${selectedVoice === voice.id 
                                            ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500' 
                                            : 'bg-white border-slate-200 hover:bg-slate-50'
                                        }
                                    `}
                                >
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedVoice === voice.id ? 'border-indigo-600' : 'border-slate-400'}`}>
                                        {selectedVoice === voice.id && <div className="w-2 h-2 rounded-full bg-indigo-600"></div>}
                                    </div>
                                    <div className="text-sm">
                                        <div className="font-medium text-slate-900">{voice.name}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Customer Name</label>
                            <input 
                                type="text" 
                                value={name} 
                                onChange={(e) => setName(e.target.value)} 
                                placeholder="e.g. Aditi Sharma" 
                                disabled={status !== 'idle' && status !== 'error'}
                                className="w-full p-3 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:opacity-60"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
                            <div className="flex">
                                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-300 bg-slate-100 text-slate-500 sm:text-sm">
                                    <Globe size={14} className="mr-1" /> +91
                                </span>
                                <input 
                                    type="tel" 
                                    value={phone} 
                                    onChange={(e) => setPhone(e.target.value)} 
                                    placeholder="98765 00000" 
                                    required
                                    disabled={status !== 'idle' && status !== 'error'}
                                    className="flex-1 p-3 bg-slate-50 border border-slate-300 rounded-r-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:opacity-60"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Record Toggle */}
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${recordCall ? 'bg-red-100 text-red-600' : 'bg-slate-200 text-slate-500'}`}>
                                <Mic size={20} />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-900">Record Call</p>
                                <p className="text-xs text-slate-500">Save audio for quality assurance.</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={recordCall} 
                                onChange={(e) => setRecordCall(e.target.checked)} 
                                disabled={status !== 'idle'}
                                className="sr-only peer" 
                            />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                    </div>

                    {status === 'error' && (
                        <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-3 animate-shake">
                            <AlertCircle size={20} />
                            <span className="font-medium break-all">{message}</span>
                        </div>
                    )}

                    {/* RINGING STATE */}
                    {status === 'ringing' && (
                        <div className="p-8 bg-yellow-50 text-yellow-800 rounded-xl flex flex-col items-center gap-4 animate-fade-in border-2 border-yellow-200 shadow-inner">
                            <div className="w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center relative shadow-sm">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-20"></span>
                                <span className="animate-ping absolute inline-flex h-2/3 w-2/3 rounded-full bg-yellow-400 opacity-40 delay-150"></span>
                                <BellRing size={40} className="text-yellow-600 relative z-10 animate-bounce" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-2xl font-bold mb-1">Ringing...</h3>
                                <p className="text-yellow-700 text-sm opacity-80">{message}</p>
                            </div>
                        </div>
                    )}

                    {/* CONNECTED STATE */}
                    {status === 'connected' && (
                        <div className="p-8 bg-green-50 text-green-900 rounded-xl flex flex-col items-center gap-4 animate-fade-in border-2 border-green-400 shadow-md">
                            <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center relative">
                                <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-green-300 opacity-40"></span>
                                <Phone size={40} className="text-green-600 relative z-10" />
                            </div>
                            <div className="text-center">
                                <div className="text-4xl font-black font-mono tracking-widest text-green-800 mb-2">{formatTime(duration)}</div>
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-200 text-green-800 rounded-full text-xs font-bold uppercase tracking-wider">
                                    <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse"></div>
                                    Live Call
                                </div>
                                <p className="text-xs text-green-700 mt-3 font-mono">ID: {callId}</p>
                            </div>
                        </div>
                    )}

                    <div className="pt-4">
                        {status === 'connected' || status === 'ringing' ? (
                            <button 
                                type="button" 
                                onClick={hangup}
                                className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-red-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                            >
                                <PhoneOff size={24} className="rotate-[135deg]" />
                                End Call
                            </button>
                        ) : (
                            <button 
                                type="submit" 
                                disabled={status === 'calling' || !phone}
                                className={`
                                    w-full font-bold py-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2
                                    ${status === 'calling' 
                                        ? 'bg-indigo-400 cursor-not-allowed text-white' 
                                        : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 hover:shadow-indigo-300 active:scale-95'
                                    }
                                `}
                            >
                                {status === 'calling' ? (
                                    <>
                                        <Loader2 className="animate-spin" size={24} />
                                        Dialing...
                                    </>
                                ) : (
                                    <>
                                        <Phone size={24} />
                                        Call Now
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    </div>
  );
};

export default CallNow;
