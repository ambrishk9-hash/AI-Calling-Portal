
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
import http from 'http';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Create HTTP Server for WebSocket Upgrades
const server = http.createServer(app);

// Enable All CORS Requests
app.use(cors({ 
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURATION ---
const API_KEY = process.env.API_KEY;

// --- TATA SMARTFLO CREDENTIALS ---
const TATA_BASE_URL = "https://api-smartflo.tatateleservices.com/v1";
const TATA_C2C_API_KEY = "5ce3c167-2f36-497c-8f52-b74b7ef54c8c"; 

// Active Calls Map
const activeCalls = new Map();

// Global Context
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
    // Broadcast logs to dashboard
    broadcastEvent({ type: 'log', log });
};

let callHistory = [
    { id: 'mock-1', leadName: 'Dr. Amit Patel', duration: 145, outcome: 'Meeting Booked', sentiment: 'Positive', timestamp: Date.now() - 3600000, notes: 'Interested in Silver Package' },
];

// Mock Recordings
let recordings = [
    { id: 'rec-mock-1', leadName: 'Dr. Amit Patel', type: 'Outgoing', duration: 145, timestamp: new Date(Date.now() - 3600000).toISOString(), saved: true, url: '#' }
];

// --- WEBSOCKET SERVERS SETUP ---
const wssMedia = new WebSocketServer({ noServer: true });
const wssDashboard = new WebSocketServer({ noServer: true });

// Handle Upgrades
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

// Broadcast to Dashboard
const broadcastEvent = (payload) => {
    const msg = JSON.stringify(payload);
    wssDashboard.clients.forEach(client => {
        if (client.readyState === 1) client.send(msg);
    });
};

const broadcastStatus = (payload) => {
    broadcastEvent({ type: 'status_update', ...payload });
};

const broadcastTranscript = (id, sender, text) => {
    broadcastEvent({ type: 'transcript', id, sender, text });
};

// --- HELPER FUNCTIONS ---
const getAgentName = (voiceId) => {
    const map = { 'Puck': 'Raj', 'Kore': 'Priya', 'Fenrir': 'Vikram', 'Charon': 'Arjun', 'Aoede': 'Ananya' };
    return map[voiceId] || 'Raj';
};

const getSystemPrompt = (voiceId, leadName) => {
    const agentName = getAgentName(voiceId);
    return `
**IDENTITY**: You are "${agentName}" (Voice: ${voiceId}), a senior sales representative for SKDM (Shree Krishna Digital Marketing).
**CONTEXT**: You are on a **LIVE PHONE CALL** with ${leadName}.
**GOAL**: Book a meeting for the Silver Package (₹12,000/month).

**CRITICAL INSTRUCTION**: 
1. The user has just answered the phone.
2. YOU MUST SPEAK IMMEDIATELY. Do not wait for them.
3. Start with: "Namaste ${leadName}, SKDM se ${agentName} baat kar raha hu. Kaise hain aap?"

**STYLE**: 
- Speak Hinglish (Hindi + English Business terms).
- High Energy and Professional.
- Keep responses short (under 10 seconds) as this is a phone call.
`;
};

// Audio Utils (MuLaw <-> PCM)
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

// Audio Resampling
const upsample8kTo16k = (pcm8k) => {
    const pcm16k = new Int16Array(pcm8k.length * 2);
    for (let i = 0; i < pcm8k.length; i++) {
        pcm16k[i * 2] = pcm8k[i];
        pcm16k[i * 2 + 1] = pcm8k[i]; // Simple duplication for speed
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

// --- MEDIA STREAM HANDLER (THE BRIDGE) ---
wssMedia.on('connection', (ws) => {
    addSystemLog('INFO', 'New Media Stream Connection from Phone');

    const aiClient = new GoogleGenAI({ apiKey: API_KEY });
    let session = null;
    let streamSid = null;
    let callId = null; // We will try to extract this from custom params if possible
    let isSessionReady = false;
    let audioBuffer = []; // Buffer phone audio until AI is ready

    // Initialize Gemini Session
    const startGemini = async () => {
        try {
            session = await aiClient.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: getSystemPrompt(currentVoice, currentLeadName),
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: currentVoice } },
                    },
                    inputAudioTranscription: { model: "google_speech_v2" }, // Enable User Transcript
                    outputAudioTranscription: { model: "google_speech_v2" } // Enable Agent Transcript
                },
                callbacks: {
                    onopen: () => {
                        addSystemLog('SUCCESS', 'Gemini AI Connected');
                        isSessionReady = true;

                        // CRITICAL: Force the model to speak immediately by sending a hidden text command
                        // This solves the "Silence" issue.
                        session.sendRealtimeInput([{ text: "Hello" }]);
                        
                        // Flush buffered audio
                        if (audioBuffer.length > 0) {
                             addSystemLog('INFO', `Flushing ${audioBuffer.length} buffered audio packets`);
                             audioBuffer.forEach(chunk => session.sendRealtimeInput({ media: chunk }));
                             audioBuffer = [];
                        }
                    },
                    onmessage: (msg) => {
                        // 1. Handle Audio Output (Voice)
                        const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (audioData) {
                            const pcm24k = Buffer.from(audioData, 'base64');
                            const pcm16kInt16 = new Int16Array(pcm24k.buffer, pcm24k.byteOffset, pcm24k.length / 2);
                            
                            // Resample 24k -> 8k for Phone
                            const pcm8k = downsample24kTo8k(pcm16kInt16);
                            const muLaw = pcmToMuLaw(pcm8k);
                            const payload = Buffer.from(muLaw).toString('base64');

                            // Send to Phone
                            if (ws.readyState === 1 && streamSid) {
                                const mediaMessage = {
                                    event: 'media',
                                    streamSid: streamSid,
                                    media: { payload: payload }
                                };
                                ws.send(JSON.stringify(mediaMessage));
                            }
                        }

                        // 2. Handle Transcription (Text) for UI
                        // User Transcript
                        const inputTranscript = msg.serverContent?.inputTranscription?.text;
                        if (inputTranscript) {
                             addSystemLog('INFO', `User said: ${inputTranscript}`);
                             // We need a callId to broadcast. If we don't have one, we broadcast to all (demo mode)
                             // or look up the most recent active call.
                             const activeId = getActiveCallId();
                             if (activeId) broadcastTranscript(activeId, 'user', inputTranscript);
                        }

                        // Agent Transcript
                        const outputTranscript = msg.serverContent?.outputTranscription?.text;
                        if (outputTranscript) {
                             // addSystemLog('INFO', `Agent said: ${outputTranscript}`); // Optional: Too noisy
                             const activeId = getActiveCallId();
                             if (activeId) broadcastTranscript(activeId, 'agent', outputTranscript);
                        }
                    },
                    onclose: () => {
                        addSystemLog('INFO', 'Gemini AI Disconnected');
                    },
                    onerror: (err) => {
                        addSystemLog('ERROR', 'Gemini AI Error', err);
                    }
                }
            });
        } catch (e) {
            addSystemLog('ERROR', 'Failed to Init Gemini', e.message);
            ws.close();
        }
    };

    startGemini();

    // Handle Messages from Phone (Tata/Twilio)
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.event === 'start') {
                streamSid = data.start.streamSid;
                callId = data.start.customParameters?.callId; // If passed by Tata
                addSystemLog('INFO', `Media Stream Started: ${streamSid}`);
                
                // Reset buffer on new stream start
                audioBuffer = [];
            } 
            else if (data.event === 'media') {
                if (!isSessionReady) {
                    // Buffer audio if AI isn't ready
                    const chunk = { mimeType: 'audio/pcm;rate=16000', data: convertPayload(data.media.payload) };
                    audioBuffer.push(chunk);
                } else {
                    // Send directly
                    const base64Data = convertPayload(data.media.payload);
                    session.sendRealtimeInput({
                        media: { mimeType: 'audio/pcm;rate=16000', data: base64Data }
                    });
                }
            }
            else if (data.event === 'stop') {
                addSystemLog('INFO', 'Media Stream Stopped');
                if (session) session.close();
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => {
        addSystemLog('INFO', 'Phone Connection Closed');
        if (session) session.close();
    });
});

// Helper: Convert MuLaw Base64 (Phone) to PCM16 Base64 (Gemini)
const convertPayload = (base64Payload) => {
    const muLawBuffer = Buffer.from(base64Payload, 'base64');
    const pcm8k = muLawToPcm(muLawBuffer);
    const pcm16k = upsample8kTo16k(pcm8k);
    return Buffer.from(pcm16k.buffer).toString('base64');
};

const getActiveCallId = () => {
    // Return the ID of the most recently created 'answered' or 'ringing' call
    for (let [key, val] of activeCalls.entries()) {
        if (val.status === 'answered' || val.status === 'ringing') return key;
    }
    return null;
};

// --- HTTP API ---

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

        // Generate Mock Recording
        if ((updated.duration || 0) > 2) {
             recordings.push({
                id: `rec-${localId}`,
                leadName: updated.leadName || 'Customer',
                type: 'Outgoing',
                timestamp: updated.startTime || new Date().toISOString(),
                duration: updated.duration || 0,
                url: '#',
                saved: false
             });
        }
    }
};

// TwiML/XML Endpoint for Tata to connect to WebSocket
app.all('/api/voice-answer', (req, res) => {
    const host = req.headers.host; // e.g. ai-calling-portal.onrender.com or localhost:3000
    // Determine protocol: if localhost use ws, else wss
    const protocol = host.includes('localhost') || host.includes('127.0.0.1') ? 'ws' : 'wss';
    const streamUrl = `${protocol}://${host}/media-stream`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Connecting you to the AI agent.</Say>
    <Connect>
        <Stream url="${streamUrl}" />
    </Connect>
</Response>`;

    res.type('text/xml');
    res.send(twiml);
});

// Dial Endpoint
app.post('/api/dial', async (req, res) => {
    const { phone, name, voice } = req.body;
    if (voice) currentVoice = voice;
    if (name) currentLeadName = name;

    const localId = `call-${Date.now()}`;
    const host = req.get('host'); 
    
    addSystemLog('INFO', `Dialing ${phone}...`, { name, voice });
    
    activeCalls.set(localId, {
        id: localId,
        status: 'dialing',
        startTime: new Date().toISOString(),
        agent: voice,
        leadName: name,
        message: 'Dialing Customer...'
    });
    broadcastStatus({ id: localId, status: 'dialing' });

    try {
        let sanitizedPhone = phone.replace(/\D/g, ''); 
        if (sanitizedPhone.length === 10) sanitizedPhone = '91' + sanitizedPhone;
        
        const apiUrl = `${TATA_BASE_URL}/click_to_call_support`;
        
        const payload = {
            "async": 1,
            "customer_number": sanitizedPhone,
            "api_key": TATA_C2C_API_KEY,
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (data.success === true || (data.message && data.message.toLowerCase().includes('queued'))) {
            addSystemLog('SUCCESS', 'Tata API Accepted Call', data);
            const tataUuid = data.uuid || data.request_id;
            updateCall(localId, { tataUuid, status: 'ringing', message: 'Ringing Customer...' });
            res.json({ success: true, callId: localId });
        } else {
             addSystemLog('ERROR', 'Tata API Rejected Call', data);
             updateCall(localId, { status: 'failed', message: `Failed: ${data.message}` });
             res.status(400).json({ error: data.message });
        }
    } catch (error) {
        addSystemLog('ERROR', 'Dial Request Exception', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Campaign Upload Endpoint
app.post('/api/campaign/upload', (req, res) => {
    const { leads, startTime } = req.body;
    addSystemLog('INFO', `Received Campaign: ${leads.length} leads`, { startTime });
    res.json({ success: true, message: `Campaign scheduled for ${leads.length} leads.` });
});

// Recordings Endpoints
app.get('/api/recordings', (req, res) => res.json(recordings));

app.delete('/api/recordings/:id', (req, res) => {
    const id = req.params.id;
    recordings = recordings.filter(r => r.id !== id);
    addSystemLog('INFO', `Recording deleted: ${id}`);
    res.json({ success: true });
});

app.post('/api/recordings/:id/save', (req, res) => {
    const id = req.params.id;
    const rec = recordings.find(r => r.id === id);
    if (rec) {
        rec.saved = !rec.saved;
        res.json({ success: true, saved: rec.saved });
    } else {
        res.status(404).json({ error: 'Recording not found' });
    }
});

app.get('/api/system-logs', (req, res) => res.json(systemLogs));
app.delete('/api/system-logs', (req, res) => { systemLogs = []; res.json({ success: true }); });
app.get('/api/history', (req, res) => res.json(callHistory.reverse()));
app.get('/api/stats', (req, res) => res.json({ metrics: [], chartData: [], recentCalls: callHistory.slice(-5) }));

app.post('/api/hangup', (req, res) => {
    const { callId } = req.body;
    updateCall(callId, { status: 'completed', endedBy: 'agent' });
    res.json({ success: true });
});

// Start Server
server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    addSystemLog('INFO', `Server Started on port ${port}`);
});
