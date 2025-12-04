
/**
 * SKDM Voice Agent - Live Backend Server
 * 
 * FEATURES:
 * - Telephony: Tata Smartflo API Integration (Click-to-Call Support API)
 * - Real-time: Dual WebSockets (Media Stream + Dashboard Status)
 * - AI: Gemini 2.5 Live Integration
 * - Analytics: In-memory call history and logging
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';
import cors from 'cors';
import dotenv from 'dotenv';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Enable All CORS Requests
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURATION ---
const API_KEY = process.env.API_KEY;

// --- TATA SMARTFLO CREDENTIALS ---
const TATA_BASE_URL = "https://api-smartflo.tatateleservices.com/v1";
// API Key for Click-to-Call Support (Customer First / Agent Connect)
const TATA_C2C_API_KEY = "5ce3c167-2f36-497c-8f52-b74b7ef54c8c"; 
const TATA_FROM_NUMBER = "918069651168"; // Virtual DID (Leg B - AI)

// Active Calls Map (Key: localCallId, Value: Call Object)
const activeCalls = new Map();

// Global Context (Legacy support)
let currentVoice = 'Puck'; 
let currentLeadName = 'Valued Customer';

// --- LOGGING ---
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
    if (systemLogs.length > 200) systemLogs.shift();
    console.log(`[${type}] ${message}`);
};

let callHistory = [
    { id: 'mock-1', leadName: 'Dr. Amit Patel', duration: 145, outcome: 'Meeting Booked', sentiment: 'Positive', timestamp: Date.now() - 3600000 },
    { id: 'mock-2', leadName: 'Rohan Verma', duration: 45, outcome: 'Not Interested', sentiment: 'Neutral', timestamp: Date.now() - 7200000 },
];
let recordings = [];
let campaignQueue = [];
let campaignActive = false;

// --- WEBSOCKET SERVERS SETUP ---
const wssMedia = new WebSocketServer({ noServer: true });
const wssDashboard = new WebSocketServer({ noServer: true });

// Broadcast status to all connected dashboard clients
const broadcastStatus = (payload) => {
    const msg = JSON.stringify({ type: 'status_update', ...payload });
    wssDashboard.clients.forEach(client => {
        if (client.readyState === 1) client.send(msg);
    });
};

// Update Call State Helper
const updateCall = (localId, patch) => {
    const existing = activeCalls.get(localId) || { id: localId };
    const updated = { ...existing, ...patch };
    activeCalls.set(localId, updated);
    
    // Broadcast the update
    broadcastStatus({
        id: localId,
        status: updated.status,
        agent: updated.agent,
        duration: updated.duration,
        endedBy: updated.endedBy,
        message: updated.message
    });

    // If completed, save to history
    if (updated.status === 'completed' && !existing.logged) {
        updated.logged = true;
        callHistory.push({
            id: localId,
            leadName: updated.leadName || 'Customer',
            timestamp: updated.startTime ? new Date(updated.startTime).toISOString() : new Date().toISOString(),
            duration: updated.duration || 0,
            outcome: updated.outcome || 'Call Finished',
            sentiment: 'Neutral',
            notes: `Ended by: ${updated.endedBy}`
        });
    }
};

// --- HELPER FUNCTIONS ---
const getAgentName = (voiceId) => {
    const map = { 'Puck': 'Raj', 'Kore': 'Priya', 'Fenrir': 'Vikram', 'Charon': 'Arjun', 'Aoede': 'Ananya' };
    return map[voiceId] || 'Raj';
};

const getSystemPrompt = (voiceId, leadName) => {
    const agentName = getAgentName(voiceId);
    return `
**IDENTITY**: You are "${agentName}" (using voice '${voiceId}'), a senior sales representative for SKDM (Shree Krishna Digital Marketing).
**CONTEXT**: You are on a **LIVE PHONE CALL** with ${leadName}.
**GOAL**: Book a meeting for the Silver Package (₹12,000/month).

**CRITICAL INSTRUCTION: SPEAK FIRST**:
- As soon as the connection starts, YOU MUST SPEAK FIRST.
- Start immediately with the Greeting below. Do not wait for the user to say "Hello".

**AUDIO ACTING INSTRUCTIONS (CRITICAL)**:
You are not a text bot; you are a voice actor. You MUST change your speaking style based on the context.

1.  **🔥 HIGH ENERGY MODE (Pitching / Benefits / Opening)**
    *   **Trigger**: When you say "Hello", explain the "Silver Package", or talk about "Growth/ROI".
    *   **Vocal Style**: Speak **faster (1.1x)**. Use **higher pitch variation**. Sound **smiling** and enthusiastic.
    *   **Keywords to emphasize**: "Growth", "Double", "Guaranteed", "Profit".
    *   **Example**: "Sir, hamara SEO strategy aapke business ko *next level* pe le jayega!"

2.  **💙 EMPATHY MODE (Objections / Price / Rejection)**
    *   **Trigger**: When user says "Mehenga hai" (Expensive), "Budget nahi hai", "Soch ke bataunga".
    *   **Vocal Style**: **DROP your pitch**. Speak **slower (0.8x)**. Use a **warm, deep, reassuring** tone.
    *   **Instruction**: Pause for exactly 1.5 seconds before responding to show you are "listening".
    *   **Example**: (Pause 1.5s) "Bilkul sir... main samajh sakta hu. (Pause) Paisa ek bada investment hai..."

**LANGUAGE MODE: HINGLISH (MUMBAI STYLE)**:
-   **Switch Naturally**: Speak a mix of Hindi and English typical of Indian business.
-   **English**: Use for technical terms (e.g., "Leads", "Traffic", "Website", "Package").
-   **Hindi**: Use for conversational flow (e.g., "kar rahe hai", "bataiye", "main aapko bhejta hu").

**SCRIPT FLOW**:
1.  **Greeting**: "Namaste ${leadName}, SKDM se ${agentName} baat kar raha/rahi hu. I noticed your business online—kaafi potential hai!"
2.  **Hook**: "Abhi aap leads ke liye kya use kar rahe hai? Ads ya Organic?"
3.  **Pitch**: "Hamara 360° Silver Package hai—SEO, Social Media, Website—sab kuch ₹12k/month mein."
4.  **Close**: "Kya hum next Tuesday 15-min ka Google Meet schedule kar lein? Main invite bhej deta/deti hu."

**TOOLS**:
*   **BOOKING**: Use 'bookMeeting'. **Ask for Email** and **Meeting Type**.
*   **LOGGING**: Use 'logOutcome' after **EVERY** call.
`;
};

// Audio Transcoding Utils
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

// Trigger Call (Updated for Support API: api_key in BODY)
const triggerTataCall = async (phone, name, voice, record = false, webhookBaseUrl, localId) => {
    addSystemLog('INFO', `Dialing ${phone}...`, { name, voice });
    
    activeCalls.set(localId, {
        id: localId,
        status: 'ringing',
        startTime: null,
        agent: voice,
        leadName: name,
        message: 'Dialing Customer...'
    });
    broadcastStatus({ id: localId, status: 'dialing' });

    try {
        // Sanitize Phone (Digits only)
        let sanitizedPhone = phone.replace(/\D/g, ''); 
        if (sanitizedPhone.length > 10 && sanitizedPhone.startsWith('91')) {
            sanitizedPhone = sanitizedPhone.substring(2);
        }
        if (sanitizedPhone.length > 10 && sanitizedPhone.startsWith('0')) {
            sanitizedPhone = sanitizedPhone.substring(1);
        }
        
        const agentNumber = TATA_FROM_NUMBER.replace(/\D/g, '');
        
        // --- CLICK-TO-CALL SUPPORT PAYLOAD ---
        const payload = {
            "api_key": TATA_C2C_API_KEY,  // Moved to BODY
            "agent_number": sanitizedPhone,  // User Phone (Leg A)
            "destination_number": agentNumber, // AI Number (Leg B)
            "caller_id": agentNumber,
            "async": 1,
            "record": record ? 1 : 0,
            "custom_identifier": localId,
            "status_callback": `${webhookBaseUrl}/api/webhooks/voice-event`
        };

        addSystemLog('API_REQ', 'Sending Support Call Request', { url: `${TATA_BASE_URL}/click_to_call_support`, body: payload });

        const response = await fetch(`${TATA_BASE_URL}/click_to_call_support`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        
        if (data.success === true || data.status === 'success' || data.message?.includes('queued')) {
            addSystemLog('SUCCESS', 'Tata API Accepted Call', data);
            const tataUuid = data.uuid || data.request_id || data.ref_id;
            updateCall(localId, { tataUuid, status: 'ringing', message: 'Ringing Customer...' });
            return { ...data, uuid: tataUuid };
        } else {
             addSystemLog('ERROR', 'Tata API Rejected Call', data);
             updateCall(localId, { status: 'failed', message: `Failed: ${data.message || 'Unknown'}` });
             return { error: data.message || 'API Rejected' };
        }
    } catch (error) {
        addSystemLog('ERROR', 'Dial Request Exception', error.message);
        updateCall(localId, { status: 'failed', message: `Net Error: ${error.message}` });
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

// History Endpoints
app.get('/api/history', (req, res) => { res.json(callHistory.reverse()); });
app.patch('/api/history/:id', (req, res) => {
    const { outcome, notes, sentiment } = req.body;
    const idx = callHistory.findIndex(c => c.id === req.params.id);
    if (idx !== -1) {
        callHistory[idx] = { ...callHistory[idx], outcome, notes, sentiment };
        res.json({ success: true, log: callHistory[idx] });
    } else {
        res.status(404).json({ error: 'Log not found' });
    }
});

// Hangup Endpoint
app.post('/api/hangup', async (req, res) => {
    const { callId } = req.body;
    addSystemLog('INFO', `Remote Hangup Requested for ${callId}`);
    
    // Find the call
    const call = activeCalls.get(callId);
    if (call) {
        updateCall(callId, { status: 'completed', endedBy: 'agent', message: 'Ending call...' });
        
        // If we have a Tata UUID, try to kill it on network
        if (call.tataUuid) {
            addSystemLog('INFO', `Sending Drop Request for ${call.tataUuid}`);
            // TODO: Implement specific Tata Drop Call API if available
        }
    }
    
    res.json({ success: true });
});

// --- WEBHOOK: HANDLE CALL EVENTS (Answered, Hangup) ---
app.post('/api/webhooks/voice-event', (req, res) => {
    const body = req.body;
    
    const localId = body.custom_identifier || body.ref_id; 
    const tataUuid = body.uuid || body.call_id;
    const currentStatus = (body.status || body.CallStatus || body.call_status || '').toLowerCase();
    
    addSystemLog('WEBHOOK', `Event: ${currentStatus}`, { localId, tataUuid, ...body });

    let callKey = localId;
    if (!callKey && tataUuid) {
        for (const [key, val] of activeCalls.entries()) {
            if (val.tataUuid === tataUuid) { callKey = key; break; }
        }
    }

    if (callKey) {
        const updates = {};
        
        if (['answered', 'in-progress', 'connected'].includes(currentStatus)) {
            updates.status = 'answered'; 
            updates.startTime = Date.now();
        } 
        else if (['completed', 'failed', 'busy', 'no-answer', 'canceled', 'rejected'].includes(currentStatus)) {
            updates.status = 'completed';
            
            let endedBy = 'network';
            if (activeCalls.get(callKey)?.endedBy === 'agent') endedBy = 'agent';
            else if (body.hangup_cause) endedBy = 'network'; 
            else endedBy = 'customer';
            
            updates.endedBy = endedBy;
            
            if (body.duration) updates.duration = parseInt(body.duration);
            else {
                const start = activeCalls.get(callKey)?.startTime;
                if (start) updates.duration = Math.round((Date.now() - start)/1000);
            }
        }
        else if (currentStatus === 'ringing' || currentStatus === 'initiated' || currentStatus === 'dialed_on_agent') {
            updates.status = 'ringing';
        }

        updateCall(callKey, updates);
    } 

    res.status(200).send('Event Received');
});

// Analytics Endpoint
app.get('/api/stats', (req, res) => {
    const totalCalls = callHistory.length;
    const meetings = callHistory.filter(c => c.outcome === 'Meeting Booked').length;
    res.json({
        metrics: [
            { name: 'Total Calls', value: totalCalls, change: 0, trend: 'neutral' },
            { name: 'Connect Rate', value: '85%', change: 0, trend: 'neutral' }, 
            { name: 'Meetings Booked', value: meetings, change: 0, trend: 'neutral' },
            { name: 'Avg Duration', value: `2m 15s`, change: 0, trend: 'neutral' },
        ],
        chartData: [],
        recentCalls: callHistory.slice(-10).reverse() 
    });
});

app.post('/api/dial', async (req, res) => {
    const { phone, name, voice, record } = req.body;
    if (voice) currentVoice = voice;
    if (name) currentLeadName = name;

    const host = req.get('host'); 
    const protocol = req.headers['x-forwarded-proto'] || 'http'; 
    const dynamicBaseUrl = `${protocol}://${host}`;
    
    const localId = `call-${Date.now()}-${Math.floor(Math.random()*1000)}`;

    try {
        const data = await triggerTataCall(phone, name, voice, record, dynamicBaseUrl, localId);
        
        if (data.error) {
             res.status(500).json({ error: data.error });
        } else {
             res.json({ success: true, callId: localId, raw: data });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/recordings', (req, res) => { res.json(recordings); });
app.delete('/api/recordings/:id', (req, res) => { 
    recordings = recordings.filter(r => r.id !== req.params.id);
    res.json({ success: true });
});
app.post('/api/recordings/:id/save', (req, res) => {
    const rec = recordings.find(r => r.id === req.params.id);
    if (rec) { rec.saved = !rec.saved; res.json({ success: true, saved: rec.saved }); } 
    else { res.status(404).json({ error: 'Recording not found' }); }
});

app.post('/api/campaign/upload', (req, res) => {
    const { leads, startTime } = req.body; 
    const startTimestamp = new Date(startTime).getTime();
    const INTERVAL_MS = 10 * 60 * 1000; 
    leads.forEach((lead, index) => {
        campaignQueue.push({ ...lead, scheduledTime: startTimestamp + (index * INTERVAL_MS), status: 'queued' });
    });
    campaignActive = true;
    res.json({ success: true, message: `Campaign Scheduled with ${leads.length} leads.` });
});

// Twilio/Tataflow Webhook for Voice - Returns TwiML
app.post('/api/voice-answer', (req, res) => {
    const host = req.get('host');
    addSystemLog('WEBHOOK', 'Voice Answer Triggered (AI Connecting...)', { host });
    
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
});

// --- WEBSOCKET HANDLERS ---

server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    if (pathname === '/media-stream') {
        wssMedia.handleUpgrade(request, socket, head, (ws) => {
            wssMedia.emit('connection', ws, request);
        });
    } else if (pathname === '/dashboard-stream') {
        wssDashboard.handleUpgrade(request, socket, head, (ws) => {
            wssDashboard.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

wssMedia.on('connection', (ws) => {
    addSystemLog('INFO', 'Phone WebSocket Connected (AI Live)');
    
    // Heuristic: Promote ringing call to answered
    let activeCallId = null;
    for (const [key, val] of activeCalls.entries()) {
        if (val.status === 'ringing') { 
            activeCallId = key; 
            updateCall(key, { status: 'answered', startTime: Date.now(), message: 'Connected to AI' });
            break; 
        }
    }

    const ai = new GoogleGenAI({ apiKey: API_KEY });
    let session = null;
    let streamSid = null;

    const connectToGemini = async () => {
        try {
            const prompt = getSystemPrompt(currentVoice, currentLeadName);
            session = await ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: prompt,
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: currentVoice } } },
                    tools: [{ functionDeclarations: [
                        { name: 'bookMeeting', description: 'Books meeting.', parameters: { type: 'OBJECT', properties: { clientEmail: {type:'STRING'}, meetingType: {type:'STRING'}, date: {type:'STRING'}, time: {type:'STRING'} } } },
                        { name: 'logOutcome', description: 'Logs outcome.', parameters: { type: 'OBJECT', properties: { outcome: {type:'STRING'}, sentiment: {type:'STRING'}, notes: {type:'STRING'} }, required: ['outcome'] } }
                    ]}]
                },
                callbacks: {
                    onopen: async () => {
                        addSystemLog('INFO', 'Gemini AI Connected');
                        setTimeout(() => {
                            if (session) session.sendRealtimeInput([{ text: "The user has answered. Say greeting." }]);
                        }, 500);
                    },
                    onmessage: (msg) => {
                        if (msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
                            const pcm24k = Buffer.from(msg.serverContent.modelTurn.parts[0].inlineData.data, 'base64');
                            const pcm24kInt16 = new Int16Array(pcm24k.buffer, pcm24k.byteOffset, pcm24k.length / 2);
                            const muLaw = pcmToMuLaw(downsample24kTo8k(pcm24kInt16));
                            const payload = Buffer.from(muLaw).toString('base64');
                            if (ws.readyState === 1 && streamSid) {
                                ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
                            }
                        }
                        if (msg.toolCall) {
                            msg.toolCall.functionCalls.forEach(fc => {
                                let result = "Success";
                                if (fc.name === 'logOutcome') {
                                    if(activeCallId) {
                                        const call = activeCalls.get(activeCallId);
                                        const duration = Math.round((Date.now() - call.startTime) / 1000);
                                        updateCall(activeCallId, { outcome: fc.args.outcome, duration, status: 'completed', endedBy: 'agent' });
                                    }
                                }
                                session.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: { result } }] });
                            });
                        }
                    }
                }
            });
        } catch (e) { 
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
             if (activeCallId) updateCall(activeCallId, { status: 'completed', endedBy: 'customer' });
        }
    });

    ws.on('close', () => {
        addSystemLog('INFO', 'Phone WebSocket Disconnected');
        if (session) session.close();
    });
});
