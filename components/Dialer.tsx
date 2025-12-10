
import React, { useState, useRef } from 'react';
import { Upload, Phone, Loader2, AlertCircle, CheckCircle, Calendar, FileText, Clock, Plus, ArrowRight } from 'lucide-react';
import { Lead } from '../types';
import { API_BASE_URL } from '../constants';

interface DialerProps {
    onAddLeads?: (leads: Partial<Lead>[]) => void;
}

const Dialer: React.FC<DialerProps> = ({ onAddLeads }) => {
  const [activeTab, setActiveTab] = useState<'manual' | 'csv' | 'campaign'>('manual');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'idle' | 'calling' | 'connected' | 'error' | 'scheduled'>('idle');
  const [message, setMessage] = useState('');
  
  // CSV / Campaign State
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedLeads, setParsedLeads] = useState<Partial<Lead>[]>([]);
  const [startTime, setStartTime] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;

    setStatus('calling');
    setMessage('Connecting to Tataflow Network...');

    try {
      const response = await fetch(`${API_BASE_URL}/api/dial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name: name || 'Valued Customer', campaign: 'Manual' }),
      });

      let data;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error(`Server returned invalid response (${response.status})`);
      }

      if (response.ok) {
        setStatus('connected');
        setMessage(`Success! Call queued. ID: ${data.callId}`);
        setTimeout(() => { setStatus('idle'); setMessage(''); }, 5000);
      } else {
        throw new Error(data.error || 'Failed to connect');
      }
    } catch (err: any) {
      setStatus('error');
      setMessage(`Error: ${err.message}. Check backend.`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      // Robust CSV Parse
      const reader = new FileReader();
      reader.onload = (evt) => {
          const text = evt.target?.result as string;
          const lines = text.split('\n');
          // Expect CSV: Name,Phone,Email,Business
          const leads = lines.slice(1).map(line => {
              const parts = line.split(',');
              if (parts.length < 2) return null; // Skip empty/invalid lines
              return { 
                  name: parts[0]?.trim(), 
                  phone: parts[1]?.trim(), 
                  email: parts[2]?.trim(),
                  businessName: parts[3]?.trim() 
              };
          }).filter(l => l && l.phone); // Basic filter for valid phone
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
      }
  };

  const scheduleCampaign = async () => {
    if (parsedLeads.length === 0) return;
    setStatus('calling');
    setMessage('Scheduling Smart Campaign...');

    try {
        const response = await fetch(`${API_BASE_URL}/api/campaign/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                leads: parsedLeads,
                startTime: startTime || new Date().toISOString()
            }),
        });

        let data;
        try {
            data = await response.json();
        } catch(e) {
            throw new Error(`Invalid server response (${response.status})`);
        }

        if(response.ok) {
            setStatus('scheduled');
            setMessage(data.message);
            // Also add to local dashboard for tracking
            if (onAddLeads) onAddLeads(parsedLeads);
        } else {
            throw new Error(data.error || "Schedule failed");
        }
    } catch (err: any) {
        setStatus('error');
        setMessage(err.message);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 h-full flex flex-col">
      <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
        <Phone className="text-indigo-600" size={24} />
        Live Dialer (Tataflow)
      </h3>
      
      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6">
        <button onClick={() => setActiveTab('manual')} className={`pb-2 px-4 text-sm font-medium transition-colors ${activeTab === 'manual' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Manual</button>
        <button onClick={() => setActiveTab('campaign')} className={`pb-2 px-4 text-sm font-medium transition-colors ${activeTab === 'campaign' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Bulk / Campaign</button>
      </div>

      <div className="flex-1">
        {activeTab === 'manual' && (
          <form onSubmit={handleCall} className="space-y-4">
             <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Prospect Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Sharma" className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg block w-full p-2.5 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
              <div className="flex gap-2">
                <select className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg p-2.5 w-24"><option>+91</option><option>+1</option></select>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" required className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg block w-full p-2.5 focus:ring-indigo-500 focus:border-indigo-500" />
              </div>
            </div>

            {status === 'error' && <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-center gap-2"><AlertCircle size={16} />{message}</div>}
            {status === 'connected' && <div className="p-3 bg-green-50 text-green-700 text-sm rounded-lg flex items-center gap-2"><CheckCircle size={16} />{message}</div>}

            <button type="submit" disabled={status === 'calling' || !phone} className={`w-full font-medium rounded-lg text-sm px-5 py-3 text-center inline-flex items-center justify-center gap-2 transition-all shadow-md ${status === 'calling' ? 'bg-indigo-400 cursor-not-allowed text-white' : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-lg text-white'}`}>
              {status === 'calling' ? <Loader2 className="animate-spin" size={20} /> : <Phone size={20} />}
              {status === 'calling' ? 'Connecting...' : 'Initiate Call'}
            </button>
          </form>
        )}

        {activeTab === 'campaign' && (
          <div className="space-y-4">
            <div 
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-slate-300 rounded-lg bg-slate-50 hover:bg-indigo-50 hover:border-indigo-300 transition-all cursor-pointer group"
            >
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" className="hidden" />
                <div className="p-3 bg-white rounded-full shadow-sm group-hover:scale-110 transition-transform mb-2">
                    {uploadedFile ? <FileText className="h-6 w-6 text-indigo-500" /> : <Upload className="h-6 w-6 text-indigo-500" />}
                </div>
                <p className="text-sm text-slate-700 font-medium">{uploadedFile ? uploadedFile.name : 'Click to Upload .CSV'}</p>
                <p className="text-xs text-slate-400">Name, Phone, Email, Business</p>
            </div>

            {parsedLeads.length > 0 && (
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-slate-600 uppercase">Leads Preview</span>
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{parsedLeads.length} Leads</span>
                    </div>
                    <div className="max-h-24 overflow-y-auto text-xs text-slate-500 space-y-1">
                        {parsedLeads.map((l, i) => (
                            <div key={i} className="flex justify-between">
                                <span>{l.name}</span>
                                <span className="font-mono">{l.phone}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div>
                 <label className="block text-sm font-medium text-slate-700 mb-1">Start Date & Time</label>
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
                 <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                     <Clock size={12} /> Algo: Calls spaced 10 mins apart.
                 </p>
            </div>

            {status === 'scheduled' && <div className="p-3 bg-green-50 text-green-700 text-sm rounded-lg flex items-center gap-2"><CheckCircle size={16} />{message}</div>}

            <div className="grid grid-cols-2 gap-2">
                <button 
                    onClick={importToDashboard}
                    disabled={parsedLeads.length === 0}
                    className="w-full font-medium rounded-lg text-sm px-4 py-3 text-center inline-flex items-center justify-center gap-2 transition-all bg-white border border-indigo-600 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                   <Plus size={18} /> Import Leads
                </button>
                <button 
                    onClick={scheduleCampaign}
                    disabled={parsedLeads.length === 0}
                    className={`w-full font-medium rounded-lg text-sm px-4 py-3 text-center inline-flex items-center justify-center gap-2 transition-all shadow-md ${parsedLeads.length === 0 ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
                >
                   Schedule <ArrowRight size={18} />
                </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dialer;
