import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, Legend } from 'recharts';
import { Metric } from '../types';
import { TrendingUp, Users, CalendarCheck, PhoneCall, Split } from 'lucide-react';

const data = [
  { name: 'Mon', calls: 40, conversions: 24 },
  { name: 'Tue', calls: 30, conversions: 13 },
  { name: 'Wed', calls: 20, conversions: 18 },
  { name: 'Thu', calls: 27, conversions: 19 },
  { name: 'Fri', calls: 18, conversions: 12 },
  { name: 'Sat', calls: 23, conversions: 15 },
  { name: 'Sun', calls: 34, conversions: 20 },
];

const abTestData = [
  { name: 'SEO Focus (A)', rate: 18, meetings: 45 },
  { name: 'Ads Focus (B)', rate: 24, meetings: 62 },
  { name: 'Balanced', rate: 21, meetings: 53 },
];

const metrics: Metric[] = [
  { name: 'Total Calls', value: '1,284', change: 12.5, trend: 'up' },
  { name: 'Connect Rate', value: '68%', change: 4.2, trend: 'up' },
  { name: 'Meetings Booked', value: '142', change: -2.1, trend: 'down' },
  { name: 'Avg Duration', value: '2m 14s', change: 0.8, trend: 'neutral' },
];

const MetricCard: React.FC<{ metric: Metric; icon: any; color: string }> = ({ metric, icon: Icon, color }) => (
  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
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

const DashboardStats: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard metric={metrics[0]} icon={PhoneCall} color="bg-blue-500" />
        <MetricCard metric={metrics[1]} icon={TrendingUp} color="bg-green-500" />
        <MetricCard metric={metrics[2]} icon={CalendarCheck} color="bg-indigo-500" />
        <MetricCard metric={metrics[3]} icon={Users} color="bg-orange-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Call Volume Area Chart */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-4">Call Volume vs Conversions</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
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

        {/* A/B Test Results */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-center mb-4">
             <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Split size={20} className="text-indigo-500" />
                A/B Test: Strategy Performance
             </h3>
             <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded border border-indigo-100">Live Data</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={abTestData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" unit="%" hide />
                <YAxis dataKey="name" type="category" width={100} axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#475569'}} />
                <Tooltip cursor={{fill: 'transparent'}} />
                <Legend />
                <Bar dataKey="rate" name="Conversion Rate (%)" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={30}>
                    {abTestData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index === 1 ? '#22c55e' : '#6366f1'} />
                    ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-500 mt-2 text-center">Strategy 'Ads Focus (B)' is performing 6% better than baseline.</p>
        </div>
      </div>
    </div>
  );
};

export default DashboardStats;