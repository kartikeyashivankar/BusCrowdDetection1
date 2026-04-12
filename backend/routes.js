/**
 * routes.js
 * ─────────────────────────────────────────────────────────────
 * REST API endpoints exposed by the Express server.
 *
 * Base URL: http://localhost:3000/api
 *
 * Endpoints:
 *   GET  /api/status           → Current bus state snapshot
 *   POST /api/reset            → Reset passenger count to 0
 *   POST /api/capacity         → Set bus capacity  { capacity: <n> }
 *   POST /api/simulate/enter   → Simulate a passenger entering
 *   POST /api/simulate/exit    → Simulate a passenger exiting
 *   GET  /api/ports            → List available serial ports
 */

const express = require('express');
const router  = express.Router();

/**
 * Inject shared dependencies into the router.
 *
 * @param {object}   busState     - Shared state reference
 * @param {Function} broadcastAll - WebSocket broadcast function
 * @param {object}   serial       - { sendCommand, listPorts }
 * @returns {Router}
 */
module.exports = function createRouter(busState, broadcastAll, serial) {

  // ── GET /api/status ─────────────────────────────────────────
  router.get('/status', (req, res) => {
    res.json(getSnapshot(busState));
  });

  // ── POST /api/reset ─────────────────────────────────────────
  router.post('/reset', (req, res) => {
    busState.count    = 0;
    busState.totalIn  = 0;
    busState.totalOut = 0;

    serial.sendCommand('RESET');
    broadcastAll({ type: 'reset', ...getSnapshot(busState) });

    console.log('[API] Count reset via REST.');
    res.json({ ok: true, message: 'Count reset successfully.', state: getSnapshot(busState) });
  });

  // ── POST /api/capacity ──────────────────────────────────────
  router.post('/capacity', (req, res) => {
    const { capacity } = req.body;
    const val = parseInt(capacity, 10);

    if (isNaN(val) || val < 1) {
      return res.status(400).json({ ok: false, error: 'capacity must be a positive integer.' });
    }

    busState.capacity = val;
    serial.sendCommand(`SET_CAPACITY:${val}`);
    broadcastAll({ type: 'status', ...getSnapshot(busState) });

    console.log(`[API] Capacity set to ${val} via REST.`);
    res.json({ ok: true, message: `Capacity updated to ${val}.`, state: getSnapshot(busState) });
  });

  // ── POST /api/simulate/enter ────────────────────────────────
  router.post('/simulate/enter', (req, res) => {
    if (busState.count < busState.capacity) {
      busState.count++;
      busState.totalIn++;
      broadcastAll({ type: 'enter', ...getSnapshot(busState) });
      console.log(`[API] Simulated ENTER. Count: ${busState.count}`);
      res.json({ ok: true, action: 'enter', state: getSnapshot(busState) });
    } else {
      broadcastAll({ type: 'full', ...getSnapshot(busState) });
      res.json({ ok: false, message: 'Bus is already full.', state: getSnapshot(busState) });
    }
  });

  // ── POST /api/simulate/exit ─────────────────────────────────
  router.post('/simulate/exit', (req, res) => {
    if (busState.count > 0) {
      busState.count--;
      busState.totalOut++;
      broadcastAll({ type: 'exit', ...getSnapshot(busState) });
      console.log(`[API] Simulated EXIT. Count: ${busState.count}`);
      res.json({ ok: true, action: 'exit', state: getSnapshot(busState) });
    } else {
      res.json({ ok: false, message: 'Count is already 0.', state: getSnapshot(busState) });
    }
  });

  // ── GET /api/ports ──────────────────────────────────────────
  router.get('/ports', async (req, res) => {
    try {
      await serial.listPorts();   // Prints to console
      const { SerialPort } = require('serialport');
      const ports = await SerialPort.list();
      res.json({ ok: true, ports });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
};

// ── Helpers ───────────────────────────────────────────────────
function getSnapshot(busState) {
  return {
    count:        busState.count,
    capacity:     busState.capacity,
    totalIn:      busState.totalIn,
    totalOut:     busState.totalOut,
    isFull:       busState.count >= busState.capacity,
    seatsLeft:    Math.max(busState.capacity - busState.count, 0),
    occupancyPct: busState.capacity > 0
      ? Math.round((busState.count / busState.capacity) * 100)
      : 0,
    timestamp:    new Date().toISOString(),
  };
}
