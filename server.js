
/**
 * SKDM Voice Agent - Live Backend Server
 * 
 * FEATURES:
 * - Voice: Dynamic Selection (Default 'Puck')
 * - Scheduler: 10-minute interval algorithm for campaigns
 * - Integrations: Google Calendar (Mock), Tata Broadband Logging
 * - Telephony: Tata Smartflo API Integration (Dynamic Auth)
 * - Analytics: Real-time stats and call logging
 * - Recordings: Capture and management of call audio
 * - Webhooks: Real-time event handling from Telephony Provider
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';
import cors from 'cors';
import dotenv from 'dotenv';
import { URL } from 'url';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Enable All CORS Requests
app.use(cors({ origin: '*' }));
// Parse JSON and Form Data (Webhooks often send application/x-www-form-urlencoded)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURATION ---
const API_KEY = process.env.API_KEY;

// --- TATA SMARTFLO CREDENTIALS ---
const TATA_BASE_URL = "https://api-smartflo.tatateleservices.com/v1";
const TATA_LOGIN_EMAIL = "Demo.2316"; 
const TATA_LOGIN_PASS = "Admin@11221"; 
const TATA_FROM_NUMBER = "918069651168";

// Token Caching
let tataAccessToken = null;
let tokenExpiryTime = 0;

// Call Queue for Campaigns
let campaignQueue = [];
let campaignActive = false;

// Call State Tracking (For Frontend UI)
let currentCallState = {
    status: 'idle', // idle, ringing, answered, completed
    id: null,
    startTime: null,
    agent: 'Puck'
};

// Default Voice (Fallback)
let currentVoice = 'Puck'; 

// --- SYSTEM LOGS (IN-MEMORY) ---
let systemLogs = [];
const addSystemLog = (type, message, details = null) => {
    const log = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        type,
        message,
        details
    };
    systemLogs.push(log);
    if (systemLogs.length > 200) systemLogs.shift(); // Keep last 200 logs
    console.log(`[${type}] ${message}`);
};

// --- ANALYTICS STORAGE (IN-MEMORY) ---
let callHistory = [
    { id: 'mock-1', leadName: 'Dr. Amit Patel', duration: 145, outcome: 'Meeting Booked', sentiment: 'Positive', timestamp: Date.now() - 3600000 },
    { id: 'mock-2', leadName: 'Rohan Verma', duration: 45, outcome: 'Not Interested', sentiment: 'Neutral', timestamp: Date.now() - 7200000 },
    { id: 'mock-3', leadName: 'Sneha Gupta', duration: 80, outcome: 'Follow-up', sentiment: 'Positive', timestamp: Date.now() - 10800000 },
    { id: 'mock-4', leadName: 'Rajesh Kumar', duration: 12, outcome: 'Voicemail', sentiment: 'Negative', timestamp: Date.now() - 86400000 },
];

// --- RECORDINGS STORAGE (IN-MEMORY) ---
let recordings = [
    { id: 'rec-1', leadName: 'Dr. Amit Patel', duration: 145, timestamp: Date.now() - 3600000, url: 'https://www2.cs.uic.edu/~i101/SoundFiles/BabyElephantWalk60.wav', saved: true, type: 'Outgoing' },
    { id: 'rec-3', leadName: 'Sneha Gupta', duration: 80, timestamp: Date.now() - 10800000, url: 'https://www2.cs.uic.edu/~i101/SoundFiles/BabyElephantWalk60.wav', saved: false, type: 'Incoming' },
];

// --- HELPER: GET AGENT NAME FROM VOICE ---
const getAgentName = (voiceId) => {
    const map = {
        'Puck': 'Raj',
        'Kore': 'Priya',
        'Fenrir': 'Vikram',
        'Charon': 'Arjun',
        'Aoede': 'Ananya'
    };
    return map[voiceId] || 'Raj';
};

// --- SYSTEM PROMPT GENERATOR ---
const getSystemPrompt = (voiceId) => {
    const agentName = getAgentName(voiceId);
    return `
**IDENTITY**: You are "${agentName}" (using voice '${voiceId}'), a senior sales representative for SKDM (Shree Krishna Digital Marketing).
**CONTEXT**: You are on a **LIVE PHONE CALL**.
**GOAL**: Book a meeting for the Silver Package (₹12,000/month).

**VOICE MODULATION & PERSONALITY (CRITICAL)**:
1.  **VOICE**: You are using the '${voiceId}' voice.
2.  **DYNAMIC EMOTION (Act on this)**:
    *   **PITCHING MODE (Benefits/ROI)**: 
        -   **Tone**: Energetic, Confident, slightly faster. 
        -   **Style**: Use rising intonation. "Sir, ROI guaranteed hai!"
    *   **EMPATHY MODE (Objections/Cost)**: 
        -   **Tone**: Calm, Slower, Lower Pitch. 
        -   **Style**: Sound understanding. "Bilkul samajh sakta hu sir."
    *   **LISTENING**: Pause for 1-2 seconds after questions.

**LANGUAGE MODE: HINGLISH (MUMBAI STYLE)**:
-   **Switch Naturally**: Speak a mix of Hindi and English typical of Indian business.
-   **English**: Use for technical terms (e.g., "Leads", "Traffic", "Website", "Package").
-   **Hindi**: Use for conversational flow (e.g., "kar rahe hai", "bataiye", "main aapko bhejta hu").
-   **Example**: "Sir, aapka **Google My Business** profile accha hai, but **reviews** thode kam hai. Hum usse **optimize** kar sakte hai."

**SCRIPT FLOW**:
1.  **Greeting**: "Namaste [Name], SKDM se ${agentName} baat kar raha/rahi hu. I noticed your business online—kaafi potential hai!"
2.  **Hook**: "Abhi aap leads ke liye kya use kar rahe hai? Ads ya Organic?"
3.  **Pitch**: "Hamara 360° Silver Package hai—SEO, Social Media, Website—sab kuch ₹12k/month mein."
4.  **Close**: "Kya hum next Tuesday 15-min ka Google Meet schedule kar lein? Main invite bhej deta/deti hu."

**TOOLS**:
*   **BOOKING**: Use 'bookMeeting'. **Ask for Email** and **Meeting Type** (Google Meet/Visit).
*   **LOGGING**: Use 'logOutcome' after **EVERY** call.
`;
};

// --- HELPER: AUDIO TRANSCODING (G.711 <-> PCM) ---
const muLawToPcm = (muLawBuffer) => {
    const pcmBuffer = new Int16Array(muLawBuffer.length);
    for (let i = 0; i < muLawBuffer.length; i++) {
        let ulaw = muLawBuffer[i] ^ 0xFF;
        let sign = (ulaw & 0x80) ? -1 : 1;
        let mantissa = (ulaw & 0x0F);
        let exponent = (ulaw >> 4) & 0x07;
        let sample = sign * (0x21 | (mantissa << 1)) << (exponent + 2);
        pcmBuffer[i] = sample; 
    }
    return pcmBuffer;
};

const pcmToMuLaw = (pcmBuffer) => {
    const muLawBuffer = new Uint8Array(pcmBuffer.length);
    for (let i = 0; i < pcmBuffer.length; i++) {
        let sample = pcmBuffer[i];
        let sign = (sample >> 8) & 0x80;
        if (sign !== 0) sample = -sample;
        if (sample > 32635) sample = 32635;
        sample = sample + 0x84;
        let exponent = 7;
        let mask = 0x4000;
        for (let j = 0; j < 8; j++) {
            if (sample & mask) {
                exponent = 7 - j;
                break;
            }
            mask >>= 1;
        }
        let mantissa = (sample >> (exponent + 3)) & 0x0F;
        let ulaw = (sign | (exponent << 4) | mantissa) ^ 0xFF;
        muLawBuffer[i] = ulaw;
    }
    return muLawBuffer;
};

const upsample8kTo16k = (pcm8k) => {
    const pcm16k = new Int16Array(pcm8k.length * 2);
    for (let i = 0; i < pcm8k.length; i++) {
        pcm16k[i * 2] = pcm8k[i];
        if (i < pcm8k.length - 1) {
            pcm16k[i * 2 + 1] = (pcm8k[i] + pcm8k[i+1]) / 2;
        } else {
            pcm16k[i * 2 + 1] = pcm8k[i];
        }
    }
    return pcm16k;
};

const downsample24kTo8k = (pcm24k) => {
    const pcm8k = new Int16Array(Math.floor(pcm24k.length / 3));
    for (let i = 0; i < pcm8k.length; i++) {
        pcm8k[i] = pcm24k[i * 3]; 
    }
    return pcm8k;
};

// --- TATA AUTHENTICATION ---
const getTataAccessToken = async () => {
    if (tataAccessToken && Date.now() < tokenExpiryTime) {
        return tataAccessToken;
    }
    
    // Polyfill fetch if needed (for older Node environments)
    if (typeof fetch === 'undefined') {
        try { global.fetch = (await import('node-fetch')).default; } catch (e) { console.warn("Native fetch not found, polyfill failed"); }
    }

    try {
        addSystemLog('INFO', "Authenticating with Tata Smartflo...");
        const response = await fetch(`${TATA_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ "email": TATA_LOGIN_EMAIL, "password": TATA_LOGIN_PASS })
        });

        const data = await response.json();
        if (response.ok && data.access_token) {
            tataAccessToken = data.access_token;
            tokenExpiryTime = Date.now() + (55 * 60 * 1000);
            addSystemLog('SUCCESS', "Tata Login Successful", { expires_in: 3300 });
            return tataAccessToken;
        } else {
            addSystemLog('ERROR', "Tata Login Failed", data);
            throw new Error("Failed to authenticate with Tata Smartflo");
        }
    } catch (error) {
        addSystemLog('ERROR', "Auth Request Network Error", error.message);
        throw error;
    }
};

// --- CAMPAIGN SCHEDULER ALGORITHM ---
setInterval(() => {
    if (!campaignActive || campaignQueue.length === 0) return;
    const now = Date.now();
    const nextLead = campaignQueue[0];
    if (nextLead && nextLead.scheduledTime <= now) {
        console.log(`⏰ [SCHEDULER] Triggering Call: ${nextLead.name}`);
        triggerTataCall(nextLead.phone, nextLead.name, currentVoice);
        campaignQueue.shift(); 
    }
}, 60000); 

const triggerTataCall = async (phone, name, voice, record = false) => {
    addSystemLog('INFO', `Preparing Call to ${phone}`, { name, voice, record });
    
    // Reset Call State for new call
    currentCallState = {
        status: 'ringing',
        id: null,
        startTime: null,
        agent: voice
    };

    try {
        // Strict 10 digit sanitization for India (+91 or 0 prefix removal)
        // Tata Smartflo often requires simple 10 digit or specific format.
        // Assuming 10 digits for local, E.164 for international if configured.
        let sanitizedPhone = phone.replace(/\D/g, ''); 
        if (sanitizedPhone.length > 10 && sanitizedPhone.startsWith('91')) {
            sanitizedPhone = sanitizedPhone.substring(2);
        }
        if (sanitizedPhone.length > 10 && sanitizedPhone.startsWith('0')) {
            sanitizedPhone = sanitizedPhone.substring(1);
        }
        
        // Ensure Agent Number is also clean
        const agentNumber = TATA_FROM_NUMBER.replace(/\D/g, '');

        const token = await getTataAccessToken();
        const payload = {
            "agent_number": agentNumber, // The number that initiates (Usually Agent/AI)
            "destination_number": sanitizedPhone, // The customer number
            "caller_id": agentNumber,
            "async": 1,
            "record": record ? 1 : 0,
            "status_callback": process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/api/webhooks/voice-event` : undefined,
            "status_callback_event": ["initiated", "ringing", "answered", "completed"],
            "status_callback_method": "POST"
        };

        addSystemLog('API_REQ', 'Sending Click-to-Call Request', payload);

        const response = await fetch(`${TATA_BASE_URL}/click_to_call`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        
        // Update Call ID if available
        if (data.uuid || data.request_id || (data.status === 'success')) {
            addSystemLog('SUCCESS', 'Tata API Accepted Call', data);
            currentCallState.id = data.uuid || data.request_id;
        } else {
             addSystemLog('ERROR', 'Tata API Rejected Call', data);
        }

        return data;
    } catch (error) {
        addSystemLog('ERROR', 'Dial Request Exception', error.message);
        currentCallState.status = 'failed';
        return { error: error.message };
    }
};

// --- API ENDPOINTS ---

app.get('/', (req, res) => {
    res.send("SKDM Voice Agent Backend Running.");
});

// System Logs Endpoint
app.get('/api/system-logs', (req, res) => {
    res.json(systemLogs);
});

app.delete('/api/system-logs', (req, res) => {
    systemLogs = [];
    res.json({ success: true });
});

// Real-time Call Status Endpoint
app.get('/api/call-status', (req, res) => {
    res.json(currentCallState);
});

// --- WEBHOOK: HANDLE CALL EVENTS (Answered, Hangup) ---
app.post('/api/webhooks/voice-event', (req, res) => {
    const body = req.body;
    
    // Normalize properties
    const callId = body.uuid || body.CallSid;
    const currentStatus = body.status || body.CallStatus || body.Status;
    const duration = body.duration || body.Duration;
    
    addSystemLog('WEBHOOK', `Event: ${currentStatus}`, body);

    // Only update if it matches current call to prevent race conditions from old hooks
    if (currentCallState.id && (callId === currentCallState.id || !currentCallState.id)) {
        if (currentStatus === 'answered' || currentStatus === 'in-progress') {
            currentCallState.status = 'answered';
            if (!currentCallState.startTime) currentCallState.startTime = Date.now();
        } 
        else if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(currentStatus)) {
            currentCallState.status = 'completed';
            // Log if completed
            const calcDuration = duration || (currentCallState.startTime ? Math.round((Date.now() - currentCallState.startTime)/1000) : 0);
            callHistory.push({
                id: `call-${Date.now()}`,
                leadName: 'Customer', 
                timestamp: Date.now(),
                duration: parseInt(calcDuration),
                outcome: currentStatus === 'completed' ? 'Call Finished' : currentStatus,
                sentiment: 'Neutral'
            });
        }
        else if (currentStatus === 'ringing') {
            currentCallState.status = 'ringing';
        }
    }

    res.status(200).send('Event Received');
});

// Analytics Endpoint
app.get('/api/stats', (req, res) => {
    const totalCalls = callHistory.length;
    const meetings = callHistory.filter(c => c.outcome === 'Meeting Booked').length;
    const totalDuration = callHistory.reduce((acc, curr) => acc + (curr.duration || 0), 0);
    const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
    const avgMin = Math.floor(avgDuration / 60);
    const avgSec = avgDuration % 60;

    const chartData = [
        { name: 'Mon', calls: 10, conversions: 2 },
        { name: 'Tue', calls: 15, conversions: 5 },
        { name: 'Wed', calls: 8, conversions: 1 },
        { name: 'Thu', calls: 20, conversions: 6 },
        { name: 'Today', calls: totalCalls, conversions: meetings } 
    ];

    res.json({
        metrics: [
            { name: 'Total Calls', value: totalCalls, change: 12, trend: 'up' },
            { name: 'Connect Rate', value: '85%', change: 5, trend: 'up' }, 
            { name: 'Meetings Booked', value: meetings, change: meetings > 0 ? 100 : 0, trend: meetings > 0 ? 'up' : 'neutral' },
            { name: 'Avg Duration', value: `${avgMin}m ${avgSec}s`, change: 0, trend: 'neutral' },
        ],
        chartData,
        recentCalls: callHistory.slice(-10).reverse() 
    });
});

app.post('/api/dial', async (req, res) => {
    const { phone, name, voice, record } = req.body;
    if (voice) currentVoice = voice;
    
    try {
        const data = await triggerTataCall(phone, name, voice, record);
        
        if (data.error) {
             res.status(500).json({ error: data.error });
        } else if (data.success || data.uuid || data.status === 'success' || data.message === 'Success') {
             res.json({ success: true, callId: data.uuid || data.request_id || 'queued', raw: data });
        } else {
             res.status(500).json({ error: JSON.stringify(data) });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Recordings Endpoints
app.get('/api/recordings', (req, res) => {
    res.json(recordings);
});

app.delete('/api/recordings/:id', (req, res) => {
    const { id } = req.params;
    recordings = recordings.filter(r => r.id !== id);
    res.json({ success: true });
});

app.post('/api/recordings/:id/save', (req, res) => {
    const { id } = req.params;
    const rec = recordings.find(r => r.id === id);
    if (rec) {
        rec.saved = !rec.saved;
        res.json({ success: true, saved: rec.saved });
    } else {
        res.status(404).json({ error: 'Recording not found' });
    }
});

app.post('/api/campaign/upload', (req, res) => {
    const { leads, startTime } = req.body; 
    const startTimestamp = new Date(startTime).getTime();
    const INTERVAL_MS = 10 * 60 * 1000; 

    leads.forEach((lead, index) => {
        campaignQueue.push({
            ...lead,
            scheduledTime: startTimestamp + (index * INTERVAL_MS),
            status: 'queued'
        });
    });
    campaignActive = true;
    res.json({ success: true, message: `Campaign Scheduled with ${leads.length} leads.` });
});

// Twilio/Tataflow Webhook for Voice - Returns TwiML or CCXML
// This endpoint MUST be configured in Tata Portal as the "Voice Answer" or "Incoming Call" URL
app.post('/api/voice-answer', (req, res) => {
    const host = req.get('host');
    addSystemLog('WEBHOOK', 'Voice Answer Triggered', { host });
    
    // NOTE: Ensure your Tata account supports TwiML. If it supports CCXML, change format.
    // Most cloud providers support TwiML <Connect><Stream>.
    const twiml = `
    <Response>
        <Connect>
            <Stream url="wss://${host}/media-stream" />
        </Connect>
    </Response>
    `;
    res.type('text/xml');
    res.send(twiml);
});

const server = app.listen(port, () => {
    console.log(`\n🚀 SKDM Backend running on port ${port}`);
    console.log(`🔗 Webhook URL: ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + port}/api/webhooks/voice-event`);
});

// --- WEBSOCKET (LIVE AI) ---
const wss = new WebSocketServer({ server, path: '/media-stream' });

wss.on('connection', (ws) => {
    addSystemLog('INFO', 'Phone WebSocket Connected');
    
    // UPDATE CALL STATE: User Answered (Fallback if webhook delayed)
    currentCallState.status = 'answered';
    if (!currentCallState.startTime) currentCallState.startTime = Date.now();

    const callStartTime = Date.now();
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    let session = null;
    let streamSid = null;

    const connectToGemini = async () => {
        try {
            const prompt = getSystemPrompt(currentVoice);
            session = await ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: prompt,
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: currentVoice } } },
                    tools: [{ functionDeclarations: [
                        {
                            name: 'bookMeeting',
                            description: 'Books meeting.',
                            parameters: { type: 'OBJECT', properties: { clientEmail: {type:'STRING'}, meetingType: {type:'STRING'}, date: {type:'STRING'}, time: {type:'STRING'} } }
                        },
                        {
                            name: 'logOutcome',
                            description: 'Logs outcome.',
                            parameters: { type: 'OBJECT', properties: { outcome: {type:'STRING'}, sentiment: {type:'STRING'}, notes: {type:'STRING'} }, required: ['outcome'] }
                        }
                    ]}]
                },
                callbacks: {
                    onopen: () => addSystemLog('INFO', 'Gemini AI Connected'),
                    onmessage: (msg) => {
                        if (msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
                            const pcm24k = Buffer.from(msg.serverContent.modelTurn.parts[0].inlineData.data, 'base64');
                            const pcm24kInt16 = new Int16Array(pcm24k.buffer, pcm24k.byteOffset, pcm24k.length / 2);
                            const muLaw = pcmToMuLaw(downsample24kTo8k(pcm24kInt16));
                            const payload = Buffer.from(muLaw).toString('base64');
                            if (ws.readyState === WebSocket.OPEN && streamSid) {
                                ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
                            }
                        }
                        if (msg.toolCall) {
                            msg.toolCall.functionCalls.forEach(fc => {
                                let result = "Success";
                                if (fc.name === 'logOutcome') {
                                    const duration = Math.round((Date.now() - callStartTime) / 1000);
                                    callHistory.push({
                                        id: `call-${Date.now()}`,
                                        leadName: 'Customer', 
                                        timestamp: Date.now(),
                                        duration: duration,
                                        outcome: fc.args.outcome,
                                        sentiment: fc.args.sentiment || 'Neutral'
                                    });
                                }
                                session.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: { result } }] });
                            });
                        }
                    }
                }
            });
        } catch (e) { 
             console.error("Gemini Error", e); 
             addSystemLog('ERROR', 'Gemini AI Connection Failed', e.message);
        }
    };

    connectToGemini();

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        if (data.event === 'start') streamSid = data.start.streamSid;
        if (data.event === 'media' && session) {
            const pcm16k = upsample8kTo16k(muLawToPcm(Buffer.from(data.media.payload, 'base64')));
            session.sendRealtimeInput({ media: { mimeType: 'audio/pcm;rate=16000', data: Buffer.from(pcm16k.buffer).toString('base64') } });
        }
        if (data.event === 'stop') {
             session?.close();
             currentCallState.status = 'completed'; // Call Ended
        }
    });

    ws.on('close', () => {
        addSystemLog('INFO', 'Phone WebSocket Disconnected');
        currentCallState.status = 'idle'; // Reset Status
        if (session) session.close();
    });
});
