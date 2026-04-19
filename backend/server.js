/**
 * server.js
 * ─────────────────────────────────────────────────────────────
 * Main entry point for Bus Crowd Detection backend.
 *
 * Architecture:
 *   ┌─────────────┐   Serial (UART)   ┌──────────────────┐
 *   │  ESP32 /    │ ────────────────► │  serialHandler.js │
 *   │  Arduino    │                   └────────┬─────────┘
 *   └─────────────┘                            │
 *                                              ▼
 *                                     ┌─────────────────┐
 *                                     │   busState {}    │  ← Shared in-memory state
 *                                     └────────┬────────┘
 *                          ┌───────────────────┼──────────────┐
 *                          ▼                   ▼              ▼
 *                   ┌────────────┐    ┌──────────────┐  ┌──────────┐
 *                   │ WebSocket  │    │  REST API     │  │  Static  │
 *                   │ (ws://)    │    │  /api/*       │  │  /       │
 *                   └─────┬──────┘    └──────────────┘  └──────────┘
 *                         │
 *                         ▼
 *                  ┌────────────────┐
 *                  │  Browser /     │
 *                  │  Frontend UI   │
 *                  └────────────────┘
 *
 * WebSocket messages (server → client):
 *   { type: 'enter',  count, capacity, totalIn, totalOut, isFull, seatsLeft, occupancyPct, timestamp }
 *   { type: 'exit',   ... }
 *   { type: 'full',   ... }
 *   { type: 'reset',  ... }
 *   { type: 'status', ... }
 *
 * WebSocket messages (client → server):
 *   { type: 'simulateEnter' }
 *   { type: 'simulateExit'  }
 *   { type: 'reset'         }
 *   { type: 'setCapacity', value: <n> }
 */

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const { initSerial, sendCommand, listPorts } = require('./serialHandler');
const createRouter = require('./routes');

// ── Server Config ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const CAPACITY = parseInt(process.env.BUS_CAPACITY, 10) || 45;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

// ── Shared Bus State ──────────────────────────────────────────
// This object is the single source of truth for the current
// bus occupancy. Both the serial handler and WebSocket handler
// mutate this object and broadcast changes to all clients.
const busState = {
  count: 0,
  capacity: CAPACITY,
  totalIn: 0,
  totalOut: 0,
};

// ── Express App ───────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Serve the frontend static files at http://localhost:3000/
app.use(express.static(FRONTEND_DIR));

// REST API
const serial = { sendCommand, listPorts };
app.use('/api', createRouter(busState, broadcastAll, serial));

// Catch-all → serve index.html for any non-API path
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ── WebSocket Server ──────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log(`[WS] ✅ Client connected: ${clientIP}`);

  // Send current state immediately on connect
  safeSend(ws, { type: 'status', ...getSnapshot() });

  // ── Handle messages from frontend ──────────────────────────
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.warn('[WS] Invalid JSON from client:', raw.toString());
      return;
    }

    console.log(`[WS] ← From client: ${JSON.stringify(msg)}`);

    switch (msg.type) {

      case 'simulateEnter':
        if (busState.count < busState.capacity) {
          busState.count++;
          busState.totalIn++;
          broadcastAll({ type: 'enter', ...getSnapshot() });
        } else {
          broadcastAll({ type: 'full', ...getSnapshot() });
        }
        break;

      case 'simulateExit':
        if (busState.count > 0) {
          busState.count--;
          busState.totalOut++;
          broadcastAll({ type: 'exit', ...getSnapshot() });
        }
        break;

      case 'reset':
        busState.count = 0;
        busState.totalIn = 0;
        busState.totalOut = 0;
        sendCommand('RESET');
        broadcastAll({ type: 'reset', ...getSnapshot() });
        console.log('[WS] Count reset by client.');
        break;

      case 'setCapacity': {
        const val = parseInt(msg.value, 10);
        if (!isNaN(val) && val > 0) {
          busState.capacity = val;
          sendCommand(`SET_CAPACITY:${val}`);
          broadcastAll({ type: 'status', ...getSnapshot() });
          console.log(`[WS] Capacity set to ${val} by client.`);
        }
        break;
      }

      default:
        console.log(`[WS] Unknown message type: "${msg.type}"`);
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Client disconnected: ${clientIP}`);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Client error: ${err.message}`);
  });
});

// ── Broadcast Helpers ─────────────────────────────────────────

/**
 * Broadcast a JSON payload to ALL connected WebSocket clients.
 * @param {object} payload
 */
function broadcastAll(payload) {
  const json = JSON.stringify(payload);
  let sent = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(json);
      sent++;
    }
  });
  if (sent > 0) {
    console.log(`[WS] → Broadcast "${payload.type}" to ${sent} client(s). Count: ${payload.count}/${payload.capacity}`);
  }
}

/**
 * Send a JSON payload to a single WebSocket client safely.
 * @param {WebSocket} ws
 * @param {object}    payload
 */
function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// ── State Snapshot Helper ─────────────────────────────────────
function getSnapshot() {
  return {
    count: busState.count,
    capacity: busState.capacity,
    totalIn: busState.totalIn,
    totalOut: busState.totalOut,
    isFull: busState.count >= busState.capacity,
    seatsLeft: Math.max(busState.capacity - busState.count, 0),
    occupancyPct: busState.capacity > 0
      ? Math.round((busState.count / busState.capacity) * 100)
      : 0,
    timestamp: new Date().toISOString(),
  };
}

// ── Serial Init ───────────────────────────────────────────────
// Called with the shared busState and a callback that fires on
// every hardware event, which then broadcasts to all WS clients.
initSerial(busState, (eventType, state) => {
  broadcastAll({ type: eventType, ...getSnapshot() });
});

// ── Start Server ──────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Bus Crowd Detection Backend  🚌         ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  HTTP  → http://localhost:${PORT}           ║`);
  console.log(`║  WS    → ws://localhost:${PORT}             ║`);
  console.log(`║  API   → http://localhost:${PORT}/api       ║`);
  console.log(`║  Cap.  → ${busState.capacity} passengers                ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});

// ── Graceful Shutdown ─────────────────────────────────────────
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function shutdown(signal) {
  console.log(`\n[Server] Received ${signal}. Shutting down gracefully…`);
  server.close(() => {
    console.log('[Server] HTTP server closed.');
    process.exit(0);
  });
}
