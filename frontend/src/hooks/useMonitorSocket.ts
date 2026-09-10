import { useEffect, useRef, useState } from "react";
import { getToken } from "../api/client";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");

export type MonitorStatus = "connecting" | "connected" | "disconnected" | "error";

export interface MonitorEvent {
  id: number;
  receivedAt: string;
  topic: string;
  payload: unknown;
}

const RECONNECT_DELAYS = [1000, 2000, 5000];

export function useMonitorSocket(maxEvents = 200) {
  const [status, setStatus] = useState<MonitorStatus>("connecting");
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const idRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUnmountRef = useRef(false);

  useEffect(() => {
    closedByUnmountRef.current = false;

    function connect() {
      const token = getToken();
      if (!token) {
        setStatus("error");
        return;
      }

      setStatus("connecting");
      const ws = new WebSocket(`${WS_BASE}/ws/monitor?token=${encodeURIComponent(token)}`);
      socketRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setStatus("connected");
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          idRef.current += 1;
          setEvents((prev) => {
            const next = [
              {
                id: idRef.current,
                receivedAt: new Date().toISOString(),
                topic: data.topic,
                payload: data.payload,
              },
              ...prev,
            ];
            return next.slice(0, maxEvents);
          });
        } catch {
          // abaikan pesan yang tidak bisa di-parse
        }
      };

      ws.onerror = () => {
        setStatus("error");
      };

      ws.onclose = () => {
        if (closedByUnmountRef.current) return;
        setStatus("disconnected");
        const delay =
          RECONNECT_DELAYS[Math.min(attemptRef.current, RECONNECT_DELAYS.length - 1)];
        attemptRef.current += 1;
        timerRef.current = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      closedByUnmountRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      socketRef.current?.close();
    };
  }, [maxEvents]);

  return { status, events };
}
