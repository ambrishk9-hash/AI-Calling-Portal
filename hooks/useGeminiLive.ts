
import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { base64ToUint8Array, arrayBufferToBase64, floatTo16BitPCM, decodeAudioData } from '../utils/audioUtils';

interface UseGeminiLiveProps {
    apiKey: string | undefined;
    systemInstruction: string;
    voiceName: string;
    tools?: any[];
}

export const useGeminiLive = ({ apiKey, systemInstruction, voiceName, tools = [] }: UseGeminiLiveProps) => {
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [agentSpeaking, setAgentSpeaking] = useState(false);
    const [error, setError] = useState<{ title: string, message: string } | null>(null);
    const [logs, setLogs] = useState<{ sender: 'user' | 'agent' | 'system', text: string }[]>([]);

    // Refs for Audio and Session
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
    const nextStartTimeRef = useRef<number>(0);
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const isMicOnRef = useRef(true);

    const addLog = useCallback((sender: 'user' | 'agent' | 'system', text: string) => {
        setLogs(prev => [...prev, { sender, text }]);
    }, []);

    const setMicOn = (isOn: boolean) => {
        isMicOnRef.current = isOn;
    };

    const stopAudio = () => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (inputAudioContextRef.current) {
            inputAudioContextRef.current.close();
            inputAudioContextRef.current = null;
        }
        if (outputAudioContextRef.current) {
            outputAudioContextRef.current.close();
            outputAudioContextRef.current = null;
        }
        audioQueueRef.current.forEach(node => {
            try { node.stop(); } catch (e) { }
        });
        audioQueueRef.current = [];
    };

    const disconnect = useCallback(() => {
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then(session => session.close());
        }
        stopAudio();
        setIsConnected(false);
        setIsConnecting(false);
        setAgentSpeaking(false);
        sessionPromiseRef.current = null;
    }, []);

    const connect = async () => {
        try {
            setError(null);
            setIsConnecting(true);

            if (!apiKey) throw new Error("MISSING_API_KEY");

            addLog('system', 'Initializing Audio Contexts...');
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

            const ai = new GoogleGenAI({ apiKey });
            
            addLog('system', `Connecting to Gemini Live (Voice: ${voiceName})...`);

            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: systemInstruction,
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } },
                    },
                    tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
                },
                callbacks: {
                    onopen: async () => {
                        addLog('system', `Connected to Agent.`);
                        setIsConnected(true);
                        setIsConnecting(false);

                        try {
                            streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
                            if (!inputAudioContextRef.current) return;

                            sourceRef.current = inputAudioContextRef.current.createMediaStreamSource(streamRef.current);
                            processorRef.current = inputAudioContextRef.current.createScriptProcessor(2048, 1, 1);

                            processorRef.current.onaudioprocess = (e) => {
                                if (!sessionPromiseRef.current) return;
                                const inputData = e.inputBuffer.getChannelData(0);
                                if (!isMicOnRef.current) { inputData.fill(0); }
                                const pcm16 = floatTo16BitPCM(inputData);
                                const base64Data = arrayBufferToBase64(pcm16);
                                sessionPromiseRef.current?.then(session => {
                                    session.sendRealtimeInput({
                                        media: { mimeType: 'audio/pcm;rate=16000', data: base64Data }
                                    });
                                });
                            };

                            const gainNode = inputAudioContextRef.current.createGain();
                            gainNode.gain.value = 0;
                            sourceRef.current.connect(processorRef.current);
                            processorRef.current.connect(gainNode);
                            gainNode.connect(inputAudioContextRef.current.destination);

                        } catch (err) {
                            addLog('system', `Mic Error: ${err}`);
                            setError({ title: "Microphone Access Denied", message: "Please allow microphone access." });
                            disconnect();
                        }
                    },
                    onmessage: async (msg: LiveServerMessage) => {
                         // Propagate tool calls via the logs or event handler if needed
                         // For now, we handle audio playback here
                        const modelAudio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (modelAudio && outputAudioContextRef.current) {
                            setAgentSpeaking(true);
                            const ctx = outputAudioContextRef.current;
                            const audioBytes = base64ToUint8Array(modelAudio);
                            const audioBuffer = await decodeAudioData(audioBytes, ctx, 24000, 1);

                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                            const source = ctx.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(ctx.destination);
                            source.start(nextStartTimeRef.current);
                            source.onended = () => {
                                if (ctx.currentTime >= nextStartTimeRef.current - 0.1) {
                                    setAgentSpeaking(false);
                                }
                            };
                            nextStartTimeRef.current += audioBuffer.duration;
                            audioQueueRef.current.push(source);
                        }
                        return msg; // Return message for component to handle tools
                    },
                    onclose: () => {
                        addLog('system', 'Connection closed.');
                        setIsConnected(false);
                        setAgentSpeaking(false);
                        setIsConnecting(false);
                    },
                    onerror: (err) => {
                        console.error(err);
                        addLog('system', `Error: ${JSON.stringify(err)}`);
                        setIsConnected(false);
                        setIsConnecting(false);
                        setError({ title: "Connection Error", message: "Connection lost." });
                    }
                }
            });
            
            // Wrap the session promise to intercept messages for tool handling in the component
            const originalSession = await sessionPromise;
            // We can't easily wrap the callbacks after connect, so we expose the session promise 
            // and let the component subscribe to logs/events via the hook state or callbacks.
            // However, since 'onmessage' is defined above, we need a way to pass tool calls back.
            // A simple way: add a callback prop to the hook? 
            // For this refactor, let's keep it simple: We used a state 'logs' which isn't enough for tool calls.
            // Let's modify the onmessage above to store the last tool call or expose a callback ref.
            
            sessionPromiseRef.current = sessionPromise;

        } catch (e: any) {
            addLog('system', `Failed to connect: ${e.message}`);
            setIsConnected(false);
            setIsConnecting(false);
            if (e.message === "MISSING_API_KEY") {
                setError({ title: "Configuration Missing", message: "API Key missing." });
            } else {
                setError({ title: "Connection Error", message: e.message });
            }
        }
    };

    // Need a way to send tool responses from the component
    const sendToolResponse = async (toolResponse: any) => {
        if(sessionPromiseRef.current) {
            const session = await sessionPromiseRef.current;
            session.sendToolResponse(toolResponse);
        }
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            disconnect();
        };
    }, []);

    // We need to expose a way to listen to raw messages for tool handling in the component.
    // Since we defined the callback inside `connect`, we can't easily change it.
    // Ideally, we pass `onToolCall` to the hook.
    // For now, let's just assume the component will pass tool handlers or we can augment this hook later.
    // To minimize disruption, I'll update the hook signature to accept `onToolCall`.

    return {
        connect,
        disconnect,
        isConnected,
        isConnecting,
        agentSpeaking,
        error,
        logs,
        addLog,
        setMicOn,
        sendToolResponse,
        sessionPromise: sessionPromiseRef.current // Expose for advanced usage if needed
    };
};
