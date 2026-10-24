const WebSocket = require("ws");
const debugLogger = require("./debugLogger");
const chatgptAuth = require("./chatgptAuth");

// Cleanup on the ChatGPT plan over the Responses API WebSocket mode. The socket
// is opened while the user speaks, so cleanup skips the ~1 s connect, and a
// generate:false request with the last prompt warms the server for it.
// The renderer cannot set the Authorization header on a WebSocket, so this
// runs in the main process. Any failure makes the renderer use HTTP instead.
const RESPONSES_URL = "wss://api.openai.com/v1/responses";
const OPEN_TIMEOUT_MS = 5000;
const IDLE_CLOSE_MS = 5 * 60 * 1000;

let socket = null; // { ws, token, opened: Promise<void> }
let queue = Promise.resolve();
let lastPrompt = null; // model, instructions, reasoning and tier of the last cleanup
let warm = null; // { key, id } from the generate:false warmup
let warming = null;
let idleTimer = null;

const promptKey = (prompt) => JSON.stringify(prompt);

function openSocket(token) {
  if (socket?.token === token && socket.ws.readyState <= WebSocket.OPEN) return socket;
  closeSocket();
  const ws = new WebSocket(RESPONSES_URL, { headers: { Authorization: `Bearer ${token}` } });
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("ChatGPT socket open timeout")),
      OPEN_TIMEOUT_MS
    );
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`ChatGPT socket refused (HTTP ${res.statusCode})`));
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  opened.catch(() => {
    if (socket?.ws === ws) closeSocket();
  });
  ws.on("error", () => {});
  ws.on("close", () => {
    if (socket?.ws === ws) {
      socket = null;
      warm = null;
    }
  });
  socket = { ws, token, opened };
  return socket;
}

function closeSocket() {
  if (!socket) return;
  try {
    socket.ws.close();
  } catch {}
  socket = null;
  warm = null;
}

function touchIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(closeSocket, IDLE_CLOSE_MS);
}

// Sends one response.create and collects its text deltas. Requests run one at
// a time, so every event on the socket belongs to the current request.
function send(body, timeoutMs) {
  const run = async () => {
    const token = await chatgptAuth.getAccessToken();
    if (!token) throw new Error("Not signed in with ChatGPT");
    const current = openSocket(token);
    await current.opened;
    touchIdleTimer();
    const ws = current.ws;
    return new Promise((resolve, reject) => {
      let text = "";
      const finish = (error, result) => {
        clearTimeout(timer);
        ws.off("message", onMessage);
        ws.off("close", onClose);
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => {
        // A late reply would mix into the next request, so drop the socket.
        if (socket?.ws === ws) closeSocket();
        finish(new Error("ChatGPT socket response timeout"));
      }, timeoutMs);
      const onClose = () => finish(new Error("ChatGPT socket closed"));
      const onMessage = (data) => {
        let event;
        try {
          event = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (event.type === "response.output_text.delta") text += event.delta || "";
        // With store:false the completed event has no text, so the deltas are the reply.
        if (event.type === "response.completed") finish(null, { id: event.response?.id, text });
        if (["response.failed", "response.incomplete", "error"].includes(event.type)) {
          const error = event.response?.error ?? event.error ?? {};
          finish(
            new Error(
              `ChatGPT socket error: ${error.code ?? event.type} ${error.message ?? ""}`.trim()
            )
          );
        }
      };
      ws.on("message", onMessage);
      ws.on("close", onClose);
      ws.send(JSON.stringify({ type: "response.create", ...body }));
    });
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

// Called at dictation start. Without a cleanup in this app session it only opens the socket.
function warmup() {
  warming = runWarmup();
  return warming;
}

async function runWarmup() {
  try {
    if (!lastPrompt) {
      const token = await chatgptAuth.getAccessToken();
      if (!token) return { success: false };
      await openSocket(token).opened;
      touchIdleTimer();
      return { success: true };
    }
    const prompt = lastPrompt;
    const result = await send(
      { ...prompt, store: false, input: [], generate: false },
      OPEN_TIMEOUT_MS
    );
    warm = { key: promptKey(prompt), id: result.id };
    return { success: true };
  } catch (error) {
    debugLogger.debug("ChatGPT socket warmup failed", { error: error.message });
    return { success: false, error: error.message };
  }
}

// body is the HTTP request body without `stream`.
async function createResponse(body, timeoutMs) {
  // A warmup still in flight would leave a warm id that is no longer the latest response.
  await warming;
  const prompt = {
    model: body.model,
    instructions: body.instructions,
    reasoning: body.reasoning,
    service_tier: body.service_tier,
  };
  // The warm response is reused only when the prompt is the same. Instructions
  // are not carried over by previous_response_id, so they are sent again.
  const previous = warm?.key === promptKey(prompt) ? warm.id : undefined;
  warm = null;
  lastPrompt = prompt;
  const result = await send(
    previous ? { ...body, previous_response_id: previous } : body,
    timeoutMs
  );
  return { text: result.text, warm: !!previous };
}

module.exports = { warmup, createResponse };
