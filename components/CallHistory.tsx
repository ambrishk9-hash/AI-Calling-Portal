
import React, { useState, useEffect } from 'react';
import { History, Search, RefreshCw, Smile, Meh, Frown, WifiOff } from 'lucide-react';
import { CallLog } from '../types';
import { API_BASE_URL } from '../constants';

const CallHistory: React.FC = () => {
    const [history, setHistory] = useState<CallLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');

    const fetchHistory = async () => {
        setLoading(true);
        setError(null);
        try {
            const cleanUrl = API_BASE_URL.replace(/\/$/, '');
            const res = await fetch(`${cleanUrl}/api/history`);
            if (res.ok) {
                const data = await res.json();
                setHistory(data);
            } else {
                throw new Error("Failed to fetch history");
            }
        } catch (e) {
            console.warn("Failed to fetch history, using mock data");
            setHistory([
                { id: 'mock-1', leadName: 'Dr. Amit Patel', duration: 145, outcome: 'Meeting Booked', sentiment: 'Positive', timestamp: new Date(Date.now() - 3600000).toISOString(), notes: 'Interested in Silver Package' },
                { id: 'mock-2', leadName: 'Rohan Verma', duration: 32, outcome: 'Not Interested', sentiment: 'Negative', timestamp: new Date(Date.now() - 7200000).toISOString(), notes: 'Hung up immediately' }
            ]);
            setError("Backend Offline - Showing Cached Data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHistory();
    }, []);

    const filteredHistory = history.filter(h => 
        h.leadName.toLowerCase().includes(filter.toLowerCase()) || 
        h.outcome.toLowerCase().includes(filter.toLowerCase()) ||
        (h.notes && h.notes.toLowerCase().includes(filter.toLowerCase()))
    );

    return (
        <div className="max-w-6xl mx-auto p-4 animate-fade-in">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <History className="text-indigo-600" /> Call History
                    </h2>
                    <p className="text-slate-500">Full log of all incoming and outgoing calls.</p>
                </div>
                <button onClick={fetchHistory} className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
                    <RefreshCw size={20} className={loading ? 'animate-spin text-indigo-600' : 'text-slate-500'} />
                </button>
            </div>

            {error && (
                <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg flex items-center gap-2">
                    <WifiOff size={18} />
                    <span>{error}</span>
                    <button onClick={fetchHistory} className="ml-auto font-bold hover:underline">Retry</button>
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex gap-4">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
                        <input 
                            type="text" 
                            placeholder="Search by name, status, or notes..." 
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-600">
                        <thead className="bg-slate-100 text-xs uppercase text-slate-500 font-semibold">
                            <tr>
                                <th className="px-6 py-4">Client</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Duration</th>
                                <th className="px-6 py-4">Sentiment</th>
                                <th className="px-6 py-4">Notes</th>
                                <th className="px-6 py-4">Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredHistory.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-8 text-center text-slate-400 italic">
                                        {loading ? "Loading..." : "No call records found."}
                                    </td>
                                </tr>
                            ) : (
                                filteredHistory.map((call) => (
                                    <tr key={call.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="font-bold text-slate-900">{call.leadName}</div>
                                            <div className="text-xs text-slate-400 font-mono">ID: {call.id.slice(0,8)}...</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded-md text-xs font-bold ${
                                                call.outcome === 'Meeting Booked' ? 'bg-green-100 text-green-700' :
                                                call.outcome === 'Not Interested' ? 'bg-red-50 text-red-600' :
                                                call.outcome === 'Voicemail' ? 'bg-amber-50 text-amber-600' :
                                                'bg-slate-100 text-slate-600'
                                            }`}>
                                                {call.outcome}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 font-mono">
                                            {Math.floor(call.duration / 60)}m {call.duration % 60}s
                                        </td>
                                        <td className="px-6 py-4">
                                             <div className="flex items-center gap-1.5">
                                                {call.sentiment === 'Positive' && <Smile size={16} className="text-green-500" />}
                                                {call.sentiment === 'Negative' && <Frown size={16} className="text-red-500" />}
                                                {call.sentiment === 'Neutral' && <Meh size={16} className="text-slate-400" />}
                                                <span>{call.sentiment}</span>
                                             </div>
                                        </td>
                                        <td className="px-6 py-4 max-w-xs truncate text-slate-500" title={call.notes}>
                                            {call.notes || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-xs text-slate-400">
                                            {new Date(call.timestamp).toLocaleString()}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default CallHistory;
