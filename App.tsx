
import React, { useState, useEffect, useRef } from 'react';
import { LayoutDashboard, Phone, Users, Settings, LogOut, Menu, Edit, Save, X, PlusCircle, CalendarClock, PhoneOutgoing, AlertTriangle, RefreshCw, Smile, Meh, Frown, Mic, Terminal, History, WifiOff } from 'lucide-react';
import AgentController from './components/AgentController';
import DashboardStats from './components/DashboardStats';
import Dialer from './components/Dialer';
import CampaignManager from './components/CampaignManager';
import CallNow from './components/CallNow';
import Recordings from './components/Recordings';
import SystemLogs from './components/SystemLogs';
import CallHistory from './components/CallHistory'; 
import { MOCK_LEADS, API_BASE_URL } from './constants';
import { Lead } from './types';

function App() {
  const [activeView, setActiveView] = useState<'dashboard' | 'agent' | 'leads' | 'campaign' | 'call-now' | 'recordings' | 'logs' | 'history'>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Leads Management State
  const [leads, setLeads] = useState<Lead[]>(MOCK_LEADS as Lead[]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Lead>>({});
  
  // Recent Calls State
  const [recentCalls, setRecentCalls] = useState<any[]>([]);
  const [callsError, setCallsError] = useState(false);
  const callsIntervalRef = useRef<number | null>(null);

  const fetchRecentCalls = async () => {
    try {
        const cleanUrl = API_BASE_URL.replace(/\/$/, '');
        const res = await fetch(`${cleanUrl}/api/stats`);
        if (res.ok) {
            const data = await res.json();
            setRecentCalls(data.recentCalls || []);
            setCallsError(false);
        } else {
            throw new Error("API Error");
        }
    } catch (e) {
        // Fallback to empty/mock if offline so UI doesn't break
        setCallsError(true);
    }
  };

  const startCallsPolling = () => {
      fetchRecentCalls();
      if (callsIntervalRef.current) clearInterval(callsIntervalRef.current);
      callsIntervalRef.current = window.setInterval(fetchRecentCalls, 10000);
  };

  useEffect(() => {
    if (activeView === 'dashboard') {
        startCallsPolling();
    }
    return () => {
        if (callsIntervalRef.current) clearInterval(callsIntervalRef.current);
    };
  }, [activeView]);

  const addLeads = (newLeads: Partial<Lead>[]) => {
    const formattedLeads: Lead[] = newLeads.map((l, index) => ({
      id: `csv-${Date.now()}-${index}`,
      name: l.name || 'Unknown',
      businessName: l.businessName || 'N/A',
      phone: l.phone || '',
      email: l.email || '',
      source: 'CSV',
      status: 'Pending',
      notes: ''
    }));
    
    setLeads(prev => [...formattedLeads, ...prev]);
    if (activeView !== 'campaign') {
        alert(`${formattedLeads.length} leads imported successfully!`);
    }
  };

  const startEdit = (lead: Lead) => {
      setEditingId(lead.id);
      setEditForm(lead);
  };

  const cancelEdit = () => {
      setEditingId(null);
      setEditForm({});
  };

  const saveEdit = () => {
      if (editingId) {
          setLeads(prev => prev.map(l => l.id === editingId ? { ...l, ...editForm } as Lead : l));
          setEditingId(null);
          setEditForm({});
      }
  };

  const NavItem = ({ view, icon: Icon, label }: { view: string, icon: any, label: string }) => (
    <button
      onClick={() => {
        setActiveView(view as any);
        setMobileMenuOpen(false);
      }}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
        activeView === view 
          ? 'bg-indigo-50 text-indigo-600 font-semibold' 
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <Icon size={20} />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0
      `}>
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">S</div>
            <div>
                <h1 className="font-bold text-slate-900 leading-tight">SKDM</h1>
                <p className="text-xs text-slate-500">Agent Builder</p>
            </div>
          </div>
        </div>
        <nav className="p-4 space-y-1">
          <NavItem view="dashboard" icon={LayoutDashboard} label="Dashboard" />
          <NavItem view="call-now" icon={PhoneOutgoing} label="Call Now" />
          <NavItem view="history" icon={History} label="Call History" />
          <NavItem view="recordings" icon={Mic} label="Recordings" />
          <NavItem view="campaign" icon={CalendarClock} label="Campaign Scheduler" />
          <NavItem view="agent" icon={Phone} label="Live Agent Simulator" />
          <NavItem view="leads" icon={Users} label="Lead Management" />
          <NavItem view="logs" icon={Terminal} label="System Logs" />
        </nav>
        <div className="absolute bottom-0 w-full p-4 border-t border-slate-100">
          <button className="w-full flex items-center gap-3 px-4 py-3 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <LogOut size={20} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="md:hidden bg-white p-4 border-b border-slate-200 flex justify-between items-center sticky top-0 z-40">
           <div className="font-bold text-indigo-900">SKDM Agent</div>
           <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 bg-slate-100 rounded">
             <Menu size={20} />
           </button>
        </div>

        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          {activeView === 'dashboard' && (
            <div className="animate-fade-in">
              <div className="flex justify-between items-end mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Overview</h2>
                  <p className="text-slate-500">Live Campaign Performance</p>
                </div>
                <button onClick={() => setActiveView('call-now')} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors flex items-center gap-2">
                    <PhoneOutgoing size={18} /> Call Now
                </button>
              </div>
              
              {callsError && (
                 <div className="mb-6 bg-amber-50 text-amber-700 px-4 py-3 rounded-lg flex items-center gap-2 text-sm border border-amber-200">
                     <WifiOff size={16}/> Backend unreachable. Recent calls may be outdated.
                 </div>
              )}

              <DashboardStats />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
                 <div className="lg:col-span-2">
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="font-bold text-slate-800">Recent Calls (Live)</h3>
                            <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded">Auto-updating</span>
                        </div>
                        <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-600">
                            <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-semibold">
                                <tr>
                                    <th className="px-6 py-3">Lead / ID</th>
                                    <th className="px-6 py-3">Duration</th>
                                    <th className="px-6 py-3">Status</th>
                                    <th className="px-6 py-3">Sentiment</th>
                                    <th className="px-6 py-3">Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentCalls.length === 0 ? (
                                    <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">No calls recorded yet.</td></tr>
                                ) : (
                                    recentCalls.map((call: any, i) => (
                                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                                            <td className="px-6 py-4 font-medium text-slate-900">{call.leadName || call.id}</td>
                                            <td className="px-6 py-4">{call.duration ? `${Math.floor(call.duration/60)}m ${call.duration%60}s` : '-'}</td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${
                                                    call.outcome === 'Meeting Booked' ? 'bg-green-100 text-green-700' :
                                                    call.outcome === 'Not Interested' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-700'
                                                }`}>
                                                    {call.outcome}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold w-fit ${
                                                    call.sentiment === 'Positive' ? 'bg-emerald-50 text-emerald-600' :
                                                    call.sentiment === 'Negative' ? 'bg-rose-50 text-rose-600' : 
                                                    'bg-gray-50 text-gray-600'
                                                }`}>
                                                    {call.sentiment === 'Positive' && <Smile size={14} />}
                                                    {call.sentiment === 'Negative' && <Frown size={14} />}
                                                    {(!call.sentiment || call.sentiment === 'Neutral') && <Meh size={14} />}
                                                    {call.sentiment || 'Neutral'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-slate-400">{new Date(call.timestamp).toLocaleTimeString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                        </div>
                    </div>
                 </div>
                 <div><Dialer onAddLeads={addLeads} /></div>
              </div>
            </div>
          )}

          {activeView === 'call-now' && (
              <CallNow />
          )}

          {activeView === 'recordings' && (
              <Recordings />
          )}
          
          {activeView === 'history' && (
              <CallHistory />
          )}

          {activeView === 'logs' && (
              <SystemLogs />
          )}

          {activeView === 'campaign' && (
              <CampaignManager onAddLeads={addLeads} />
          )}

          {activeView === 'agent' && (
            <div className="animate-fade-in max-w-4xl mx-auto">
                <div className="mb-6">
                    <h2 className="text-2xl font-bold text-slate-900">Live Agent Simulator</h2>
                    <p className="text-slate-500">Test the "Priya" persona. Configure Voice & Strategy below.</p>
                </div>
                <AgentController />
            </div>
          )}

          {activeView === 'leads' && (
             <div className="animate-fade-in">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-slate-900">Lead Management</h2>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full text-left text-sm text-slate-600">
                        <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-semibold">
                            <tr>
                                <th className="px-6 py-4">Name</th>
                                <th className="px-6 py-4">Business</th>
                                <th className="px-6 py-4">Phone</th>
                                <th className="px-6 py-4">Email</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {leads.map(lead => (
                                <tr key={lead.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                    {editingId === lead.id ? (
                                        <>
                                            <td className="px-6 py-4"><input className="border border-indigo-300 rounded p-1 w-full focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Name" value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} /></td>
                                            <td className="px-6 py-4"><input className="border border-indigo-300 rounded p-1 w-full focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Business" value={editForm.businessName} onChange={e => setEditForm({...editForm, businessName: e.target.value})} /></td>
                                            <td className="px-6 py-4"><input className="border border-indigo-300 rounded p-1 w-full focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Phone" value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} /></td>
                                            <td className="px-6 py-4"><input className="border border-indigo-300 rounded p-1 w-full focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Email" value={editForm.email || ''} onChange={e => setEditForm({...editForm, email: e.target.value})} /></td>
                                            <td className="px-6 py-4">
                                                <select className="border border-indigo-300 rounded p-1 w-full focus:ring-2 focus:ring-indigo-500 outline-none" value={editForm.status} onChange={e => setEditForm({...editForm, status: e.target.value as any})}>
                                                    <option>Pending</option><option>Called</option><option>Converted</option><option>Rejected</option>
                                                </select>
                                            </td>
                                            <td className="px-6 py-4 text-right flex justify-end gap-2">
                                                <button onClick={saveEdit} className="text-green-600 hover:bg-green-100 p-2 rounded transition-colors"><Save size={18}/></button>
                                                <button onClick={cancelEdit} className="text-red-600 hover:bg-red-100 p-2 rounded transition-colors"><X size={18}/></button>
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="px-6 py-4 font-medium text-slate-900">{lead.name}</td>
                                            <td className="px-6 py-4">{lead.businessName}</td>
                                            <td className="px-6 py-4 font-mono">{lead.phone}</td>
                                            <td className="px-6 py-4 text-slate-500">{lead.email || '-'}</td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 rounded text-xs font-bold border ${
                                                    lead.status === 'Converted' ? 'bg-green-100 text-green-700 border-green-200' :
                                                    lead.status === 'Pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 
                                                    lead.status === 'Rejected' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-100 text-slate-700 border-slate-200'
                                                }`}>{lead.status}</span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button onClick={() => startEdit(lead)} className="text-indigo-600 hover:text-indigo-900 font-medium hover:bg-indigo-50 px-3 py-1 rounded transition-colors flex items-center gap-1 justify-end w-full">
                                                    <Edit size={16} /> Edit
                                                </button>
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {leads.length === 0 && (
                        <div className="p-8 text-center text-slate-500">
                            No leads found. Go to Campaign Scheduler to upload a CSV.
                        </div>
                    )}
                </div>
             </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
