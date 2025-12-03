
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
  email?: string;
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
  timestamp: string; // ISO string from server
  duration: number; 
  outcome: 'Meeting Booked' | 'Follow-up' | 'Not Interested' | 'Voicemail' | 'Call Later' | 'Call Finished' | 'Failed';
  sentiment: 'Positive' | 'Neutral' | 'Negative';
  notes?: string; // Added notes field
}

export interface ChartData {
  name: string;
  calls: number;
  conversions: number;
}

export interface Recording {
  id: string;
  leadName: string;
  timestamp: string;
  duration: number;
  url: string;
  saved: boolean;
  type: 'Incoming' | 'Outgoing';
}

export interface SystemLog {
    id: string;
    timestamp: string;
    type: 'INFO' | 'SUCCESS' | 'ERROR' | 'API_REQ' | 'API_RES' | 'WEBHOOK';
    message: string;
    details?: any;
}
