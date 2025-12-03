
import React, { useState, useEffect, useRef } from 'react';
import { Phone, Loader2, AlertCircle, CheckCircle, Mic, Globe, Settings, Server, RefreshCw, PhoneOff, BellRing, Signal, Clock, FileText, Save, SkipForward, ArrowLeft } from 'lucide-react';
import { VOICE_OPTIONS, API_BASE_URL } from '../constants';

const CallNow: React.FC = () => {
  // State for Call Logic
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Puck');
  const [recordCall, setRecordCall] = useState(false);
  
  // GRANULAR STATES
  // Fixed: Explicitly define CallStatus type to include 'disconnecting' to avoid type overlap errors.
  type CallStatus = 'idle' | 'dialing' | 'ringing' | 'connected' | 'error' | 'feedback' | 'summary' | 'disconnecting';
  const [status, setStatus] = useState<CallStatus>('idle');
  // Use a ref to track status for use in closures (like setTimeout)
  const statusRef = useRef<CallStatus>(status);
  
  const [message, setMessage] = useState('');
  const [callId, setCallId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [endedBy, setEndedBy] = useState<string | null>(null);
  
  // Feedback Form State
  const [manualOutcome, setManualOutcome] = useState('Call Finished');
  const [manualNotes, setManualNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHangupConfirm, setShowHangupConfirm] = useState(false);

  // Timers and Refs
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // State for Server Configuration
  const [apiUrl, setApiUrl] = useState(API_BASE_URL);
  const [showConfig, setShowConfig] = useState(false);
  const [serverStatus, setServerStatus] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    checkConnection();
    connectWebSocket();
    return () => {
        stopDurationTimer();
        if (wsRef.current) wsRef.current.close();
    };
  }, [apiUrl]);

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

  // --- WEBSOCKET CONNECTION ---
  const connectWebSocket = () => {
      if (wsRef.current) wsRef.current.close();

      const cleanUrl = apiUrl.replace(/\/$/, '');
      const wsUrl = cleanUrl.replace(/^http/, 'ws') + '/dashboard-stream';
      
      console.log("Connecting to Dashboard Socket:", wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => console.log("Dashboard Socket Open");
      
      ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === 'status_update') {
              handleStatusUpdate(data);
          }
      };
      
      ws.onclose = () => setTimeout(connectWebSocket, 3000); // Reconnect
      wsRef.current = ws;
  };

  const handleStatusUpdate = (data: any) => {
      // Only process updates for current call if we have an ID, or if it's a new call we just started
      if (callId && data.id !== callId) return;

      const backendStatus = (data.status || '').toLowerCase();
      
      // Update message if provided
      if (data.message) setMessage(data.message);

      // 1. Ringing
      if ((backendStatus === 'ringing' || backendStatus === 'initiated') && (status === 'dialing' || status === 'idle')) {
          setStatus('ringing');
      }

      // 2. Connected
      if ((backendStatus === 'connected' || backendStatus === 'answered') && status !== 'connected') {
          setStatus('connected');
          startDurationTimer();
      }

      // 3. Completed
      if (['completed', 'failed', 'busy', 'no-answer', 'rejected'].includes(backendStatus)) {
          if (['dialing', 'ringing', 'connected', 'disconnecting'].includes(status)) {
              setEndedBy(data.endedBy || 'network');
              handleRemoteHangup(backendStatus);
          }
      }
  };

  const handleRemoteHangup = (remoteStatus: string) => {
      stopDurationTimer();
      if (status === 'connected' || status === 'disconnecting') {
          setStatus('feedback');
      } else {
          setStatus('summary');
          setMessage(remoteStatus === 'failed' ? 'Call Failed.' : `Call Ended: ${remoteStatus}`);
          setDuration(0);
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
    
    setStatus('dialing');
    setMessage('Connecting to Tata Broadband Network...');
    setDuration(0);
    setEndedBy(null);

    try {
      const cleanUrl = apiUrl.replace(/\/$/, '');
      const response = await fetch(`${cleanUrl}/api/dial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            phone, 
            name: name || 'Valued Customer', 
            voice: selectedVoice,
            record: recordCall
        }),
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        setCallId(data.callId); // This is the 'localCallId' from backend
      } else {
        throw new Error(data.error || 'Failed to connect call.');
      }
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setMessage(`Connection Failed: ${err.message}`);
    }
  };

  const requestHangup = async () => {
      if (status === 'disconnecting') return;
      setShowHangupConfirm(false);
      setStatus('disconnecting');
      setMessage('Ending call...');
      stopDurationTimer();
      
      if (callId) {
          try {
              const cleanUrl = apiUrl.replace(/\/$/, '');
              await fetch(`${cleanUrl}/api/hangup`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ callId })
              });
          } catch (e) { console.error(e); }
      }
      // UI will transition via WebSocket, but force fail-safe after 2s
      setTimeout(() => {
          // Use ref to check latest status to avoid stale closure issue
          if (statusRef.current === 'disconnecting') setStatus('feedback');
      }, 2000);
  };

  const submitFeedback = async () => {
      setIsSubmitting(true);
      try {
          if (callId) {
              const cleanUrl = apiUrl.replace(/\/$/, '');
              await fetch(`${cleanUrl}/api/history/${callId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ outcome: manualOutcome, notes: manualNotes, sentiment: 'Neutral' })
              });
          }
      } catch(e) { console.error("Failed to save log", e); }
      
      setIsSubmitting(false);
      setStatus('summary');
      setMessage('Call Logged Successfully.');
  };

  const startNewCall = () => {
      setStatus('idle');
      setCallId(null);
      setDuration(0);
      setManualNotes('');
      setMessage('');
      setPhone(''); 
  };

  // UI FLAGS
  const isFormVisible = status === 'idle' || status === 'error';
  const isDialing = status === 'dialing';
  const isRinging = status === 'ringing';
  const isConnected = status === 'connected' || status === 'disconnecting';
  const isFeedback = status === 'feedback';
  const isSummary = status === 'summary';

  return (
    <div className="max-w-2xl mx-auto animate-fade-in relative">
        <div className="mb-8 flex justify-between items-start">
            <div>
                <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <Phone className="text-indigo-600" /> Call Now
                </h2>
                <p className="text-slate-500">Real-time dialing via Tata Broadband.</p>
            </div>
            <button onClick={() => setShowConfig(!showConfig)} className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50">
                <Settings size={20} />
            </button>
        </div>

        {(showConfig || serverStatus === 'offline') && (
            <div className="mb-6 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Server size={16}/> Backend Connection</h3>
                <div className="flex gap-2">
                    <input type="text" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2" />
                    <button onClick={checkConnection} className="bg-white border px-3 py-2 rounded-lg hover:bg-slate-50"><RefreshCw size={18} /></button>
                </div>
            </div>
        )}

        <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
            <div className="p-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-2"></div>
            <div className="p-8">
                
                {/* 1. DIALING FORM */}
                {isFormVisible && (
                    <form onSubmit={handleCall} className="space-y-6 animate-fade-in">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2"><Mic size={16} className="text-indigo-500"/> Agent Persona</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {VOICE_OPTIONS.map((voice) => (
                                    <div key={voice.id} onClick={() => setSelectedVoice(voice.id)} className={`cursor-pointer p-3 rounded-lg border flex items-center gap-3 ${selectedVoice === voice.id ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500' : 'bg-white border-slate-200'}`}>
                                        <div className={`w-4 h-4 rounded-full border ${selectedVoice === voice.id ? 'border-indigo-600 bg-indigo-600' : 'border-slate-400'}`}></div>
                                        <div className="text-sm font-medium text-slate-900">{voice.name}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aditi" className="w-full p-3 bg-slate-50 border border-slate-300 rounded-lg" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                                <div className="flex">
                                    <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-300 bg-slate-100 text-slate-500 sm:text-sm"><Globe size={14} className="mr-1"/>+91</span>
                                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 00000" required className="flex-1 p-3 bg-slate-50 border border-slate-300 rounded-r-lg" />
                                </div>
                            </div>
                        </div>

                        {status === 'error' && <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-3"><AlertCircle size={20}/>{message}</div>}

                        <button type="submit" disabled={!phone} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg flex items-center justify-center gap-2">
                            <Phone size={24} /> Call Now
                        </button>
                    </form>
                )}

                {/* 2. GRANULAR ACTIVE STATES */}
                {isDialing && (
                    <div className="p-8 bg-slate-50 rounded-xl flex flex-col items-center gap-6 border-2 border-slate-200 animate-fade-in">
                        <div className="w-24 h-24 bg-slate-200 rounded-full flex items-center justify-center relative"><Signal size={40} className="text-slate-500"/></div>
                        <div className="text-center">
                            <h3 className="text-2xl font-bold mb-1 text-slate-800">Dialing...</h3>
                            <p className="text-slate-500 text-sm">Connecting to Tata Network</p>
                            <Loader2 size={20} className="animate-spin text-slate-400 mt-2 mx-auto" />
                        </div>
                    </div>
                )}

                {isRinging && (
                    <div className="p-8 bg-yellow-50 text-yellow-900 rounded-xl flex flex-col items-center gap-6 border-2 border-yellow-300 animate-fade-in">
                        <div className="w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center relative"><BellRing size={40} className="text-yellow-600 animate-pulse"/></div>
                        <div className="text-center"><h3 className="text-2xl font-bold mb-1">Ringing...</h3><p className="text-yellow-700 text-sm">{message}</p></div>
                         <button onClick={() => setShowHangupConfirm(true)} className="mt-4 px-6 py-2 bg-red-100 text-red-700 font-bold rounded-lg hover:bg-red-200">Cancel</button>
                    </div>
                )}

                {isConnected && (
                    <div className="space-y-6 animate-fade-in relative">
                         {showHangupConfirm && (
                            <div className="absolute inset-0 bg-white/95 backdrop-blur-sm z-10 flex flex-col items-center justify-center text-center p-6 rounded-xl animate-fade-in">
                                <h4 className="text-lg font-bold text-slate-800 mb-2">End this call?</h4>
                                <div className="flex gap-4">
                                    <button onClick={() => setShowHangupConfirm(false)} className="px-6 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 font-medium">Cancel</button>
                                    <button onClick={requestHangup} className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-bold">End Call</button>
                                </div>
                            </div>
                        )}

                        <div className="p-8 bg-green-50 text-green-900 rounded-xl flex flex-col items-center gap-6 border-2 border-green-500 shadow-sm">
                            <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center animate-pulse-slow"><Phone size={40} className="text-green-600"/></div>
                            <div className="text-center">
                                <div className="flex items-center justify-center gap-2 text-4xl font-black font-mono text-green-800 mb-2">
                                    <Clock size={32} className="opacity-50"/>{formatTime(duration)}
                                </div>
                                <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-green-200 text-green-800 rounded-full text-xs font-bold uppercase tracking-wider">
                                    Live Connected
                                </div>
                            </div>
                        </div>
                        
                        <button 
                            type="button"
                            onClick={() => setShowHangupConfirm(true)}
                            disabled={status === 'disconnecting'} 
                            className={`w-full font-bold py-4 rounded-xl shadow-lg flex items-center justify-center gap-2 text-white transition-colors ${status === 'disconnecting' ? 'bg-slate-400 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600 shadow-red-200'}`}
                        >
                            <PhoneOff size={24} /> {status === 'disconnecting' ? 'Disconnecting...' : 'End Call'}
                        </button>
                    </div>
                )}
                
                {/* 3. FEEDBACK FORM */}
                {isFeedback && (
                    <div className="bg-slate-50 rounded-xl p-6 border border-slate-200 animate-fade-in">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><FileText className="text-indigo-600"/> Post-Call Wrap Up</h3>
                            {endedBy && <span className="text-xs bg-slate-200 text-slate-600 px-2 py-1 rounded">Ended by: {endedBy}</span>}
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Outcome</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {['Meeting Booked', 'Follow-up', 'Not Interested', 'Voicemail', 'Call Later'].map(o => (
                                        <button key={o} onClick={() => setManualOutcome(o)} className={`text-sm py-2 px-2 rounded border ${manualOutcome === o ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'}`}>{o}</button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Notes</label>
                                <textarea value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} className="w-full p-3 border border-slate-300 rounded-lg text-sm h-24" placeholder="Enter call summary..."></textarea>
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => setStatus('summary')} className="flex-1 py-2 text-slate-500 hover:bg-slate-200 rounded-lg flex items-center justify-center gap-2"><SkipForward size={18}/> Skip</button>
                                <button onClick={submitFeedback} disabled={isSubmitting} className="flex-1 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 flex items-center justify-center gap-2"><Save size={18}/> {isSubmitting ? 'Saving...' : 'Save Log'}</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 4. CALL SUMMARY */}
                {isSummary && (
                    <div className="text-center py-8 animate-fade-in">
                        <div className="w-16 h-16 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <PhoneOff size={32} />
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2">Call Ended</h3>
                        <p className="text-slate-500 mb-8">{message}</p>
                        
                        <button 
                            onClick={startNewCall}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-md flex items-center justify-center gap-2"
                        >
                            <ArrowLeft size={20} /> Start New Call
                        </button>
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};

export default CallNow;
    