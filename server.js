
/**
 * SKDM Voice Agent - Live Backend Server
 * 
 * FEATURES:
 * - Voice: Dynamic Selection (Default 'Puck')
 * - Scheduler: 10-minute interval algorithm for campaigns
 * - Integrations: Google Calendar (Mock), Tata Broadband Logging
 * - Telephony: Tata Smartflo API Integration (Dynamic Auth)
 * - Analytics: Real-time stats and call logging
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Enable All CORS Requests
app.use(cors({ origin: '*' }));
app.use(express.json());

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

// Default Voice (Fallback)
let currentVoice = 'Puck'; 

// --- ANALYTICS STORAGE (IN-MEMORY) ---
let callHistory = [
    { id: 'mock-1', leadName: 'Dr. Amit Patel', duration: 145, outcome: 'Meeting Booked', sentiment: 'Positive', timestamp: Date.now() - 3600000 },
    { id: 'mock-2', leadName: 'Rohan Verma', duration: 45, outcome: 'Not Interested', sentiment: 'Neutral', timestamp: Date.now() - 7200000 },
    { id: 'mock-3', leadName: 'Sneha Gupta', duration: 80, outcome: 'Follow-up', sentiment: 'Positive', timestamp: Date.now() - 10800000 },
    { id: 'mock-4', leadName: 'Rajesh Kumar', duration: 12, outcome: 'Voicemail', sentiment: 'Negative', timestamp: Date.now() - 86400000 },
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
    
    try {
        console.log("🔐 Authenticating with Tata Smartflo...");
        // Use global fetch (Node 18+)
        const response = await fetch(`${TATA_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ "email": TATA_LOGIN_EMAIL, "password": TATA_LOGIN_PASS })
        });

        const data = await response.json();
        if (response.ok && data.access_token) {
            tataAccessToken = data.access_token;
            tokenExpiryTime = Date.now() + (55 * 60 * 1000);
            console.log("✅ Tata Login Successful.");
            return tataAccessToken;
        } else {
            console.error("❌ Tata Login Failed:", data);
            throw new Error("Failed to authenticate with Tata Smartflo");
        }
    } catch (error) {
        console.error("❌ Auth Request Error:", error);
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

const triggerTataCall = async (phone, name, voice) => {
    console.log(`🚀 Preparing Call to ${phone}...`);
    try {
        const token = await getTataAccessToken();
        const response = await fetch(`${TATA_BASE_URL}/click_to_call`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                "agent_number": TATA_FROM_NUMBER,
                "destination_number": phone,
                "caller_id": TATA_FROM_NUMBER,
                "async": 1 
            })
        });
        const data = await response.json();
        console.log('✅ Tata API Response:', data);
        return data;
    } catch (error) {
        console.error('❌ Tata API Error:', error);
        return { error: error.message };
    }
};

// --- API ENDPOINTS ---

app.get('/', (req, res) => {
    res.send("SKDM Voice Agent Backend Running. Use /api/dial to initiate calls.");
});

// Analytics Endpoint
app.get('/api/stats', (req, res) => {
    const totalCalls = callHistory.length;
    const meetings = callHistory.filter(c => c.outcome === 'Meeting Booked').length;
    
    // Calculate Average Duration
    const totalDuration = callHistory.reduce((acc, curr) => acc + (curr.duration || 0), 0);
    const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
    const avgMin = Math.floor(avgDuration / 60);
    const avgSec = avgDuration % 60;

    // Simple Chart Data
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
    const { phone, name, voice } = req.body;
    if (voice) currentVoice = voice;
    
    try {
        const data = await triggerTataCall(phone, name, voice);
        res.json({ success: true, callId: data?.uuid || 'queued' });
    } catch (e) {
        res.status(500).json({ error: e.message });
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

app.post('/api/voice-answer', (req, res) => {
    const host = req.get('host');
    const twiml = `<Response><Connect><Stream url="wss://${host}/media-stream" /></Connect></Response>`;
    res.type('text/xml');
    res.send(twiml);
});

const server = app.listen(port, () => {
    console.log(`\n🚀 SKDM Backend running on port ${port}`);
    console.log(`🔗 Open http://localhost:${port} to verify status.`);
});

// --- WEBSOCKET (LIVE AI) ---
const wss = new WebSocketServer({ server, path: '/media-stream' });

wss.on('connection', (ws) => {
    console.log('🔌 Phone Call Connected');
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
                    onopen: () => console.log("🤖 Gemini Connected"),
                    onmessage: (msg) => {
                        if (msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
                            // Audio Transcoding Logic
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
                                    // SAVE TO DATABASE (In-Memory for now)
                                    const duration = Math.round((Date.now() - callStartTime) / 1000);
                                    callHistory.push({
                                        id: `call-${Date.now()}`,
                                        leadName: 'Customer', 
                                        timestamp: Date.now(),
                                        duration: duration,
                                        outcome: fc.args.outcome,
                                        sentiment: fc.args.sentiment || 'Neutral'
                                    });
                                    console.log("📝 Call Logged:", fc.args);
                                }
                                session.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: { result } }] });
                            });
                        }
                    }
                }
            });
        } catch (e) { console.error("Gemini Error", e); }
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
});
