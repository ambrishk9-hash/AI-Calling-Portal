
/**
 * SKDM Voice Agent - Live Backend Server
 * 
 * FEATURES:
 * - Telephony: Tata Smartflo API Integration (Click-to-Call, Hangup, Webhooks)
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
const TATA_LOGIN_EMAIL = "Demo.2316"; 
const TATA_LOGIN_PASS = "Admin@11221"; 
const TATA_FROM_NUMBER = "918069651168"; // Virtual DID (Leg B)

// Token Caching
let tataAccessToken = null;
let tokenExpiryTime = 0;

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

let callHistory = [];
let recordings = [];

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
**IDENTITY**: You are "${agentName}" (using voice '${voiceId}'), a senior sales representative for SKDM.
**CONTEXT**: You are on a **LIVE PHONE CALL** with ${leadName}.
**GOAL**: Book a meeting for the Silver Package (₹12,000/month).
**CRITICAL**: Speak immediately upon connection.
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

// --- TATA API WRAPPERS ---
const getTataAccessToken = async () => {
    if (tataAccessToken && Date.now() < tokenExpiryTime) return tataAccessToken;
    if (typeof fetch === 'undefined') try { global.fetch = (await import('node-fetch')).default; } catch (e) {}

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
            return tataAccessToken;
        }
        throw new Error("Tata Auth Failed");
    } catch (error) {
        addSystemLog('ERROR', "Auth Error", error.message);
        throw error;
    }
};

// Trigger Call
const triggerTataCall = async (phone, name, voice, record = false, webhookBaseUrl, localId) => {
    addSystemLog('INFO', `Dialing ${phone}...`, { name, voice });
    
    // Store initial state
    activeCalls.set(localId, {
        id: localId,
        status: 'ringing',
        startTime: null,
        agent: voice,
        leadName: name,
        message: 'Dialing...'
    });
    broadcastStatus({ id: localId, status: 'dialing' });

    try {
        let sanitizedPhone = phone.replace(/\D/g, ''); 
        if (sanitizedPhone.length > 10 && sanitizedPhone.startsWith('91')) sanitizedPhone = sanitizedPhone.substring(2);
        if (sanitizedPhone.length > 10 && sanitizedPhone.startsWith('0')) sanitizedPhone = sanitizedPhone.substring(1);
        
        const agentNumber = TATA_FROM_NUMBER.replace(/\D/g, '');
        const token = await getTataAccessToken();
        
        // Pass localId as custom_identifier so we can map webhooks back
        const payload = {
            "agent_number": sanitizedPhone, // Leg A: Customer
            "destination_number": agentNumber, // Leg B: AI
            "caller_id": agentNumber,
            "async": 1,
            "record": record ? 1 : 0,
            "custom_identifier": localId, 
            "status_callback": `${webhookBaseUrl}/api/webhooks/voice-event`,
            "status_callback_event": ["initiated", "ringing", "answered", "completed"],
            "status_callback_method": "POST"
        };

        const response = await fetch(`${TATA_BASE_URL}/click_to_call`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        
        if (data.success === true || data.status === 'success' || data.uuid || data.ref_id) {
            addSystemLog('SUCCESS', 'Call Queued at Tata', data);
            updateCall(localId, { 
                status: 'ringing', 
                message: 'Phone is ringing...',
                tataUuid: data.uuid || data.request_id || data.ref_id 
            });
        } else {
             addSystemLog('ERROR', 'Tata Rejected Call', data);
             updateCall(localId, { status: 'failed', message: 'Carrier Rejected Call' });
        }
        return data;
    } catch (error) {
        addSystemLog('ERROR', 'Dial Exception', error.message);
        updateCall(localId, { status: 'failed', message: 'Internal Dial Error' });
        return { error: error.message };
    }
};

// Hangup Call
const triggerHangup = async (localId) => {
    const call = activeCalls.get(localId);
    if (!call || !call.tataUuid) return { error: 'Call not found or no UUID' };

    addSystemLog('INFO', `Hanging up call ${localId} (UUID: ${call.tataUuid})`);
    
    // Mark pending hangup by agent
    updateCall(localId, { pendingHangupBy: 'agent', message: 'Ending call...' });

    try {
        const token = await getTataAccessToken();
        const response = await fetch(`${TATA_BASE_URL}/call/hangup`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ call_id: call.tataUuid }) // Tata expects call_id (UUID)
        });
        const data = await response.json();
        addSystemLog('API_RES', 'Hangup Response', data);
        
        // Ensure state is updated even if webhook is slow
        updateCall(localId, { status: 'completed', endedBy: 'agent', message: 'Call Ended (User)' });
        
        return data;
    } catch (e) {
        console.error(e);
        return { error: e.message };
    }
};

// --- ROUTES ---
app.get('/', (req, res) => res.send("SKDM Voice Agent Backend Running."));
app.get('/api/system-logs', (req, res) => res.json(systemLogs));
app.delete('/api/system-logs', (req, res) => { systemLogs = []; res.json({ success: true }); });
app.get('/api/history', (req, res) => res.json(callHistory.reverse()));
app.get('/api/recordings', (req, res) => res.json(recordings));

app.post('/api/dial', async (req, res) => {
    const { phone, name, voice, record } = req.body;
    if (voice) currentVoice = voice;
    if (name) currentLeadName = name;
    
    // Generate Local ID
    const localId = uuidv4();
    
    const host = req.get('host'); 
    const protocol = req.headers['x-forwarded-proto'] || 'https'; 
    const dynamicBaseUrl = `${protocol}://${host}`;

    const data = await triggerTataCall(phone, name, voice, record, dynamicBaseUrl, localId);
    
    if (data.error || (!data.success && !data.uuid && !data.ref_id)) {
        res.status(500).json(data);
    } else {
        res.json({ success: true, callId: localId, ...data });
    }
});

app.post('/api/hangup', async (req, res) => {
    const { callId } = req.body;
    const result = await triggerHangup(callId);
    res.json(result);
});

app.patch('/api/history/:id', (req, res) => {
    const { id } = req.params;
    const { outcome, notes } = req.body;
    const log = callHistory.find(c => c.id === id);
    if (log) {
        log.outcome = outcome;
        log.notes = notes;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Log not found" });
    }
});

// --- ROBUST WEBHOOK HANDLER ---
app.post('/api/webhooks/voice-event', (req, res) => {
    const body = req.body;
    
    // Attempt to identify the call
    const localId = body.custom_identifier || body.ref_id;
    const tataUuid = body.uuid || body.call_id || body.call_uuid;
    const statusRaw = (body.status || body.CallStatus || body.Status || '').toLowerCase();
    
    addSystemLog('WEBHOOK', `Event: ${statusRaw} (Ref: ${localId})`, body);

    if (localId && activeCalls.has(localId)) {
        // Sync Tata UUID if we didn't have it (e.g. from async dial response)
        if (tataUuid) activeCalls.get(localId).tataUuid = tataUuid;

        if (['answered', 'connected', 'in-progress'].includes(statusRaw)) {
            // Check if it's the customer leg answered
            if (body.direction === 'click_to_call' || !activeCalls.get(localId).startTime) {
                 updateCall(localId, { 
                     status: 'connected', 
                     startTime: Date.now(),
                     message: 'Call Answered! Agent active.'
                 });
            }
        } 
        else if (['ringing', 'initiated'].includes(statusRaw)) {
             updateCall(localId, { status: 'ringing', message: 'Phone is ringing...' });
        }
        else if (['completed', 'failed', 'busy', 'no-answer', 'rejected', 'canceled'].includes(statusRaw)) {
             const existing = activeCalls.get(localId);
             
             // Determine who hung up
             let endedBy = existing.pendingHangupBy || 'network';
             if (statusRaw === 'completed' && !existing.pendingHangupBy) {
                 // Assume customer if we didn't initiate hangup
                 endedBy = 'customer'; 
             } else if (statusRaw === 'busy' || statusRaw === 'no-answer') {
                 endedBy = 'unreachable';
             }

             const duration = body.duration ? parseInt(body.duration) : 
                              (existing.startTime ? Math.round((Date.now() - existing.startTime)/1000) : 0);
             
             updateCall(localId, { 
                 status: 'completed', 
                 endedBy, 
                 duration,
                 outcome: endedBy === 'customer' ? 'Call Finished' : 'Failed',
                 message: `Call Ended (${endedBy})`
             });
        }
    }

    res.status(200).send('OK');
});

// TwiML for Audio
app.post('/api/voice-answer', (req, res) => {
    const host = req.get('host');
    const twiml = `<Response><Connect><Stream url="wss://${host}/media-stream" /></Connect></Response>`;
    res.type('text/xml');
    res.send(twiml);
});

// --- SERVER START ---
const server = app.listen(port, () => {
    console.log(`\n🚀 SKDM Backend running on port ${port}`);
});

server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname === '/media-stream') {
        wssMedia.handleUpgrade(request, socket, head, ws => wssMedia.emit('connection', ws, request));
    } else if (pathname === '/dashboard-stream') {
        wssDashboard.handleUpgrade(request, socket, head, ws => wssDashboard.emit('connection', ws, request));
    } else {
        socket.destroy();
    }
});

// --- MEDIA STREAM (GEMINI AI) ---
wssMedia.on('connection', (ws) => {
    addSystemLog('INFO', 'Audio Stream Connected');
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
                        addSystemLog('INFO', 'Gemini AI Ready');
                        setTimeout(() => { if (session) session.sendRealtimeInput([{ text: "Greeting." }]); }, 200);
                    },
                    onmessage: (msg) => {
                        if (msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
                            const pcm24k = Buffer.from(msg.serverContent.modelTurn.parts[0].inlineData.data, 'base64');
                            const pcm24kInt16 = new Int16Array(pcm24k.buffer, pcm24k.byteOffset, pcm24k.length / 2);
                            const muLaw = pcmToMuLaw(downsample24kTo8k(pcm24kInt16));
                            const payload = Buffer.from(muLaw).toString('base64');
                            if (ws.readyState === 1 && streamSid) ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
                        }
                    }
                }
            });
        } catch (e) { console.error(e); }
    };

    connectToGemini();

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        if (data.event === 'start') streamSid = data.start.streamSid;
        if (data.event === 'media' && session) {
            const pcm16k = upsample8kTo16k(muLawToPcm(Buffer.from(data.media.payload, 'base64')));
            session.sendRealtimeInput({ media: { mimeType: 'audio/pcm;rate=16000', data: Buffer.from(pcm16k.buffer).toString('base64') } });
        }
        if (data.event === 'stop') session?.close();
    });
    
    ws.on('close', () => { if (session) session.close(); });
});
