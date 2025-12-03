
import React, { useState, useEffect, useRef } from 'react';
import { Terminal, RefreshCw, AlertCircle, CheckCircle, Info, ArrowUpRight, ArrowDownLeft, Trash2 } from 'lucide-react';
import { API_BASE_URL } from '../constants';
import { SystemLog } from '../types';

const SystemLogs: React.FC = () => {
    const [logs, setLogs] = useState<SystemLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const fetchLogs = async () => {
        try {
            setLoading(true);
            const cleanUrl = API_BASE_URL.replace(/\/$/, '');
            const res = await fetch(`${cleanUrl}/api/system-logs`);
            if (res.ok) {
                const data = await res.json();
                setLogs(data);
            }
        } catch (e) {
            console.error("Failed to fetch logs", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
        if (autoRefresh) {
            intervalRef.current = setInterval(fetchLogs, 2000);
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [autoRefresh]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    const clearLogs = async () => {
         try {
            const cleanUrl = API_BASE_URL.replace(/\/$/, '');
            await fetch(`${cleanUrl}/api/system-logs`, { method: 'DELETE' });
            setLogs([]);
        } catch (e) { console.error(e); }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'ERROR': return <AlertCircle size={16} className="text-red-500" />;
            case 'SUCCESS': return <CheckCircle size={16} className="text-green-500" />;
            case 'API_REQ': return <ArrowUpRight size={16} className="text-blue-500" />;
            case 'API_RES': return <ArrowDownLeft size={16} className="text-purple-500" />;
            case 'WEBHOOK': return <Terminal size={16} className="text-orange-500" />;
            default: return <Info size={16} className="text-slate-400" />;
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-4 animate-fade-in h-[calc(100vh-80px)] flex flex-col">
            <div className="flex justify-between items-center mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Terminal className="text-slate-700" /> System Debug Logs
                    </h2>
                    <p className="text-slate-500 text-sm">Real-time view of API calls, Auth, and Webhooks.</p>
                </div>
                <div className="flex gap-2">
                     <button 
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={`px-3 py-1.5 rounded text-sm font-medium border flex items-center gap-2 ${autoRefresh ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-slate-600'}`}
                     >
                        <RefreshCw size={14} className={autoRefresh ? 'animate-spin' : ''} /> {autoRefresh ? 'Live' : 'Paused'}
                     </button>
                     <button 
                        onClick={clearLogs}
                        className="px-3 py-1.5 rounded text-sm font-medium border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 flex items-center gap-2"
                     >
                        <Trash2 size={14} /> Clear
                     </button>
                </div>
            </div>

            <div className="flex-1 bg-slate-900 rounded-xl overflow-hidden shadow-lg border border-slate-700 flex flex-col">
                <div className="bg-slate-800 px-4 py-2 border-b border-slate-700 flex justify-between text-xs text-slate-400 font-mono">
                    <span>Console Output</span>
                    <span>{logs.length} events</span>
                </div>
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-sm">
                    {logs.length === 0 && (
                        <div className="text-slate-500 text-center mt-10 italic">No logs generated yet. Try making a call.</div>
                    )}
                    {logs.map((log) => (
                        <div key={log.id} className="group hover:bg-slate-800 p-2 rounded transition-colors">
                            <div className="flex items-start gap-3">
                                <span className="text-slate-500 text-xs w-20 shrink-0 pt-0.5">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                <div className="mt-0.5">{getIcon(log.type)}</div>
                                <div className="flex-1 break-words">
                                    <span className={`font-bold ${
                                        log.type === 'ERROR' ? 'text-red-400' : 
                                        log.type === 'SUCCESS' ? 'text-green-400' :
                                        log.type === 'API_REQ' ? 'text-blue-300' :
                                        log.type === 'API_RES' ? 'text-purple-300' :
                                        'text-slate-300'
                                    }`}>
                                        {log.message}
                                    </span>
                                    {log.details && (
                                        <pre className="mt-2 text-xs bg-black/30 p-2 rounded text-slate-400 overflow-x-auto border border-slate-700">
                                            {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                                        </pre>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default SystemLogs;
