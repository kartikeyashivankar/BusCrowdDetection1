/**
 * serialHandler.js
 * ─────────────────────────────────────────────────────────────
 * Manages the serial port connection to the ESP32/Arduino board.
 *
 * Expected serial messages from ESP32 (one per line):
 *   "ENTRY"         → Passenger entered the bus
 *   "EXIT"          → Passenger exited the bus
 *   "FULL"          → Bus reached capacity (hardware-side alert)
 *   "RESET"         → Count was reset on the hardware side
 *   "COUNT:<n>"     → Heartbeat / sync — current count is <n>
 *   "CAPACITY:<n>"  → Hardware-reported capacity
 *
 * Commands sent TO the ESP32:
 *   "SET_CAPACITY:<n>\n"  → Update capacity on device
 *   "RESET\n"             → Reset the counter on device
 */

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// ── Config (edit PORT to match your device) ───────────────────
const SERIAL_CONFIG = {
  path: process.env.SERIAL_PORT || 'COM3',
  baudRate: parseInt(process.env.BAUD_RATE, 10) || 115200,
};

let port = null;
let parser = null;
let reconnectTimer = null;
const RECONNECT_INTERVAL = 5000; // 5 seconds between retry attempts

/**
 * Clean up old port and parser references before reconnecting.
 */
function cleanupPort() {
  if (parser) {
    parser.removeAllListeners();
    parser = null;
  }
  if (port) {
    // Only attempt close if the port is actually open.
    // Remove listeners AFTER closing to avoid unhandled 'error' events.
    if (port.isOpen) {
      try { port.close(); } catch (_) { /* ignore */ }
    }
    port.removeAllListeners();
    port = null;
  }
}

/**
 * Schedule a reconnection attempt. Keeps retrying every 5 seconds
 * until the device is plugged back in and the port opens successfully.
 */
function scheduleReconnect(busState, onEvent) {
  if (reconnectTimer) return; // already scheduled
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initSerial(busState, onEvent);
  }, RECONNECT_INTERVAL);
}

function initSerial(busState, onEvent) {
  // Clean up any previous connection first
  cleanupPort();

  console.log(`[Serial] Attempting to open ${SERIAL_CONFIG.path} @ ${SERIAL_CONFIG.baudRate} baud…`);

  port = new SerialPort({
    path: SERIAL_CONFIG.path,
    baudRate: SERIAL_CONFIG.baudRate,
    autoOpen: false,
  });

  parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

  port.open((err) => {
    if (err) {
      console.error(`[Serial] ❌ Failed to open port: ${err.message}`);
      console.warn('[Serial] Running without hardware — will keep retrying every 5s…');
      // ── KEY FIX: keep retrying instead of giving up ──
      scheduleReconnect(busState, onEvent);
      return;
    }
    console.log(`[Serial] ✅ Port ${SERIAL_CONFIG.path} opened successfully.`);
  });

  parser.on('data', (rawLine) => {
    // Strip any non-printable / non-ASCII garbage bytes that appear
    // during USB reconnection (e.g. "\uFFFD\uFFFD...SET").
    const cleaned = rawLine.replace(/[^\x20-\x7E]/g, '').trim().toUpperCase();
    if (!cleaned) return;

    console.log(`[Serial] ← Received: "${cleaned}"`);

    if (cleaned === 'ENTRY') {
      if (busState.count < busState.capacity) {
        busState.count++;
        busState.totalIn++;
      }
      onEvent('enter', busState);

    } else if (cleaned === 'EXIT') {
      if (busState.count > 0) {
        busState.count--;
        busState.totalOut++;
      }
      onEvent('exit', busState);

    } else if (cleaned === 'FULL') {
      onEvent('full', busState);

    } else if (cleaned === 'RESET') {
      busState.count = 0;
      busState.totalIn = 0;
      busState.totalOut = 0;
      onEvent('reset', busState);

    } else if (cleaned.startsWith('COUNT:')) {
      const n = parseInt(cleaned.split(':')[1], 10);
      if (!isNaN(n)) {
        busState.count = n;
        onEvent('status', busState);
      }

    } else if (cleaned.startsWith('CAPACITY:')) {
      const n = parseInt(cleaned.split(':')[1], 10);
      if (!isNaN(n) && n > 0) {
        busState.capacity = n;
        onEvent('status', busState);
      }

    } else {
      // Silently ignore short garbage fragments (< 3 chars)
      if (cleaned.length >= 3) {
        console.log(`[Serial] ℹ Unknown message: "${cleaned}"`);
      }
    }
  });

  port.on('error', (err) => {
    console.error(`[Serial] Port error: ${err.message}`);
  });

  // ── When the USB cable is unplugged, the port closes ──
  // Keep retrying until the device is plugged back in.
  port.on('close', () => {
    console.warn('[Serial] ⚠ Port closed (USB disconnected?). Will retry every 5s…');
    scheduleReconnect(busState, onEvent);
  });
}

function sendCommand(command) {
  if (!port || !port.isOpen) {
    console.warn(`[Serial] Cannot send "${command}" — port not open.`);
    return;
  }
  const msg = command.trim() + '\n';
  port.write(msg, (err) => {
    if (err) console.error(`[Serial] Write error: ${err.message}`);
    else console.log(`[Serial] → Sent: "${command}"`);
  });
}

async function listPorts() {
  try {
    const ports = await SerialPort.list();
    if (ports.length === 0) {
      console.log('[Serial] No serial ports detected.');
    } else {
      console.log('[Serial] Available ports:');
      ports.forEach((p) => {
        console.log(`  ${p.path}  ${p.manufacturer || ''}`);
      });
    }
  } catch (e) {
    console.error('[Serial] Could not list ports:', e.message);
  }
}

module.exports = { initSerial, sendCommand, listPorts };