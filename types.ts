
export enum CallStatus {
  Idle = 'IDLE',
  Connecting = 'CONNECTING',
  Active = 'ACTIVE',
  Completed = 'COMPLETED',
  Failed = 'FAILED'
}

export interface Lead {
  id: string;
  name: string;
  businessName: string;
  phone: string;
  email?: string; // Added email field
  source: 'GMB' | 'CSV' | 'Manual';
  status: 'Pending' | 'Called' | 'Converted' | 'Rejected';
  notes?: string;
  lastCallDuration?: string;
}

export interface Metric {
  name: string;
  value: number | string;
  change: number;
  trend: 'up' | 'down' | 'neutral';
}

export interface CallLog {
  id: string;
  leadName: string;
  timestamp: string;
  duration: string;
  outcome: 'Meeting Booked' | 'Follow-up' | 'Not Interested' | 'Voicemail';
  sentiment: 'Positive' | 'Neutral' | 'Negative';
}

export interface ChartData {
  name: string;
  calls: number;
  conversions: number;
}
