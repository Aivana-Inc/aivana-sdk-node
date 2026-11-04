import { LIMITS, recentHistory } from "./conversation.mjs";

const form = document.querySelector("#composer");
const input = document.querySelector("#message");
const transcript = document.querySelector("#transcript");
const empty = document.querySelector("#empty");
const status = document.querySelector("#status");
const error = document.querySelector("#error");
const send = document.querySelector("#send");
const stop = document.querySelector("#stop");
let history = [];
let context = {};
let active;

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
  transcript.replaceChildren(...history.map((item) => bubble(item.role, item.content)));
  if (pending) transcript.append(bubble("user", pending));
  else if (!history.length) transcript.append(empty);
  transcript.scrollTop = transcript.scrollHeight;
}

function busy(value) {
  send.disabled = value;
  input.disabled = value;
  stop.hidden = !value;
  form.setAttribute("aria-busy", String(value));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (active) return;
  const message = input.value.trim();
  if (!message || message.length > LIMITS.messageChars) return;
  const sentHistory = recentHistory(history, message);
  const controller = new AbortController();
  active = controller;
  error.hidden = true;
  busy(true);
  status.textContent = "Aivana is working…";
  render(message);
  try {
    const response = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: sentHistory, context }), signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "The request could not be completed.");
    if (controller.signal.aborted) return;
    if (typeof result.answer !== "string") throw new Error("The app received an unexpected response.");
    history = recentHistory([...sentHistory, { role: "user", content: message }, { role: "assistant", content: result.answer }]);
    context = result.context ?? {};
    input.value = "";
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
  error.hidden = true;
  status.textContent = "New chat. Earlier messages will not be sent again.";
  render();
  if (!active) input.focus();
});

document.querySelector("#example").addEventListener("click", () => {
  input.value = "Help me plan a small software project. Where should I start?";
  input.focus();
});
window.addEventListener("pagehide", () => active?.abort());
