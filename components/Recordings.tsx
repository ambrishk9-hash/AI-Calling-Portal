
import React, { useState, useEffect } from 'react';
import { Play, Pause, Trash2, Bookmark, BookmarkCheck, Download, Mic } from 'lucide-react';
import { Recording } from '../types';
import { API_BASE_URL } from '../constants';

const Recordings: React.FC = () => {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    fetchRecordings();
  }, []);

  const fetchRecordings = async () => {
    try {
      const cleanUrl = API_BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${cleanUrl}/api/recordings`);
      if (res.ok) {
        const data = await res.json();
        setRecordings(data);
      }
    } catch (e) {
      console.error("Failed to fetch recordings", e);
    } finally {
      setLoading(false);
    }
  };

  const deleteRecording = async (id: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this recording?")) return;
    try {
      const cleanUrl = API_BASE_URL.replace(/\/$/, '');
      await fetch(`${cleanUrl}/api/recordings/${id}`, { method: 'DELETE' });
      setRecordings(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      alert("Failed to delete recording");
    }
  };

  const toggleSave = async (id: string) => {
    try {
      const cleanUrl = API_BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${cleanUrl}/api/recordings/${id}/save`, { method: 'POST' });
      if (res.ok) {
        setRecordings(prev => prev.map(r => r.id === id ? { ...r, saved: !r.saved } : r));
      }
    } catch (e) {
      alert("Failed to update status");
    }
  };

  const handlePlay = (id: string) => {
    if (playingId === id) {
        setPlayingId(null);
        // Logic to stop audio would go here
    } else {
        setPlayingId(id);
        // Logic to play audio would go here (using r.url)
        // For simulation, we just toggle the icon
        setTimeout(() => setPlayingId(null), 5000); // Simulate 5s playback
    }
  };

  return (
    <div className="max-w-6xl mx-auto animate-fade-in p-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center">
            <Mic size={24} />
        </div>
        <div>
            <h2 className="text-2xl font-bold text-slate-900">Call Recordings</h2>
            <p className="text-slate-500">Manage, listen, and archive your call logs.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
           <div className="p-12 text-center text-slate-500">Loading recordings...</div>
        ) : recordings.length === 0 ? (
           <div className="p-12 text-center text-slate-500 flex flex-col items-center gap-2">
               <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 mb-2"><Mic size={32}/></div>
               No recordings found. Enable "Record Call" when dialing.
           </div>
        ) : (
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-semibold">
                <tr>
                    <th className="px-6 py-4">Client Name</th>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4">Date & Time</th>
                    <th className="px-6 py-4">Duration</th>
                    <th className="px-6 py-4 text-center">Actions</th>
                </tr>
            </thead>
            <tbody>
                {recordings.map(rec => (
                    <tr key={rec.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 font-medium text-slate-900">{rec.leadName}</td>
                        <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded-md text-xs font-bold ${rec.type === 'Incoming' ? 'bg-indigo-50 text-indigo-600' : 'bg-green-50 text-green-600'}`}>
                                {rec.type}
                            </span>
                        </td>
                        <td className="px-6 py-4">{new Date(rec.timestamp).toLocaleString()}</td>
                        <td className="px-6 py-4 font-mono">{Math.floor(rec.duration / 60)}:{(rec.duration % 60).toString().padStart(2, '0')}</td>
                        <td className="px-6 py-4">
                            <div className="flex items-center justify-center gap-2">
                                <button 
                                    onClick={() => handlePlay(rec.id)}
                                    className={`p-2 rounded-full transition-colors ${playingId === rec.id ? 'bg-indigo-600 text-white' : 'hover:bg-indigo-50 text-indigo-600'}`}
                                    title="Play"
                                >
                                    {playingId === rec.id ? <Pause size={16} /> : <Play size={16} />}
                                </button>
                                
                                <button 
                                    onClick={() => toggleSave(rec.id)}
                                    className={`p-2 rounded-full transition-colors ${rec.saved ? 'text-amber-500 bg-amber-50' : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50'}`}
                                    title={rec.saved ? "Unsave" : "Save"}
                                >
                                    {rec.saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                                </button>

                                <button className="p-2 rounded-full text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors" title="Download">
                                    <Download size={16} />
                                </button>

                                <button 
                                    onClick={() => deleteRecording(rec.id)}
                                    className="p-2 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" 
                                    title="Delete"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </td>
                    </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Recordings;
