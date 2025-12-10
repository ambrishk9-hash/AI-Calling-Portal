
import { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../constants';

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'error';

export const useDashboardSocket = (urlOverride?: string) => {
    const [status, setStatus] = useState<SocketStatus>('closed');
    const [lastMessage, setLastMessage] = useState<any>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<number | null>(null);
    
    // Ensure we have a valid URL to connect to. 
    // Fallback to empty string if undefined to prevent crash, though logic below handles it.
    const url = urlOverride || API_BASE_URL;

    useEffect(() => {
        let isMounted = true;

        const connect = () => {
            // Prevent multiple connections
            if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
                return;
            }

            const cleanUrl = url.replace(/\/$/, '');
            // Intelligent protocol replacement: http -> ws, https -> wss
            const protocol = cleanUrl.startsWith('https') ? 'wss' : 'ws';
            const wsUrl = cleanUrl.replace(/^https?/, protocol) + '/dashboard-stream';
            
            console.log(`[DashboardSocket] Connecting to: ${wsUrl}`);
            
            try {
                const ws = new WebSocket(wsUrl);
                setStatus('connecting');

                ws.onopen = () => {
                    if (!isMounted) {
                        ws.close();
                        return;
                    }
                    console.log("[DashboardSocket] Connection Established");
                    setStatus('open');
                };
                
                ws.onmessage = (event) => {
                    if (!isMounted) return;
                    try {
                        const data = JSON.parse(event.data);
                        setLastMessage(data);
                    } catch(e) { 
                        console.warn("[DashboardSocket] Failed to parse message:", event.data); 
                    }
                };

                ws.onclose = (event) => {
                    if (!isMounted) return;
                    console.log(`[DashboardSocket] Closed (Code: ${event.code})`);
                    setStatus('closed');
                    wsRef.current = null;
                    
                    // Auto-reconnect with exponential backoff or simple delay
                    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
                };
                
                ws.onerror = () => {
                    if (!isMounted) return;
                    // WebSocket error events provide no details in JS (security). 
                    // Just log that it happened so the user knows to check the network tab.
                    console.error("[DashboardSocket] Connection Error. Verify server is running."); 
                    setStatus('error');
                };

                wsRef.current = ws;
            } catch (err) {
                console.error("[DashboardSocket] Setup failed:", err);
                setStatus('error');
                // Retry even if setup failed (e.g. malformed URL fixed later?)
                reconnectTimeoutRef.current = window.setTimeout(connect, 5000);
            }
        };

        connect();

        return () => {
            isMounted = false;
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, [url]);

    return { status, lastMessage };
};
