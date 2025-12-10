
import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../constants';

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'error';

export const useDashboardSocket = (urlOverride?: string) => {
    const [status, setStatus] = useState<SocketStatus>('closed');
    const [lastMessage, setLastMessage] = useState<any>(null);
    
    // Refs for connection management to handle cleanup and retries independent of render cycles
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<number | null>(null);
    const retryCountRef = useRef(0);
    const isMountedRef = useRef(true);
    
    // Determine effective URL
    const url = urlOverride || API_BASE_URL;

    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    const connect = useCallback(() => {
        // Avoid redundant connection attempts if already connected or connecting
        if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
            return;
        }

        if (!url) return;

        // Calculate correct WebSocket URL (wss for https, ws for http)
        let wsUrl = '';
        try {
            const cleanUrl = url.replace(/\/$/, '');
            if (!cleanUrl.startsWith('http')) {
                const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
                wsUrl = `${protocol}://${cleanUrl}/dashboard-stream`;
            } else {
                const protocol = cleanUrl.startsWith('https') ? 'wss' : 'ws';
                wsUrl = cleanUrl.replace(/^https?/, protocol) + '/dashboard-stream';
            }
        } catch (e) {
            console.error("[DashboardSocket] Invalid URL:", url);
            setStatus('error');
            return;
        }

        try {
            const ws = new WebSocket(wsUrl);
            setStatus('connecting');

            ws.onopen = () => {
                if (!isMountedRef.current) {
                    ws.close();
                    return;
                }
                console.log("[DashboardSocket] Connected");
                setStatus('open');
                retryCountRef.current = 0; // Reset retries on successful connection
            };

            ws.onmessage = (event) => {
                if (!isMountedRef.current) return;
                try {
                    const data = JSON.parse(event.data);
                    setLastMessage(data);
                } catch (e) {
                    // Ignore parse errors or non-JSON messages
                }
            };

            ws.onclose = (event) => {
                if (!isMountedRef.current) return;
                
                setStatus('closed');
                wsRef.current = null;

                // Exponential backoff logic
                const baseDelay = 1000;
                const maxDelay = 30000;
                // Delay = base * 2^retries, capped at maxDelay
                const delay = Math.min(baseDelay * Math.pow(2, retryCountRef.current), maxDelay);
                
                console.log(`[DashboardSocket] Disconnected (Code: ${event.code}). Reconnecting in ${Math.round(delay/1000)}s...`);
                
                retryCountRef.current++;
                
                if (reconnectTimeoutRef.current) {
                    window.clearTimeout(reconnectTimeoutRef.current);
                }
                reconnectTimeoutRef.current = window.setTimeout(connect, delay);
            };

            ws.onerror = (event) => {
                if (!isMountedRef.current) return;
                console.error("[DashboardSocket] Connection Error");
                // onError is usually followed by onClose, so we let onClose handle the retry scheduling
                setStatus('error');
            };

            wsRef.current = ws;

        } catch (err) {
            console.error("[DashboardSocket] Setup failed:", err);
            setStatus('error');
            // Schedule a retry if synchronous setup fails
            retryCountRef.current++;
            const delay = 5000;
            if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = window.setTimeout(connect, delay);
        }
    }, [url]);

    useEffect(() => {
        retryCountRef.current = 0; // Reset retries if the URL changes
        connect();

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
                window.clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, [connect]);

    return { status, lastMessage };
};
