import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { APP_URL, PORT, UPLOADS_DIR, ensureDataDirs } from './config.js';
import { socketAuth } from './auth.js';
import { mailConfigured } from './mail.js';
import { authRouter, campaignRouter } from './routes/authRoutes.js';
import { uploadRouter } from './routes/uploadRoutes.js';
import { mapPreviewRouter } from './routes/mapPreviewRoutes.js';
import { attachMapPackIo, mapPackRouter } from './routes/mapPackRoutes.js';
import { backupRouter } from './routes/backupRoutes.js';
import { registerSessionHandlers } from './live/handlers/session.js';
import { initIronDice } from './live/ironDice.js';
import { registerMapEditHandlers } from './live/handlers/mapEdit.js';
import { registerTokenHandlers } from './live/handlers/tokens.js';
import { registerCharacterHandlers } from './live/handlers/characters.js';
import { registerChatHandlers } from './live/handlers/chat.js';
import { registerCombatHandlers } from './live/handlers/combat.js';
import { registerTableHandlers } from './live/handlers/table.js';
import { registerLibraryHandlers } from './live/handlers/library.js';
import { registerWorldHandlers } from './live/handlers/world.js';
import { registerMapObjectHandlers } from './live/handlers/mapObjects.js';
import { registerCounterHandlers } from './live/handlers/counters.js';
import { flushAllVisionMemory } from './live/visionService.js';

/** Stamped at commit time so a running server can say which build it is —
 *  and so a deploy that claims to watch only part of this repo has something
 *  in the server tree to notice. */
const BUILD_REF = 'nest-map-objects';

import { audioShrinkAvailable } from './media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

ensureDataDirs();
initIronDice();

const app = express();
// One hop: Railway's edge. Without this every request arrives wearing the
// proxy's address, and the reset-mail rate limiter would count the whole
// internet as a single caller and lock everyone out at the tenth try.
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', authRouter);
app.use('/api/campaigns', campaignRouter);
app.use('/api', uploadRouter);
app.use('/api', mapPreviewRouter);
app.use('/api', mapPackRouter);
app.use('/api', backupRouter);

// Uploaded assets (map backgrounds, token art, handout images).
app.use('/uploads', express.static(UPLOADS_DIR, { immutable: true, maxAge: '365d' }));

// Serve the built client in production.
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const httpServer = http.createServer(app);
const io = new Server(httpServer);
attachMapPackIo(io);

io.use(socketAuth);

io.on('connection', (socket) => {
  // Personal room for whispers and per-player vision updates.
  socket.join(`user:${socket.data.userId}`);
  registerSessionHandlers(io, socket);
  registerMapEditHandlers(io, socket);
  registerTokenHandlers(io, socket);
  registerCharacterHandlers(io, socket);
  registerCounterHandlers(io, socket);
  registerChatHandlers(io, socket);
  registerCombatHandlers(io, socket);
  registerTableHandlers(io, socket);
  registerLibraryHandlers(io, socket);
  registerWorldHandlers(io, socket);
  registerMapObjectHandlers(io, socket);
});

httpServer.listen(PORT, () => {
  console.log(`Roll67 server listening on :${PORT} (build ` + BUILD_REF + `)`);
  if (!audioShrinkAvailable) {
    console.log('  audio: no ffmpeg on this host — uploads will be stored at their original size');
  }
  if (!mailConfigured()) {
    console.log('  mail: RESEND_API_KEY unset — password reset links will be printed here instead of emailed');
  }
  if (!APP_URL) {
    console.log('  mail: APP_URL unset — reset links will be built from the request Host header (set APP_URL in production)');
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    flushAllVisionMemory();
    process.exit(0);
  });
}
