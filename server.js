
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

// Token Caching
const TATA_LOGIN_EMAIL = "Demo.2316"; 
const TATA_LOGIN_PASS = "Admin@11221"; 
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

// --- TATA API WRAPPERS ---
const getTataAccessToken = async () => {
    if (tataAccessToken && Date.now() < tokenExpiryTime) return tataAccessToken;
    if (typeof fetch === 'undefined') try { global.fetch = (await import('node-fetch')).default; } catch (e) {}

    try {
        addSystemLog('INFO', "Authenticating with Tata Smartflo (JWT)...");
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
        throw new Error("Tata JWT Auth Failed");
    } catch (error) {
        addSystemLog('ERROR', "Auth Error", error.message);
        throw error;
    }
};

// Trigger Call (Updated for Support API + API Key)
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
        // Sanitize