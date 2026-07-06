import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { PORT, UPLOADS_DIR, ensureDataDirs } from './config.js';
import { socketAuth } from './auth.js';
import { authRouter, campaignRouter } from './routes/authRoutes.js';
import { uploadRouter } from './routes/uploadRoutes.js';
import { registerSessionHandlers } from './live/handlers/session.js';
import { registerMapEditHandlers } from './live/handlers/mapEdit.js';
import { registerTokenHandlers } from './live/handlers/tokens.js';
import { registerCharacterHandlers } from './live/handlers/characters.js';
import { registerChatHandlers } from './live/handlers/chat.js';
import { registerCombatHandlers } from './live/handlers/combat.js';
import { registerTableHandlers } from './live/handlers/table.js';
import { registerLibraryHandlers } from './live/handlers/library.js';
import { registerWorldHandlers } from './live/handlers/world.js';
import { flushAllVisionMemory } from './live/visionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

ensureDataDirs();

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', authRouter);
app.use('/api/campaigns', campaignRouter);
app.use('/api', uploadRouter);

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

io.use(socketAuth);

io.on('connection', (socket) => {
  // Personal room for whispers and per-player vision updates.
  socket.join(`user:${socket.data.userId}`);
  registerSessionHandlers(io, socket);
  registerMapEditHandlers(io, socket);
  registerTokenHandlers(io, socket);
  registerCharacterHandlers(io, socket);
  registerChatHandlers(io, socket);
  registerCombatHandlers(io, socket);
  registerTableHandlers(io, socket);
  registerLibraryHandlers(io, socket);
  registerWorldHandlers(io, socket);
});

httpServer.listen(PORT, () => {
  console.log(`Roll67 server listening on :${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    flushAllVisionMemory();
    process.exit(0);
  });
}
