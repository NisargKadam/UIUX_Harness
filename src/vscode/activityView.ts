import * as vscode from "vscode";
import type { ActivityItem, ConnectionStatus, RunState } from "../core/protocol";

type Node =
  | { kind: "current" }
  | { kind: "step"; item: ActivityItem }
  | { kind: "connections" }
  | { kind: "connection"; status: ConnectionStatus };

/**
 * Compact "What's happening" view: the current step in designer language, the
 * steps of the current request, and connection health. Raw tool names only
 * appear in tooltips.
 */
export class ActivityView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private items: ActivityItem[] = [];
  private connections: ConnectionStatus[] = [];
  private state: RunState = "idle";

  setRunState(state: RunState): void {
    if (state === "running" && this.state === "idle") this.items = [];
    this.state = state;
    this.changed.fire(undefined);
  }

  upsert(item: ActivityItem): void {
    const i = this.items.findIndex((x) => x.id === item.id);
    if (i === -1) this.items.push(item);
    else this.items[i] = item;
    if (this.items.length > 200) this.items.splice(0, this.items.length - 200);
    this.changed.fire(undefined);
  }

  setConnections(items: ConnectionStatus[]): void {
    this.connections = items;
    this.changed.fire(undefined);
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      const steps = [...this.items].reverse().map((item) => ({ kind: "step", item }) as Node);
      return [{ kind: "current" }, ...steps, ...(this.connections.length ? [{ kind: "connections" } as Node] : [])];
    }
    if (node.kind === "connections") return this.connections.map((status) => ({ kind: "connection", status }));
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case "current": {
        const running = [...this.items].reverse().find((i) => i.status === "running" && !/^(Reading your brief|Working on your feedback)$/.test(i.label));
        let label = "Ready";
        let icon = new vscode.ThemeIcon("circle-outline");
        if (this.state === "waiting_for_user") {
          label = "Waiting for you in the chat";
          icon = new vscode.ThemeIcon("comment-discussion");
        } else if (this.state === "running" || this.state === "stopping") {
          label = this.state === "stopping" ? "Stopping…" : running?.label ?? "Thinking…";
          icon = new vscode.ThemeIcon("loading~spin");
        }
        const item = new vscode.TreeItem(label);
        item.iconPath = icon;
        item.description = this.state === "idle" ? "" : "now";
        return item;
      }
      case "step": {
        const { item: a } = node;
        const t = new vscode.TreeItem(a.label);
        t.iconPath =
          a.status === "running"
            ? new vscode.ThemeIcon("loading~spin")
            : a.status === "done"
              ? new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"))
              : new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
        if (a.endedAt) t.description = `${Math.max(1, Math.round((a.endedAt - a.startedAt) / 1000))}s`;
        if (a.detail) t.tooltip = a.detail;
        return t;
      }
      case "connections": {
        const t = new vscode.TreeItem("Connections", vscode.TreeItemCollapsibleState.Collapsed);
        t.iconPath = new vscode.ThemeIcon("plug");
        t.description = this.connections.map((c) => (c.state === "connected" ? "●" : "○")).join(" ");
        return t;
      }
      case "connection": {
        const { status } = node;
        const names = { figma: "Figma", catalogue: "Component catalogue", playwright: "Review browser" } as const;
        const t = new vscode.TreeItem(names[status.name]);
        t.description = status.state;
        t.tooltip = status.note;
        t.iconPath = new vscode.ThemeIcon(status.state === "connected" ? "check" : status.state === "disabled" ? "circle-slash" : "warning");
        return t;
      }
    }
  }
}
