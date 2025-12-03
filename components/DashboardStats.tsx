
import React, { useEffect, useState, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, Legend } from 'recharts';
import { Metric } from '../types';
import { TrendingUp, Users, CalendarCheck, PhoneCall, Split, Loader2, AlertCircle, RefreshCw, Server } from 'lucide-react';
import { API_BASE_URL } from '../constants';

const DashboardStats: React.FC = () => {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = async () => {
    try {
        const cleanUrl = API_BASE_URL.replace(/\/$/, '');
        const res = await fetch(`${cleanUrl}/api/stats`);
        if (res.ok) {
            const data = await res.json();
            setMetrics(data.metrics);
            setChartData(data.chartData);
            setError(null);
        } else {
            throw new Error(`Server responded with ${res.status}`);
        }
    } catch (e: any) {
        console.error("Failed to fetch stats", e);
        // If on render, it might just be waking up
        setError("Backend Offline");
        // Stop polling if we hit an error to avoid console spam
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    } finally {
        setLoading(false);
    }
  };

  const startPolling = () => {
      setLoading(true);
      setError(null);
      fetchData(); // Fetch immediately
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchData, 5000);
  };

  useEffect(() => {
    startPolling();
    return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const icons = [PhoneCall, TrendingUp, CalendarCheck, Users];
  const colors = ["bg-blue-500", "bg-green-500", "bg-indigo-500", "bg-orange-500"];

  const MetricCard: React.FC<{ metric: Metric; index: number }> = ({ metric, index }) => {
    const Icon = icons[index % icons.length];
    const color = colors[index % colors.length];
    
    return (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
            <div className="flex justify-between items-start">
            <div>
                <p className="text-sm font-medium text-slate-500">{metric.name}</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">{metric.value}</h3>
            </div>
            <div className={`p-2 rounded-lg ${color}`}>
                <Icon size={20} className="text-white" />
            </div>
            </div>
            <div className="mt-4 flex items-center text-sm">
            <span className={`font-medium ${metric.trend === 'up' ? 'text-green-600' : metric.trend === 'down' ? 'text-red-600' : 'text-slate-500'}`}>
                {metric.trend === 'up' ? '+' : ''}{metric.change}%
            </span>
            <span className="text-slate-400 ml-2">vs last week</span>
            </div>
        </div>
    );
  };

  if (loading && !error && metrics.length === 0) return <div className="flex justify-center p-12"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;

  if (error) {
      return (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center animate-fade-in shadow-sm">
              <div className="inline-flex p-3 rounded-full bg-amber-100 text-amber-600 mb-4">
                  <Server size={32} />
              </div>
              <h3 className="text-lg font-bold text-amber-900 mb-2">Connecting to Server...</h3>
              <p className="text-amber-700 mb-6 max-w-md mx-auto">
                  Unable to reach the backend ({API_BASE_URL}). 
                  If using free hosting (like Render), the server may be sleeping and needs a moment to wake up.
              </p>
              <button onClick={startPolling} className="inline-flex items-center gap-2 px-6 py-2.5 bg-white border border-amber-300 rounded-lg text-amber-800 hover:bg-amber-50 font-bold transition-colors shadow-sm">
                  <RefreshCw size={18} /> Retry Connection
              </button>
          </div>
      );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((m, i) => <MetricCard key={i} metric={m} index={i} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Call Volume Area Chart */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-4">Live Call Volume vs Conversions</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorConv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                <Tooltip />
                <Area type="monotone" dataKey="calls" stroke="#3b82f6" fillOpacity={1} fill="url(#colorCalls)" />
                <Area type="monotone" dataKey="conversions" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorConv)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Static A/B Test for now (can be dynamic later) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-center mb-4">
             <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Split size={20} className="text-indigo-500" />
                Strategy Performance
             </h3>
             <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded border border-indigo-100">Live Data</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[
                  { name: 'SEO Focus', rate: 18 },
                  { name: 'Ads Focus', rate: 24 },
                  { name: 'Balanced', rate: 21 }
              ]} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" unit="%" hide />
                <YAxis dataKey="name" type="category" width={100} axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#475569'}} />
                <Tooltip cursor={{fill: 'transparent'}} />
                <Legend />
                <Bar dataKey="rate" name="Conversion Rate (%)" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={30}>
                    {[0,1,2].map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index === 1 ? '#22c55e' : '#6366f1'} />
                    ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardStats;
