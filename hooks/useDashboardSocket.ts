
import { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../constants';

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'error';

export const useDashboardSocket = (urlOverride?: string) => {
    const [status, setStatus] = useState<SocketStatus>('closed');
    const [lastMessage, setLastMessage] = useState<any>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<number | null>(null);
    
    const url = urlOverride || API_BASE_URL;

    useEffect(() => {
        const connect = () => {
            const cleanUrl = url.replace(/\/$/, '');
            const wsUrl = cleanUrl.replace(/^http/, 'ws') + '/dashboard-stream';
            
            // Close existing if open
            if (wsRef.current) {
                wsRef.current.close();
            }

            console.log("Connecting to Dashboard Socket:", wsUrl);
            const ws = new WebSocket(wsUrl);
            setStatus('connecting');

            ws.onopen = () => {
                console.log("Dashboard Socket Open");
                setStatus('open');
            };
            
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    setLastMessage(data);
                } catch(e) { 
                    console.error("Socket parse error", e); 
                }
            };

            ws.onclose = () => {
                console.log("Dashboard Socket Closed");
                setStatus('closed');
                // Auto-reconnect
                if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
            };
            
            ws.onerror = (e) => {
                console.error("Dashboard Socket Error", e);
                setStatus('error');
            };

            wsRef.current = ws;
        };

        connect();

        return () => {
            if (wsRef.current) wsRef.current.close();
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        };
    }, [url]);

    return { status, lastMessage };
};
