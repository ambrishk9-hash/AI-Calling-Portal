
import React, { useState, useEffect } from 'react';
import { Phone, Loader2, AlertCircle, CheckCircle, Mic, Globe, Settings, Server, RefreshCw } from 'lucide-react';
import { VOICE_OPTIONS, API_BASE_URL } from '../constants';

const CallNow: React.FC = () => {
  // State for Call Logic
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Puck');
  const [status, setStatus] = useState<'idle' | 'calling' | 'connected' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [callId, setCallId] = useState<string | null>(null);

  // State for Server Configuration
  const [apiUrl, setApiUrl] = useState(API_BASE_URL);
  const [showConfig, setShowConfig] = useState(false);
  const [serverStatus, setServerStatus] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');

  // Check connection on mount or url change
  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    setServerStatus('checking');
    try {
        // Remove trailing slash for consistency
        const cleanUrl = apiUrl.replace(/\/$/, '');
        const res = await fetch(`${cleanUrl}/`);
        if (res.ok) {
            setServerStatus('online');
            // If user didn't open config manually, and we are online, ensure config is closed
            if (status === 'idle') setMessage('');
        } else {
            setServerStatus('offline');
        }
    } catch (e) {
        setServerStatus('offline');
    }
  };

  const handleCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;

    setStatus('calling');
    setMessage('Initiating call via Tata Broadband Network...');

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
            provider: 'tata-broadband' 
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setStatus('connected');
        setCallId(data.callId);
        setMessage(`Call Connected! Agent is speaking with ${selectedVoice} voice.`);
      } else {
        throw new Error(data.error || 'Failed to connect call.');
      }
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      if (err.message.includes('Failed to fetch')) {
        setMessage('Cannot reach Server. Check Config ⚙️');
        setShowConfig(true); // Auto-open config on failure
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
                {serverStatus === 'offline' && (
                    <p className="text-xs text-slate-500 mt-2 italic">
                        Tip: If using Tataflow, enter your <strong>ngrok URL</strong> above (e.g. https://abc.ngrok-free.app).
                    </p>
                )}
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
                                className="w-full p-3 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
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
                                    className="flex-1 p-3 bg-slate-50 border border-slate-300 rounded-r-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                />
                            </div>
                        </div>
                    </div>

                    {status === 'error' && (
                        <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-3 animate-shake">
                            <AlertCircle size={20} />
                            <span className="font-medium">{message}</span>
                        </div>
                    )}

                    {status === 'connected' && (
                        <div className="p-4 bg-green-50 text-green-700 rounded-lg flex items-center gap-3 animate-fade-in">
                            <CheckCircle size={20} />
                            <div>
                                <p className="font-bold">Connected</p>
                                <p className="text-sm">{message}</p>
                                <p className="text-xs text-green-600 mt-1 font-mono">ID: {callId}</p>
                            </div>
                        </div>
                    )}

                    <div className="pt-4">
                        {status === 'connected' ? (
                            <button 
                                type="button" 
                                onClick={hangup}
                                className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-red-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                            >
                                <Phone size={24} className="rotate-[135deg]" />
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
                                        Connecting...
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
