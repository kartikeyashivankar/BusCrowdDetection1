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

function initSerial(busState, onEvent) {
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
      console.warn('[Serial] Running without hardware — use simulation buttons on frontend.');
      return;
    }
    console.log(`[Serial] ✅ Port ${SERIAL_CONFIG.path} opened successfully.`);
  });

  parser.on('data', (rawLine) => {
    const line = rawLine.trim().toUpperCase();
    if (!line) return;

    console.log(`[Serial] ← Received: "${line}"`);

    if (line === 'ENTRY') {                  // ✅ FIXED: was 'ENTER'
      if (busState.count < busState.capacity) {
        busState.count++;
        busState.totalIn++;
      }
      onEvent('enter', busState);

    } else if (line === 'EXIT') {
      if (busState.count > 0) {
        busState.count--;
        busState.totalOut++;
      }
      onEvent('exit', busState);

    } else if (line === 'FULL') {
      onEvent('full', busState);

    } else if (line === 'RESET') {
      busState.count = 0;
      busState.totalIn = 0;
      busState.totalOut = 0;
      onEvent('reset', busState);

    } else if (line.startsWith('COUNT:')) {
      const n = parseInt(line.split(':')[1], 10);
      if (!isNaN(n)) {
        busState.count = n;
        onEvent('status', busState);
      }

    } else if (line.startsWith('CAPACITY:')) {
      const n = parseInt(line.split(':')[1], 10);
      if (!isNaN(n) && n > 0) {
        busState.capacity = n;
        onEvent('status', busState);
      }

    } else {
      console.log(`[Serial] ℹ Unknown message: "${line}"`);
    }
  });

  port.on('error', (err) => {
    console.error(`[Serial] Port error: ${err.message}`);
  });

  port.on('close', () => {
    console.warn('[Serial] Port closed. Attempting reconnect in 5 seconds…');
    setTimeout(() => initSerial(busState, onEvent), 5000);
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