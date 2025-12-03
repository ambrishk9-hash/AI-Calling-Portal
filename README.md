
# SKDM Voice Agent - Setup Guide

## 1. Project Structure
- **Frontend**: React App (`App.tsx`, `components/`) - Runs on browser.
- **Backend**: `server.js` - Runs on Node.js. Handles Tataflow/Twilio calls.

## 2. Setup Backend (For Live Calls)
1. Initialize project:
   ```bash
   npm init -y
   npm install express ws @google/genai dotenv cors
   ```
2. Create `.env` file:
   ```env
   API_KEY=your_gemini_api_key
   PORT=3000
   ```
3. Run Server:
   ```bash
   node server.js
   ```
4. Expose to Internet (for Tataflow):
   ```bash
   ngrok http 3000
   ```
   Copy the WebSocket URL (e.g., `wss://<id>.ngrok.io`) and configure it in your Tataflow console as the Media Stream URL.

## 3. Frontend Usage
- Open the React app.
- Go to "Lead Management" -> "Live Dialer".
- Enter a phone number and click "Call". This sends a request to your local backend to trigger the real call.
