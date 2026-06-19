// ws route. hooks the elysia ws server into the hub so clients get live events.
//
// on open: register the client, send log history (last N from db), say hello.
// on message: handle log.levels filter updates.

import { Elysia } from "elysia";
import {
  registerWsClient,
  unregisterWsClient,
  trackSocket,
  untrackSocket,
  handleWsMessage,
  sendLogHistory,
} from "../../bot/ws/hub";

export const wsRoutes = new Elysia().ws("/ws", {
  open(ws) {
    registerWsClient(ws);
    trackSocket(ws);
    void sendLogHistory(ws);
    ws.send({ type: "hello", ts: Date.now() });
  },
  close(ws) {
    unregisterWsClient(ws);
    untrackSocket(ws);
  },
  message(ws, message) {
    void handleWsMessage(ws, message);
  },
});
