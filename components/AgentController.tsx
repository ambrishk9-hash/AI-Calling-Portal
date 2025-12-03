
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { Mic, MicOff, Phone, PhoneOff, Settings, Activity, UserCog, CheckCircle, AlertCircle, RefreshCw, XCircle, HelpCircle, Wrench, ClipboardList, Save, SkipForward } from 'lucide-react';
import { GET_SYSTEM_PROMPT, BOOK_MEETING_TOOL, LOG_OUTCOME_TOOL, TRANSFER_CALL_TOOL, PitchStrategy, LanguageMode, VOICE_OPTIONS, API_BASE_URL } from '../constants';
import { base64ToUint8Array, arrayBufferToBase64, floatTo16BitPCM, decodeAudioData } from '../utils/audioUtils';
import LiveAudioVisualizer from './LiveAudioVisualizer';

const AgentController: React.FC = () => {
  // Connection State
  const [isConnected, setIsConnected] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [connectionError, setConnectionError] = useState<{title: string, message: string} | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Configuration State
  const [showSettings, setShowSettings] = useState(false);
  const [strategy, setStrategy] = useState<PitchStrategy>('BALANCED');
  const [language, setLanguage] = useState<LanguageMode>('HINGLISH');
  const [selectedVoice, setSelectedVoice] = useState<string>('Puck');
  
  // UI Feedback State
  const [logs, setLogs] = useState<{sender: 'user' | 'agent' | 'system', text: string}[]>([]);
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'info' | 'alert'} | null>(null);
  const [transferStatus, setTransferStatus] = useState<string | null>(null);

  // Manual Logging State
  const [showPostCall, setShowPostCall] = useState(false);
  const [manualOutcome, setManualOutcome] = useState('Meeting Booked');
  const [manualSentiment, setManualSentiment] = useState('Positive');

  // Audio Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef<number>(0);
  
  // State Refs for Callbacks
  const isMicOnRef = useRef(true);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  // Sync state with ref for callbacks
  useEffect(() => {
    isMicOnRef.current = isMicOn;
  }, [isMicOn]);

  const addLog = (sender: 'user' | 'agent' | 'system', text: string) => {
    setLogs(prev => [...prev, { sender, text }]);
  };

  const showNotification = (message: string, type: 'success' | 'info' | 'alert' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const stopAudio = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }
    audioQueueRef.current.forEach(node => {
        try { node.stop(); } catch(e) {}
    });
    audioQueueRef.current = [];
  };

  const connectToLiveAPI = async () => {
    try {
      setConnectionError(null);
      setIsConnecting(true);
      setShowPostCall(false); // Reset post call UI

      // Check for API Key specifically
      if (!process.env.API_KEY) {
          throw new Error("MISSING_API_KEY");
      }

      setShowSettings(false); 
      setTransferStatus(null);
      addLog('system', 'Initializing Audio Contexts...');
      
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const systemInstruction = GET_SYSTEM_PROMPT(strategy, language, selectedVoice);
      
      addLog('system', `Connecting to Gemini Live (${strategy}, ${language}, Voice: ${selectedVoice})...`);

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
          },
          tools: [{ functionDeclarations: [BOOK_MEETING_TOOL, LOG_OUTCOME_TOOL, TRANSFER_CALL_TOOL] }],
        },
        callbacks: {
          onopen: async () => {
            addLog('system', `Connected to Agent Priya (${selectedVoice}).`);
            setIsConnected(true);
            setIsConnecting(false);
            
            try {
              streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
              if (!inputAudioContextRef.current) return;
              
              sourceRef.current = inputAudioContextRef.current.createMediaStreamSource(streamRef.current);
              processorRef.current = inputAudioContextRef.current.createScriptProcessor(2048, 1, 1);
              
              processorRef.current.onaudioprocess = (e) => {
                 if (!sessionPromiseRef.current) return;
                 const inputData = e.inputBuffer.getChannelData(0);
                 if (!isMicOnRef.current) { inputData.fill(0); }
                 const pcm16 = floatTo16BitPCM(inputData);
                 const base64Data = arrayBufferToBase64(pcm16);
                 sessionPromiseRef.current?.then(session => {
                    session.sendRealtimeInput({
                        media: { mimeType: 'audio/pcm;rate=16000', data: base64Data }
                    });
                 });
              };
              
              const gainNode = inputAudioContextRef.current.createGain();
              gainNode.gain.value = 0;
              sourceRef.current.connect(processorRef.current);
              processorRef.current.connect(gainNode);
              gainNode.connect(inputAudioContextRef.current.destination);
              
            } catch (err) {
              addLog('system', `Mic Error: ${err}`);
              setConnectionError({ title: "Microphone Access Denied", message: "Please allow microphone access in your browser settings." });
              disconnect();
            }
          },
          onmessage: async (msg: LiveServerMessage) => {
             if (msg.toolCall) {
                for (const fc of msg.toolCall.functionCalls) {
                    addLog('system', `Tool called: ${fc.name}`);
                    let result = { result: 'ok' };
                    
                    if (fc.name === 'bookMeeting') {
                        addLog('system', `📅 Meeting Booked: ${JSON.stringify(fc.args)}`);
                        showNotification(`Meeting (${fc.args.meetingType}) booked for ${fc.args.clientEmail}`, 'success');
                        result = { result: 'Meeting booked. Calendar invite sent to company and client.' };
                    } else if (fc.name === 'logOutcome') {
                        addLog('system', `📝 Tata Log: ${fc.args.outcome} - ${fc.args.sentiment}`);
                        result = { result: 'Logged to Tata Broadband' };
                    } else if (fc.name === 'transferCall') {
                        addLog('system', `📞 Transferring call: ${JSON.stringify(fc.args)}`);
                        setTransferStatus("Transferring to Senior Manager (Human)...");
                        showNotification('Call Transfer Initiated', 'alert');
                        result = { result: 'Call transferred. Agent should say goodbye now.' };
                    }

                    sessionPromiseRef.current?.then(session => {
                        session.sendToolResponse({
                            functionResponses: { id: fc.id, name: fc.name, response: { result } }
                        });
                    });
                }
             }

             const modelAudio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             if (modelAudio && outputAudioContextRef.current) {
                setAgentSpeaking(true);
                const ctx = outputAudioContextRef.current;
                const audioBytes = base64ToUint8Array(modelAudio);
                const audioBuffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
                
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                source.start(nextStartTimeRef.current);
                source.onended = () => {
                    if (ctx.currentTime >= nextStartTimeRef.current - 0.1) {
                       setAgentSpeaking(false);
                    }
                };
                nextStartTimeRef.current += audioBuffer.duration;
                audioQueueRef.current.push(source);
             }
          },
          onclose: () => {
            addLog('system', 'Connection closed.');
            setIsConnected(false);
            setAgentSpeaking(false);
            setIsConnecting(false);
            // Trigger post-call UI
            setShowPostCall(true);
          },
          onerror: (err) => {
            console.error(err);
            addLog('system', `Error: ${JSON.stringify(err)}`);
            setIsConnected(false);
            setIsConnecting(false);
            setConnectionError({ title: "Connection Error", message: "The Gemini Live API connection was lost. Please check your network." });
          }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (e: any) {
      addLog('system', `Failed to connect: ${e.message}`);
      setIsConnected(false);
      setIsConnecting(false);
      
      if (e.message === "MISSING_API_KEY") {
          setConnectionError({ title: "Configuration Error", message: "Google API Key is missing. Check your environment setup." });
      } else if (e.message.includes("403")) {
          setConnectionError({ title: "Authentication Failed", message: "Invalid API Key. Please verify your Google GenAI key in settings." });
      } else if (e.message.includes("Failed to fetch")) {
          setConnectionError({ title: "Network Error", message: "Cannot reach Google Servers. Check internet connection or CORS settings." });
      } else {
          setConnectionError({ title: "Connection Error", message: e.message || "An unexpected error occurred." });
      }
    }
  };

  const disconnect = () => {
    if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => session.close());
    }
    stopAudio();
    setIsConnected(false);
    sessionPromiseRef.current = null;
    setIsConnecting(false);
    setShowPostCall(true);
  };

  const submitManualLog = () => {
      addLog('system', `📝 Manual Log: ${manualOutcome} - ${manualSentiment}`);
      showNotification('Call Outcome Logged Successfully', 'success');
      setShowPostCall(false);
  };

  useEffect(() => {
    return () => { disconnect(); };
  }, []);

  return (
    <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden flex flex-col h-[650px] relative">
      
      {notification && (
        <div className={`absolute top-16 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-full shadow-lg flex items-center gap-2 animate-fade-in-down ${
            notification.type === 'success' ? 'bg-green-600 text-white' : 
            notification.type === 'alert' ? 'bg-orange-500 text-white' : 'bg-slate-800 text-white'
        }`}>
            {notification.type === 'success' && <CheckCircle size={18} />}
            {notification.type === 'alert' && <UserCog size={18} />}
            <span className="font-medium text-sm">{notification.message}</span>
        </div>
      )}

      <div className="p-4 bg-indigo-600 text-white flex justify-between items-center z-10">
        <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}></div>
            <div>
                <h2 className="font-semibold text-lg leading-none">Agent Priya</h2>
                <span className="text-xs text-indigo-200">Voice: {selectedVoice} | Mode: {language}</span>
            </div>
        </div>
        <button 
            onClick={() => setShowSettings(!showSettings)} 
            className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-indigo-700' : 'hover:bg-indigo-500'}`}
        >
            <Settings size={20} />
        </button>
      </div>

      {showSettings && (
         <div className="absolute top-16 left-0 right-0 bg-slate-50 border-b border-slate-200 p-6 z-20 shadow-md animate-slide-in-top">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Agent Configuration</h3>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Pitch Strategy</label>
                    <select 
                        value={strategy}
                        onChange={(e) => setStrategy(e.target.value as PitchStrategy)}
                        className="w-full text-sm bg-white border border-slate-300 rounded-md p-2"
                    >
                        <option value="BALANCED">⚖️ Balanced</option>
                        <option value="SEO_FOCUS">🔍 SEO Focus</option>
                        <option value="ADS_FOCUS">⚡ Ads Focus</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Language Mode</label>
                    <div className="flex gap-2">
                        <button onClick={() => setLanguage('ENGLISH')} className={`flex-1 text-xs py-2 rounded border ${language === 'ENGLISH' ? 'bg-indigo-100 border-indigo-500 text-indigo-700' : 'bg-white'}`}>English</button>
                        <button onClick={() => setLanguage('HINGLISH')} className={`flex-1 text-xs py-2 rounded border ${language === 'HINGLISH' ? 'bg-indigo-100 border-indigo-500 text-indigo-700' : 'bg-white'}`}>Hinglish</button>
                    </div>
                </div>
                <div className="col-span-2 mt-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Voice Selection</label>
                    <select 
                        value={selectedVoice}
                        onChange={(e) => setSelectedVoice(e.target.value)}
                        className="w-full text-sm bg-white border border-slate-300 rounded-md p-2"
                    >
                        {VOICE_OPTIONS.map(v => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                    </select>
                </div>
                <div className="col-span-2 mt-2">
                    <button 
                        onClick={() => setShowSettings(false)}
                        className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700"
                    >
                        Close Settings
                    </button>
                </div>
            </div>
         </div>
      )}

      <div className="flex-1 bg-slate-50 flex flex-col items-center justify-center relative">
        {transferStatus && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-30 flex flex-col items-center justify-center text-slate-800">
                <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mb-4 animate-bounce">
                    <UserCog size={32} />
                </div>
                <h3 className="text-xl font-bold">Transferring Call...</h3>
                <p className="text-slate-500">Connecting you to a human manager.</p>
            </div>
        )}

        {/* Post-Call Log Overlay */}
        {showPostCall && !isConnected && !connectionError && (
             <div className="absolute inset-0 z-30 bg-white/95 backdrop-blur-sm flex items-center justify-center animate-fade-in p-4">
                 <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xl max-w-sm w-full">
                     <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <ClipboardList size={20} className="text-indigo-600"/>
                        Post-Call Log
                     </h3>
                     <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Outcome</label>
                            <div className="grid grid-cols-2 gap-2">
                                {['Meeting Booked', 'Follow-up', 'Not Interested', 'Voicemail'].map(o => (
                                    <button 
                                        key={o}
                                        onClick={() => setManualOutcome(o)}
                                        className={`text-xs py-2 px-1 rounded border transition-all ${manualOutcome === o ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'}`}
                                    >
                                        {o}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Sentiment</label>
                            <div className="flex gap-2">
                                 {['Positive', 'Neutral', 'Negative'].map(s => (
                                    <button 
                                        key={s}
                                        onClick={() => setManualSentiment(s)}
                                        className={`flex-1 text-xs py-2 rounded border transition-all ${manualSentiment === s ? 
                                            (s === 'Positive' ? 'bg-green-100 border-green-500 text-green-700' : s === 'Negative' ? 'bg-red-100 border-red-500 text-red-700' : 'bg-slate-100 border-slate-500 text-slate-700') 
                                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                                    >
                                        {s}
                                    </button>
                                 ))}
                            </div>
                        </div>
                        <div className="flex gap-3 pt-4 border-t border-slate-100 mt-2">
                            <button onClick={() => setShowPostCall(false)} className="flex-1 py-2.5 text-slate-500 text-sm hover:bg-slate-100 rounded-lg flex items-center justify-center gap-2">
                                <SkipForward size={16}/> Skip
                            </button>
                            <button onClick={submitManualLog} className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 shadow-md flex items-center justify-center gap-2">
                                <Save size={16}/> Save Log
                            </button>
                        </div>
                     </div>
                 </div>
             </div>
        )}

        {connectionError ? (
             <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-sm text-center animate-fade-in shadow-sm mx-4">
                 <div className="w-14 h-14 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                     <AlertCircle size={32} />
                 </div>
                 <h3 className="text-red-900 font-bold text-lg mb-2">{connectionError.title}</h3>
                 <p className="text-red-700 text-sm mb-6 leading-relaxed">{connectionError.message}</p>
                 <button 
                    onClick={() => { setShowSettings(true); setConnectionError(null); }}
                    className="bg-white border border-red-300 text-red-700 px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-red-50 transition-colors w-full flex items-center justify-center gap-2"
                 >
                    <Wrench size={18} /> Troubleshoot in Settings
                 </button>
             </div>
        ) : (
            <>
                <div className={`relative mb-8 transition-all duration-500 ${agentSpeaking ? 'scale-110' : 'scale-100'}`}>
                    <div className={`w-32 h-32 rounded-full flex items-center justify-center shadow-xl ${isConnected ? 'bg-gradient-to-br from-indigo-500 to-purple-600 border-4 border-indigo-100' : 'bg-slate-200 border-4 border-slate-300'}`}>
                        <Activity size={48} className={isConnected ? 'text-white' : 'text-slate-400'} />
                    </div>
                    {agentSpeaking && (
                        <>
                            <div className="absolute inset-0 rounded-full border-4 border-indigo-400 opacity-50 animate-ping"></div>
                            <div className="absolute -right-12 top-0 bg-white px-3 py-1 rounded-full text-xs font-bold text-indigo-600 shadow-sm animate-bounce">
                                Speaking...
                            </div>
                        </>
                    )}
                </div>

                <div className="h-16 w-full max-w-xs mb-8">
                    <LiveAudioVisualizer isActive={isConnected} isSpeaking={agentSpeaking} />
                </div>
                
                <div className="text-center mb-6">
                    <p className="text-slate-500 font-medium">
                        {isConnected ? (agentSpeaking ? "Priya is explaining..." : "Listening to you...") : isConnecting ? "Connecting to Google AI..." : "Ready to connect"}
                    </p>
                    {isConnected && (
                        <div className="flex items-center justify-center gap-2 mt-2 text-xs text-slate-400">
                            <span className="px-2 py-0.5 bg-slate-200 rounded">{language}</span>
                            <span className="px-2 py-0.5 bg-slate-200 rounded">{selectedVoice}</span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    <button 
                        onClick={() => setIsMicOn(!isMicOn)}
                        disabled={!isConnected}
                        className={`p-4 rounded-full transition-all duration-200 shadow-md ${
                            !isConnected ? 'opacity-50 cursor-not-allowed bg-slate-200' :
                            isMicOn ? 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200' : 'bg-red-100 text-red-600 border border-red-200'
                        }`}
                        title={isMicOn ? "Mute Microphone" : "Unmute Microphone"}
                    >
                        {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
                    </button>

                    {!isConnected ? (
                        <button 
                            onClick={connectToLiveAPI}
                            disabled={isConnecting}
                            className={`flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-full font-bold shadow-lg shadow-indigo-200 transition-all active:scale-95 ${isConnecting ? 'opacity-75 cursor-not-allowed' : ''}`}
                        >
                            {isConnecting ? <RefreshCw size={24} className="animate-spin" /> : <Phone size={24} />}
                            {isConnecting ? 'Connecting...' : 'Call Agent'}
                        </button>
                    ) : (
                        <button 
                            onClick={disconnect}
                            className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-8 py-4 rounded-full font-bold shadow-lg shadow-red-200 transition-all active:scale-95"
                        >
                            <PhoneOff size={24} />
                            End Call
                        </button>
                    )}
                </div>
            </>
        )}
      </div>

      <div className="h-48 bg-slate-900 overflow-y-auto p-4 font-mono text-sm border-t border-slate-700">
        <div className="flex justify-between items-center mb-2">
            <span className="text-slate-400 text-xs uppercase tracking-wider">Live Transcript</span>
            <span className="text-slate-600 text-xs">v2.5-flash-audio</span>
        </div>
        {logs.length === 0 && <span className="text-slate-600 italic">Waiting for connection...</span>}
        {logs.map((log, idx) => (
            <div key={idx} className="mb-1.5 leading-relaxed">
                <span className={`
                    uppercase text-[10px] font-bold mr-2 px-1.5 py-0.5 rounded
                    ${log.sender === 'agent' ? 'bg-indigo-900 text-indigo-300' : log.sender === 'user' ? 'bg-green-900 text-green-300' : 'bg-slate-800 text-slate-400'}
                `}>
                    {log.sender}
                </span>
                <span className="text-slate-300">{log.text}</span>
            </div>
        ))}
        <div ref={(el) => el?.scrollIntoView({ behavior: 'smooth' })} />
      </div>
    </div>
  );
};

export default AgentController;
