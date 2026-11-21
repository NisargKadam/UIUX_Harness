import type { Diagnostic } from "./adapters/types";
import type { HarnessEvent, PrototypePlan } from "./protocol";

export interface AskUserRequest {
  id: string;
  question: string;
  options: string[];
  plan?: PrototypePlan;
}

export interface AskUserResponse {
  answer: string;
  /** Set when the designer pressed "Build it" on a plan card. */
  approved?: boolean;
}

/**
 * What the agent core needs from its environment. The VS Code extension
 * implements it with webviews, SecretStorage and the diagnostics API
 * (src/vscode/host.ts). The headless CLI implements it with stdout and
 * auto-answers (scripts/run-headless.ts).
 */
export interface HarnessHost {
  emit(event: HarnessEvent): void;
  askUser(request: AskUserRequest, signal: AbortSignal): Promise<AskUserResponse>;
  /**
   * Problems the editor knows about in the prototype folder (TypeScript, ESLint
   * extension, CSS...). Returning undefined means "not supported here", and the
   * tool then falls back to running the type checker.
   */
  getDiagnostics(protoRelDir: string, signal: AbortSignal): Promise<Diagnostic[] | undefined>;
  preview: {
    open(url: string): Promise<void>;
    navigate(url: string): Promise<void>;
    reload(): Promise<void>;
  };
  log(message: string): void;
}
