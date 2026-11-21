/**
 * Messages between the agent core, the extension host and the webviews. Pure
 * types with no imports, so the webview bundle can share them.
 */

export interface PlanScreen {
  id: string;
  name: string;
  /** Hash route, e.g. "/settings/profile". */
  route: string;
  purpose: string;
  /** Catalogue components the screen will use. */
  components: string[];
}

export interface PlanFlowStep {
  from: string;
  /** What the user does, e.g. "clicks Notifications tab". */
  action: string;
  to: string;
}

export interface MissingComponent {
  /** What the design needs, e.g. "Date picker". */
  need: string;
  /** Closest primitive used instead. */
  usingInstead: string;
  /** Why nothing in the catalogue fits. */
  reason: string;
  /** Screens where it appears. */
  screens?: string[];
}

export interface PrototypePlan {
  prototypeName: string;
  title: string;
  summary: string;
  screens: PlanScreen[];
  flow: PlanFlowStep[];
  missingComponents: MissingComponent[];
  assumptions: string[];
}

export type ActivityStatus = "running" | "done" | "failed";

export interface ActivityItem {
  id: string;
  label: string;
  status: ActivityStatus;
  /** Optional technical detail (only shown when "show details" is on). */
  detail?: string;
  startedAt: number;
  endedAt?: number;
}

export type ConnectionState = "connected" | "unavailable" | "disabled";

export interface ConnectionStatus {
  name: "figma" | "catalogue" | "playwright";
  state: ConnectionState;
  /** Plain-language note, e.g. "Using Storybook at http://localhost:6006". */
  note: string;
}

export type RunState = "idle" | "running" | "waiting_for_user" | "stopping";

/** Events the core emits. The extension forwards most of them to the chat webview. */
export type HarnessEvent =
  | { type: "run_state"; state: RunState; prototype?: string }
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_done" }
  | { type: "activity"; item: ActivityItem }
  | { type: "file_written"; path: string; created: boolean; diff: string }
  | { type: "question"; id: string; question: string; options: string[]; plan?: PrototypePlan }
  | { type: "plan_approved"; plan: PrototypePlan }
  | { type: "missing_components"; items: MissingComponent[] }
  | { type: "preview"; url: string; route?: string }
  | { type: "connections"; items: ConnectionStatus[] }
  | { type: "notice"; level: "info" | "warning" | "error"; message: string }
  | { type: "run_finished"; outcome: "done" | "stopped" | "failed" | "limit"; summary?: string };

/** Webview (chat) -> extension. */
export type ChatToExtension =
  | { type: "ready" }
  | { type: "send"; text: string; figmaUrl?: string }
  | { type: "answer"; id: string; answer: string; approved?: boolean }
  | { type: "stop" }
  | { type: "set_api_key" }
  | { type: "new_prototype" }
  | { type: "open_prototype"; name: string }
  | { type: "open_preview" }
  | { type: "set_show_code"; value: boolean };

/** Extension -> webview (chat). */
export type ExtensionToChat =
  | { type: "event"; event: HarnessEvent }
  | {
      type: "state";
      hasApiKey: boolean;
      prototypes: string[];
      activePrototype?: string;
      showCode: boolean;
      model: string;
    }
  | { type: "reset" };

/** Extension -> preview webview. */
export type ExtensionToPreview = { type: "navigate"; url: string } | { type: "reload" };
/** Preview webview -> extension. */
export type PreviewToExtension = { type: "open_external"; url: string } | { type: "reload" };
