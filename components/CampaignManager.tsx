
import React, { useState, useRef } from 'react';
import { Upload, Calendar, Clock, ArrowRight, CheckCircle, FileText, AlertCircle, Plus } from 'lucide-react';
import { Lead } from '../types';
import { API_BASE_URL } from '../constants';

interface CampaignManagerProps {
    onAddLeads?: (leads: Partial<Lead>[]) => void;
}

const CampaignManager: React.FC<CampaignManagerProps> = ({ onAddLeads }) => {
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [parsedLeads, setParsedLeads] = useState<Partial<Lead>[]>([]);
    const [startTime, setStartTime] = useState('');
    const [status, setStatus] = useState<'idle' | 'scheduling' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setUploadedFile(file);
            const reader = new FileReader();
            reader.onload = (evt) => {
                const text = evt.target?.result as string;
                const lines = text.split('\n');
                // Name,Phone,Email,Business
                const leads = lines.slice(1).map(line => {
                    const parts = line.split(',');
                    if (parts.length < 2) return null;
                    return { 
                        name: parts[0]?.trim(), 
                        phone: parts[1]?.trim(), 
                        email: parts[2]?.trim(),
                        businessName: parts[3]?.trim() 
                    };
                }).filter(l => l && l.phone);
                setParsedLeads(leads as Partial<Lead>[]);
            };
            reader.readAsText(file);
        }
    };

    const importToDashboard = () => {
        if (onAddLeads && parsedLeads.length > 0) {
            onAddLeads(parsedLeads);
            setParsedLeads([]);
            setUploadedFile(null);
            setMessage("Leads imported to Dashboard successfully.");
            setStatus('success');
            setTimeout(() => setStatus('idle'), 3000);
        }
    };

    const scheduleCampaign = async () => {
        if (parsedLeads.length === 0) return;
        setStatus('scheduling');
        setMessage('Sending to backend scheduler...');

        try {
            const response = await fetch(`${API_BASE_URL}/api/campaign/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    leads: parsedLeads,
                    startTime: startTime || new Date().toISOString()
                }),
            });
            const data = await response.json();
            if (response.ok) {
                setStatus('success');
                setMessage(data.message);
                // Optionally import locally too so the user sees them
                if (onAddLeads) onAddLeads(parsedLeads);
            } else {
                throw new Error(data.error);
            }
        } catch (err: any) {
            setStatus('error');
            setMessage(err.message);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900">Campaign Scheduler</h2>
                    <p className="text-slate-500">Automated calling with smart interval algorithm (10 mins).</p>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Step 1: Upload */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">1</span>
                            Upload Leads (CSV)
                        </h3>
                        <div 
                            onClick={() => fileInputRef.current?.click()}
                            className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-slate-300 rounded-lg bg-slate-50 hover:bg-indigo-50 hover:border-indigo-300 transition-all cursor-pointer group"
                        >
                            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" className="hidden" />
                            <div className="p-4 bg-white rounded-full shadow-sm group-hover:scale-110 transition-transform mb-3">
                                {uploadedFile ? <FileText className="h-8 w-8 text-indigo-500" /> : <Upload className="h-8 w-8 text-indigo-500" />}
                            </div>
                            <p className="text-sm text-slate-700 font-medium">{uploadedFile ? uploadedFile.name : 'Click to Upload .CSV'}</p>
                            <p className="text-xs text-slate-400 mt-1">Format: Name, Phone, Email, Business</p>
                        </div>
                    </div>

                    {/* Step 2: Configure */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">2</span>
                            Configuration
                        </h3>
                        
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Campaign Start Time</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Calendar className="h-4 w-4 text-slate-400" />
                                </div>
                                <input 
                                    type="datetime-local" 
                                    value={startTime}
                                    onChange={(e) => setStartTime(e.target.value)}
                                    className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 p-2.5" 
                                />
                            </div>
                        </div>

                        <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                            <p className="text-xs text-indigo-800 font-medium mb-1">Scheduling Algorithm:</p>
                            <p className="text-xs text-indigo-600 flex items-center gap-1">
                                <Clock size={12} />
                                Calls are spaced <strong>10 minutes</strong> apart to ensure agent availability.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Preview & Action */}
                {parsedLeads.length > 0 && (
                    <div className="mt-8 pt-8 border-t border-slate-100">
                        <div className="flex justify-between items-center mb-4">
                             <h4 className="font-semibold text-slate-700 text-sm">Leads Preview ({parsedLeads.length})</h4>
                        </div>
                        <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden max-h-40 overflow-y-auto mb-6">
                            <table className="w-full text-left text-xs text-slate-600">
                                <thead className="bg-slate-100 uppercase font-semibold text-slate-500">
                                    <tr>
                                        <th className="px-4 py-2">Name</th>
                                        <th className="px-4 py-2">Phone</th>
                                        <th className="px-4 py-2">Email</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {parsedLeads.map((l, i) => (
                                        <tr key={i} className="border-b border-slate-100">
                                            <td className="px-4 py-2">{l.name}</td>
                                            <td className="px-4 py-2 font-mono">{l.phone}</td>
                                            <td className="px-4 py-2">{l.email || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {status === 'success' && (
                            <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm rounded-lg flex items-center gap-2">
                                <CheckCircle size={16} /> {message}
                            </div>
                        )}
                        {status === 'error' && (
                            <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-center gap-2">
                                <AlertCircle size={16} /> {message}
                            </div>
                        )}

                        <div className="flex gap-4">
                            <button 
                                onClick={importToDashboard}
                                className="flex-1 py-3 px-4 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 flex items-center justify-center gap-2 transition-colors"
                            >
                                <Plus size={18} />
                                Only Import Leads
                            </button>
                            <button 
                                onClick={scheduleCampaign}
                                disabled={status === 'scheduling'}
                                className="flex-1 py-3 px-4 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                            >
                                {status === 'scheduling' ? 'Scheduling...' : 'Launch Campaign'}
                                <ArrowRight size={18} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CampaignManager;
