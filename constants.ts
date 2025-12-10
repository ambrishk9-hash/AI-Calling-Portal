
import { FunctionDeclaration, Type } from "@google/genai";

// --- CONFIGURATION ---
const PROD_API = 'https://ai-calling-portal.onrender.com';
// Use 127.0.0.1 instead of localhost to prevent node/browser IPv6 mismatch
const LOCAL_API = 'http://127.0.0.1:3000';

// Determine API URL:
// 1. LocalStorage 'VITE_API_URL' (Allows runtime override via UI)
// 2. Environment Variable VITE_API_URL
// 3. Fallback to LOCAL_API
const storedUrl = typeof window !== 'undefined' ? window.localStorage.getItem('VITE_API_URL') : null;
export const API_BASE_URL = (storedUrl || (import.meta as any).env?.VITE_API_URL || LOCAL_API).replace(/\/$/, '');

export type PitchStrategy = 'BALANCED' | 'SEO_FOCUS' | 'ADS_FOCUS';
export type LanguageMode = 'ENGLISH' | 'HINGLISH';

export const VOICE_OPTIONS = [
  { id: 'Puck', name: 'Raj (Male, Energetic - Puck)' },
  { id: 'Kore', name: 'Priya (Female, Calm - Kore)' },
  { id: 'Fenrir', name: 'Vikram (Male, Deep - Fenrir)' },
  { id: 'Charon', name: 'Arjun (Male, Authoritative - Charon)' },
  { id: 'Aoede', name: 'Ananya (Female, Expressive - Aoede)' },
];

export const GET_SYSTEM_PROMPT = (strategy: PitchStrategy, language: LanguageMode, voiceId: string = 'Puck') => {
  const agentMap: Record<string, string> = {
    'Puck': 'Raj',
    'Kore': 'Priya',
    'Fenrir': 'Vikram',
    'Charon': 'Arjun',
    'Aoede': 'Ananya'
  };
  const agentName = agentMap[voiceId] || 'Raj';

  return `
**IDENTITY**: You are "${agentName}", a senior sales representative for SKDM (Shree Krishna Digital Marketing).
**CONTEXT**: You are on a **LIVE PHONE CALL** with a potential client.
**GOAL**: Book a meeting for the Silver Package (₹12,000/month).

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

3.  **🛡️ AUTHORITY MODE (Trust / Closing)**
    *   **Trigger**: When asked "Guarantee kya hai?" or trying to book the specific time.
    *   **Vocal Style**: Steady, firm, precise. No filler words.

**LANGUAGE SETTINGS: ${language}**:
${language === 'HINGLISH' ? `
-   **MUMBAI-STYLE CODE-SWITCHING**: You speak "Hinglish" - a natural mix of Hindi and English used in Indian business.
-   **RULES**:
    1.  **Technical Terms**: ALWAYS use English (e.g., "ROI", "SEO", "Website", "Traffic", "Package").
    2.  **Verbs/Connectors**: Use Hindi (e.g., "kar sakte hai", "samajh sakta hu", "bataiye").
    3.  **Example**: "Sir, aapka **business potential** kaafi high hai, lekin **online visibility** thodi weak lag rahi hai. Humara **Silver Package** aapki **leads** double kar sakta hai."
    4.  **NEVER** speak pure/formal Hindi. Keep it conversational and professional.
` : `
-   **PROFESSIONAL INDIAN ENGLISH**: Speak clear, professional English with an Indian context. 
-   **Example**: "I completely understand your concern about the budget, sir."
`}

**STRATEGY (${strategy})**:
- **Opening**: "Namaste [Name], SKDM se ${agentName} baat kar raha/rahi hu. I saw your business online—kaafi potential hai!"
- **The Hook**: "Currently aap leads ke liye kya use kar rahe ho? Ads ya Organic?"
- **The Pitch**: "Hamara 360° Silver Package hai. SEO, GMB, Social Media, sab kuch included. Sirf ₹12,000 monthly."
- **Objection Handling (Price)**: Switch to **EMPATHY MODE**. "Samajh sakta/sakti hu sir. But ROI dekhiye. Ek client convert hua toh cost recover."
- **Closing**: "Kya hum next Tuesday ek 15-min ka Google Meet schedule kar sakte hai?"

**TOOLS**: 
- Use 'bookMeeting' if they agree. **Ask for Email** and **Meeting Type**.
- Always use 'logOutcome' to record the call result.
`;
};

export const BOOK_MEETING_TOOL: FunctionDeclaration = {
  name: 'bookMeeting',
  description: 'Books a follow-up meeting (Google Meet or Visit) and sends invite to Client and Company Email.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      clientName: { type: Type.STRING, description: 'Name of the client' },
      clientEmail: { type: Type.STRING, description: 'Client email address for the calendar invite' },
      meetingType: { type: Type.STRING, enum: ['Google Meet', 'Office Visit'], description: 'Type of meeting' },
      date: { type: Type.STRING, description: 'Proposed date (e.g. "next Tuesday")' },
      time: { type: Type.STRING, description: 'Proposed time' },
      notes: { type: Type.STRING, description: 'Meeting focus/notes' }
    },
    required: ['clientName', 'clientEmail', 'meetingType', 'date', 'time'],
  },
};

export const LOG_OUTCOME_TOOL: FunctionDeclaration = {
  name: 'logOutcome',
  description: 'Logs the call outcome to Tata Broadband/CRM.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      outcome: { type: Type.STRING, enum: ['Meeting Booked', 'Follow-up', 'Not Interested', 'Voicemail', 'Call Later'] },
      sentiment: { type: Type.STRING, enum: ['Positive', 'Neutral', 'Negative'] },
      notes: { type: Type.STRING, description: 'Summary of the call' }
    },
    required: ['outcome', 'sentiment', 'notes'],
  },
};

export const TRANSFER_CALL_TOOL: FunctionDeclaration = {
  name: 'transferCall',
  description: 'Transfers the call to a human supervisor/expert.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      reason: { type: Type.STRING, description: 'Reason for transfer (e.g., "User requested human", "Complex query")' }
    },
    required: ['reason'],
  },
};

export const MOCK_LEADS = [
  { id: '1', name: 'Dr. Amit Patel', businessName: 'Smile Care Dental Clinic', phone: '+91 98765 43210', email: 'amit@smilecare.com', source: 'GMB', status: 'Pending' },
  { id: '2', name: 'Rohan Verma', businessName: 'Verma Real Estate', phone: '+91 99887 76655', email: 'rohan@vermaestates.in', source: 'CSV', status: 'Called', lastCallDuration: '4m 12s' },
  { id: '3', name: 'Sneha Gupta', businessName: 'Gupta Interiors', phone: '+91 88990 01122', email: 'info@guptainteriors.com', source: 'Manual', status: 'Pending' },
  { id: '4', name: 'Rajesh Kumar', businessName: 'Kumar Electronics', phone: '+91 91234 56789', email: 'rajesh@kumar.com', source: 'GMB', status: 'Converted', notes: 'Booked Silver Package' },
  { id: '5', name: 'Anita Desai', businessName: 'Desai Law Firm', phone: '+91 77665 54433', email: 'anita@desailaw.com', source: 'GMB', status: 'Pending' },
];
