import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3002';
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    socket = io(`${url}/chat`, {
      transports: ['websocket'],
      autoConnect: false,
      auth: { token: token || '' },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) {
    s.auth = { token };
  }
  if (!s.connected) {
    s.connect();
  }
  return s;
}

export function disconnectSocket() {
  if (socket?.connected) {
    socket.disconnect();
  }
}

export function resetSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
