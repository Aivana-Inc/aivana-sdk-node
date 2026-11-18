import { LIMITS, recentHistory } from "./conversation.mjs";

const form = document.querySelector("#composer");
const input = document.querySelector("#message");
const transcript = document.querySelector("#transcript");
const empty = document.querySelector("#empty");
const chat = document.querySelector(".chat");
const suggestions = document.querySelector("#suggestions");
const status = document.querySelector("#status");
const error = document.querySelector("#error");
const send = document.querySelector("#send");
const stop = document.querySelector("#stop");
let history = [];
let context = {};
let active;
let ready = false;
let historyMode = "session";

const themeButton = document.querySelector("#theme");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
let chosenTheme;
function themeLabel() {
  const dark = chosenTheme ? chosenTheme === "dark" : systemTheme.matches;
  themeButton.textContent = dark ? "Light" : "Dark";
  themeButton.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} theme`);
}
themeButton.addEventListener("click", () => {
  chosenTheme = (chosenTheme ? chosenTheme === "dark" : systemTheme.matches) ? "light" : "dark";
  document.documentElement.dataset.theme = chosenTheme;
  themeLabel();
});
systemTheme.addEventListener("change", themeLabel);
themeLabel();

function bubble(role, content) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const label = document.createElement("h2");
  label.textContent = role === "user" ? "You" : "Aivana";
  const text = document.createElement("p");
  text.textContent = content; // Answers are text, never executable HTML.
  article.append(label, text);
  return article;
}

function render(pending) {
  const hasMessages = Boolean(pending || history.length);
  chat.classList.toggle("has-messages", hasMessages);
  suggestions.hidden = hasMessages;
  transcript.replaceChildren(...history.map((item) => bubble(item.role, item.content)));
  if (pending) transcript.append(bubble("user", pending));
  else if (!history.length) transcript.append(empty);
  transcript.scrollTop = transcript.scrollHeight;
}

function busy(value) {
  send.disabled = value || !ready;
  input.disabled = value || !ready;
  document.querySelector("#reset").disabled = !ready;
  suggestions.querySelectorAll("button").forEach((button) => { button.disabled = value || !ready; });
  stop.hidden = !value;
  form.setAttribute("aria-busy", String(value));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (active || !ready) return;
  const message = input.value.trim();
  if (!message || message.length > LIMITS.messageChars) return;
  const displayHistory = recentHistory(history, message);
  const sentHistory = historyMode === "session" ? displayHistory : [];
  const controller = new AbortController();
  active = controller;
  error.hidden = true;
  busy(true);
  status.textContent = "Aivana is working…";
  render(message);
  try {
    const response = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: sentHistory, context: historyMode === "session" ? context : {} }), signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "The request could not be completed.");
    if (controller.signal.aborted) return;
    if (typeof result.answer !== "string") throw new Error("The app received an unexpected response.");
    history = recentHistory([...displayHistory, { role: "user", content: message }, { role: "assistant", content: result.answer }]);
    context = result.context ?? {};
    input.value = "";
    resizeInput();
    status.textContent = "";
    render();
  } catch (failure) {
    if (controller.signal.aborted) return;
    error.textContent = failure instanceof TypeError ? "The connection was interrupted. Aivana may have accepted the request. No automatic retry was made." : failure.message;
    error.hidden = false;
    status.textContent = "";
    render(); // A failed turn never enters the next request's history. The draft stays editable.
  } finally {
    if (active === controller) { active = undefined; busy(false); input.focus(); }
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

stop.addEventListener("click", () => {
  active?.abort();
  status.textContent = "Stopped waiting. An accepted request may still use credit.";
  render();
});

document.querySelector("#reset").addEventListener("click", () => {
  active?.abort();
  history = [];
  context = {};
  input.value = "";
  resizeInput();
  error.hidden = true;
  status.textContent = "New chat. Earlier messages will not be sent again.";
  render();
  if (!active) input.focus();
});

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 164)}px`;
}
input.addEventListener("input", resizeInput);

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    if (active || !ready) return;
    input.value = button.dataset.prompt;
    resizeInput();
    input.focus();
  });
});
window.addEventListener("pagehide", () => active?.abort());

// Load only public behavior flags. Instructions and the definition stay on the server.
busy(false);
status.textContent = "Loading chat settings…";
try {
  const response = await fetch("/api/config");
  const settings = await response.json();
  if (!response.ok || typeof settings.blueprintLoaded !== "boolean" || typeof settings.webSearch !== "boolean" || !["session", "none"].includes(settings.history)) {
    throw new Error("Invalid settings response");
  }
  historyMode = settings.history;
  const note = document.querySelector("#configuration-note");
  if (settings.blueprintLoaded) {
    note.hidden = false;
    note.textContent = `Blueprint loaded · Web search ${settings.webSearch ? "allowed" : "off"}. ${historyMode === "none" ? "Each message is answered independently; earlier messages are not sent." : "Recent messages are included with follow-ups."}`;
  }
  ready = true;
  status.textContent = "";
} catch {
  status.textContent = "";
  error.hidden = false;
  error.textContent = "Chat settings could not be loaded. Check the starter server and reload this page before sending.";
} finally { busy(false); }
