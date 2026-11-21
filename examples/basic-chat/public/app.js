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
let blueprintLoaded = false;
const controls = document.querySelector("#chat-settings");
const streaming = document.querySelector("#streaming");

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

function bubble(role, content, incomplete = false) {
  const article = document.createElement("article");
  article.className = `message ${role}${incomplete ? " incomplete" : ""}`;
  const label = document.createElement("h2");
  label.textContent = role === "user" ? "You" : "Aivana";
  const text = document.createElement("p");
  text.textContent = content; // Answers are text, never executable HTML.
  article.append(label, text);
  if (incomplete) {
    const note = document.createElement("p");
    note.className = "incomplete-note";
    note.textContent = "Incomplete. This partial answer was not added to the conversation.";
    article.append(note);
  }
  return article;
}

// `incomplete` marks a partial answer from a failed stream: shown so nothing the person saw is lost, never saved.
function render(pending, partial = "", incomplete = false) {
  const hasMessages = Boolean(pending || history.length);
  chat.classList.toggle("has-messages", hasMessages);
  suggestions.hidden = hasMessages;
  transcript.replaceChildren(...history.map((item) => bubble(item.role, item.content)));
  if (pending) { transcript.append(bubble("user", pending)); if (partial) transcript.append(bubble("assistant", partial, incomplete)); }
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
  const settings = blueprintLoaded ? {} : { effort: document.querySelector("#effort").value, webSearch: document.querySelector("#web-search").checked, maxTokens: Number(document.querySelector("#max-tokens").value) };
  const controller = new AbortController();
  active = controller;
  error.hidden = true;
  busy(true);
  status.textContent = "Aivana is working…";
  render(message);
  let answer = ""; // Outside the try so a failed stream can still show what had already arrived.
  try {
    const useStream = streaming.checked;
    const response = await fetch(useStream ? "/api/chat/stream" : "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: sentHistory, context: historyMode === "session" ? context : {}, settings }), signal: controller.signal,
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error?.message || "The request could not be completed.");
    }
    let nextContext = {};
    if (useStream) {
      if (!response.body) throw new Error("Streaming is unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", complete = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.event === "delta") {
            answer += event.data.text;
            render(message, answer);
          } else if (event.event === "done") {
            complete = true;
            nextContext = event.data.context ?? {};
          } else if (event.event === "error") {
            throw new Error(event.data.message || "Streaming failed.");
          }
        }
      }
      if (!complete || !answer.trim()) throw new Error("The response ended before completion.");
    } else {
      const result = await response.json();
      if (typeof result.answer !== "string") throw new Error("The app received an unexpected response.");
      answer = result.answer;
      nextContext = result.context ?? {};
    }
    if (controller.signal.aborted) return;
    history = recentHistory([...displayHistory, { role: "user", content: message }, { role: "assistant", content: answer }]);
    context = nextContext;
    input.value = "";
    resizeInput();
    status.textContent = "";
    render();
  } catch (failure) {
    if (controller.signal.aborted) return;
    error.textContent = failure instanceof TypeError ? "The connection was interrupted. Aivana may have accepted the request, and it was not sent again automatically." : failure.message;
    error.hidden = false;
    status.textContent = "";
    // A failed turn never enters the next request's history and the draft stays editable, but text the person
    // already watched arrive stays on screen, marked incomplete, until their next message or New chat.
    if (answer.trim()) render(message, answer, true);
    else render();
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
  blueprintLoaded = settings.blueprintLoaded;
  controls.disabled = blueprintLoaded;
  document.querySelector("#settings-locked").hidden = !blueprintLoaded;
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
