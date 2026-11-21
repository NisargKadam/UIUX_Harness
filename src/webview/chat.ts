// Chat view script. A plain DOM UI (no framework) that renders harness events for the designer.
// Code and diffs stay hidden unless "Show code changes" is on.
import type { ChatToExtension, ExtensionToChat, HarnessEvent, MissingComponent, PrototypePlan } from "../core/protocol";

declare function acquireVsCodeApi(): { postMessage(msg: ChatToExtension): void };
const vscode = acquireVsCodeApi();
const post = (m: ChatToExtension) => vscode.postMessage(m);

// ------------------------------------------------------------------ helpers

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

/** Tiny, safe markdown: paragraphs, bullet/numbered lists, bold, inline code. Everything is escaped first. */
function renderMarkdown(src: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  let inFence = false;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of src.split("\n")) {
    if (/^```/.test(line.trim())) {
      // Code is hidden from the designer by default; a fenced block becomes a small note.
      if (!inFence) {
        flushPara();
        closeList();
        out.push(`<p class="muted">(code hidden)</p>`);
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((bullet ?? numbered)![1]!)}</li>`);
    } else if (heading) {
      flushPara();
      closeList();
      out.push(`<p><strong>${inline(heading[1]!)}</strong></p>`);
    } else if (line.trim() === "") {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join("");
}

// ------------------------------------------------------------------ layout

const app = document.getElementById("app")!;
const protoSelect = h("select", { id: "proto", title: "Prototype" });
const previewBtn = h("button", { class: "secondary", title: "Show the live preview" }, "Preview");
const codeToggle = h("input", { type: "checkbox", id: "showCode" });
const stopBtn = h("button", { class: "danger hidden", title: "Stop the current run" }, "Stop");
const header = h(
  "header",
  { class: "top" },
  protoSelect,
  previewBtn,
  h("label", { class: "toggle", for: "showCode", title: "Show the code changes behind each step" }, codeToggle, "Show code"),
  stopBtn,
);
const keyBanner = h(
  "div",
  { class: "banner hidden" },
  h("span", {}, "Add your Anthropic API key to start. It's stored securely in VS Code, not in your project."),
  h("button", { id: "addKey" }, "Add key"),
);
const log = h("div", { class: "log", role: "log", "aria-live": "polite" });
const empty = h(
  "div",
  { class: "empty" },
  h("p", { class: "lead" }, "Describe a screen or flow and I'll build a clickable prototype from your component library."),
  h("p", { class: "muted" }, "For example: “a settings page with a profile form and a notifications tab”. You can also paste a Figma frame link."),
);
const status = h("div", { class: "status hidden" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { id: "statusText" }, "Thinking…"));
const input = h("textarea", { id: "input", rows: "3", placeholder: "Describe what you want, or give feedback on the prototype…", "aria-label": "Message" });
const figmaInput = h("input", { id: "figma", type: "url", placeholder: "https://www.figma.com/design/…?node-id=…", "aria-label": "Figma frame link" });
const figmaDetails = h("details", { class: "figma" }, h("summary", {}, "Add a Figma frame"), figmaInput);
const sendBtn = h("button", { type: "submit", id: "send" }, "Send");
const composer = h("form", { class: "composer" }, input, h("div", { class: "row" }, figmaDetails, sendBtn));
app.append(header, keyBanner, log, status, composer);
log.append(empty);

let showCode = false;
let running = false;
let currentBubble: { el: HTMLElement; raw: string } | null = null;
const planCards = new Map<string, HTMLElement>();
let changeGroup: HTMLElement | null = null;

function scrollToEnd(): void {
  log.scrollTop = log.scrollHeight;
}

function add(el: HTMLElement): void {
  empty.remove();
  log.append(el);
  scrollToEnd();
}

function setRunning(value: boolean): void {
  running = value;
  stopBtn.classList.toggle("hidden", !value);
  status.classList.toggle("hidden", !value);
  sendBtn.toggleAttribute("disabled", value);
  if (!value) {
    currentBubble = null;
    changeGroup = null;
  }
}

function applyShowCode(): void {
  document.body.classList.toggle("show-code", showCode);
  codeToggle.checked = showCode;
}

// ------------------------------------------------------------------ cards

function planCard(id: string, question: string, plan: PrototypePlan): HTMLElement {
  const screens = h("ul", { class: "screens" });
  for (const s of plan.screens) {
    screens.append(
      h("li", {}, h("strong", {}, s.name), h("span", { class: "route" }, ` ${s.route}`), h("div", { class: "muted" }, s.purpose), h("div", { class: "chips" }, ...s.components.map((c) => h("span", { class: "chip" }, c)))),
    );
  }
  const flow = h("ul", { class: "flow" }, ...plan.flow.map((f) => h("li", {}, `${f.from} → ${f.action} → ${f.to}`)));
  const card = h(
    "section",
    { class: "card plan" },
    h("div", { class: "card-title" }, `Plan: ${plan.title}`),
    h("p", {}, plan.summary),
    h("div", { class: "label" }, "Screens"),
    screens,
    h("div", { class: "label" }, "Click flow"),
    flow,
  );
  if (plan.missingComponents.length) card.append(h("div", { class: "label" }, "Missing from the library"), missingList(plan.missingComponents));
  if (plan.assumptions.length) card.append(h("div", { class: "label" }, "Assumptions"), h("ul", { class: "assumptions" }, ...plan.assumptions.map((a) => h("li", {}, a))));

  const approve = h("button", {}, "Build it");
  const change = h("button", { class: "secondary" }, "Change something");
  const changes = h("textarea", { rows: "2", class: "hidden", placeholder: "What should be different?" });
  const sendChanges = h("button", { class: "hidden" }, "Send changes");
  const actions = h("div", { class: "actions" }, approve, change);
  card.append(h("p", { class: "question" }, question), actions, changes, sendChanges);
  const finish = (text: string) => {
    actions.remove();
    changes.remove();
    sendChanges.remove();
    card.append(h("p", { class: "answered" }, text));
  };
  approve.addEventListener("click", () => {
    post({ type: "answer", id, answer: "Build it", approved: true });
    finish("✓ Approved: building now");
  });
  change.addEventListener("click", () => {
    changes.classList.remove("hidden");
    sendChanges.classList.remove("hidden");
    changes.focus();
  });
  sendChanges.addEventListener("click", () => {
    const text = changes.value.trim();
    if (!text) return;
    post({ type: "answer", id, answer: text, approved: false });
    finish(`You asked for changes: “${text}”`);
  });
  planCards.set(plan.prototypeName, card);
  return card;
}

function questionCard(id: string, question: string, options: string[]): HTMLElement {
  const card = h("section", { class: "card question-card" }, h("p", { class: "question" }, question));
  const actions = h("div", { class: "actions" });
  const other = h("input", { type: "text", placeholder: "Or type your answer…" });
  const done = (answer: string) => {
    post({ type: "answer", id, answer });
    actions.remove();
    other.remove();
    card.append(h("p", { class: "answered" }, `You answered: “${answer}”`));
  };
  for (const o of options) {
    const b = h("button", { class: "secondary" }, o);
    b.addEventListener("click", () => done(o));
    actions.append(b);
  }
  other.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && other.value.trim()) done(other.value.trim());
  });
  card.append(actions, other);
  return card;
}

function missingList(items: MissingComponent[]): HTMLElement {
  return h("ul", { class: "missing" }, ...items.map((m) => h("li", {}, h("strong", {}, m.need), ` (using ${m.usingInstead}). `, h("span", { class: "muted" }, m.reason))));
}

function fileChange(path: string, created: boolean, diff: string): void {
  if (!changeGroup) {
    changeGroup = h("details", { class: "changes code-only" }, h("summary", {}, "Code changes"));
    add(changeGroup);
  }
  const name = path.split("/").slice(-2).join("/");
  const item = h("details", { class: "change" }, h("summary", {}, `${created ? "Created" : "Updated"} ${name}`), h("pre", {}, diff.split("\n").slice(4).join("\n")));
  changeGroup.append(item);
  const summary = changeGroup.querySelector("summary");
  if (summary) summary.textContent = `Code changes (${changeGroup.querySelectorAll(".change").length} files)`;
}

// ------------------------------------------------------------------ events

function onEvent(e: HarnessEvent): void {
  switch (e.type) {
    case "run_state":
      setRunning(e.state !== "idle");
      if (e.state === "waiting_for_user") (document.getElementById("statusText") as HTMLElement).textContent = "Waiting for you…";
      break;
    case "assistant_delta":
      if (!currentBubble) {
        const el = h("div", { class: "msg assistant" });
        currentBubble = { el, raw: "" };
        add(el);
      }
      currentBubble.raw += e.text;
      currentBubble.el.innerHTML = renderMarkdown(currentBubble.raw);
      scrollToEnd();
      break;
    case "assistant_done":
      if (currentBubble && currentBubble.raw.trim() === "") currentBubble.el.remove();
      currentBubble = null;
      break;
    case "activity":
      if (e.item.status === "running") (document.getElementById("statusText") as HTMLElement).textContent = `${e.item.label}…`;
      break;
    case "file_written":
      fileChange(e.path, e.created, e.diff);
      break;
    case "question":
      currentBubble = null;
      add(e.plan ? planCard(e.id, e.question, e.plan) : questionCard(e.id, e.question, e.options));
      break;
    case "plan_approved":
      planCards.get(e.plan.prototypeName)?.classList.add("approved");
      break;
    case "missing_components":
      if (e.items.length) add(h("section", { class: "card missing-card" }, h("div", { class: "card-title" }, "Missing from your component library"), missingList(e.items), h("p", { class: "muted" }, "Saved as MISSING_COMPONENTS.md in the prototype folder for engineering.")));
      break;
    case "preview": {
      const b = h("button", { class: "link" }, "Show preview");
      b.addEventListener("click", () => post({ type: "open_preview" }));
      add(h("div", { class: "note" }, "The live preview is up to date. ", b));
      break;
    }
    case "connections": {
      const off = e.items.filter((i) => i.state !== "connected");
      if (off.length) add(h("div", { class: "note muted" }, ...off.map((i) => h("div", {}, i.note))));
      break;
    }
    case "notice":
      add(h("div", { class: `notice ${e.level}` }, e.message));
      break;
    case "run_finished":
      setRunning(false);
      if (e.outcome === "stopped") add(h("div", { class: "notice info" }, "Stopped."));
      break;
  }
}

window.addEventListener("message", (event: MessageEvent<ExtensionToChat>) => {
  const msg = event.data;
  if (msg.type === "event") onEvent(msg.event);
  else if (msg.type === "reset") {
    log.replaceChildren(empty);
    planCards.clear();
    setRunning(false);
  } else if (msg.type === "state") {
    keyBanner.classList.toggle("hidden", msg.hasApiKey);
    showCode = msg.showCode;
    applyShowCode();
    protoSelect.replaceChildren(
      h("option", { value: "" }, "＋ New prototype"),
      ...msg.prototypes.map((p) => {
        const o = h("option", { value: p }, p);
        if (p === msg.activePrototype) o.selected = true;
        return o;
      }),
    );
  }
});

// ------------------------------------------------------------------ input

function send(): void {
  const text = input.value.trim();
  if (!text || running) return;
  const figmaUrl = figmaInput.value.trim() || undefined;
  add(h("div", { class: "msg user" }, text));
  if (figmaUrl) add(h("div", { class: "note muted" }, `Figma frame: ${figmaUrl}`));
  post({ type: "send", text, figmaUrl });
  input.value = "";
  figmaInput.value = "";
  figmaDetails.open = false;
}

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  send();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
stopBtn.addEventListener("click", () => post({ type: "stop" }));
previewBtn.addEventListener("click", () => post({ type: "open_preview" }));
codeToggle.addEventListener("change", () => {
  showCode = codeToggle.checked;
  applyShowCode();
  post({ type: "set_show_code", value: showCode });
});
document.getElementById("addKey")?.addEventListener("click", () => post({ type: "set_api_key" }));
protoSelect.addEventListener("change", () => {
  const name = protoSelect.value;
  post(name ? { type: "open_prototype", name } : { type: "new_prototype" });
});

post({ type: "ready" });
