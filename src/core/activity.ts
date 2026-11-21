/**
 * Plain-language labels for what the agent is doing ("Building the Profile
 * screen"), not raw tool calls (write_file prototypes/x/screens/ProfileScreen.tsx).
 * The model can pass its own `activity` label on built-in tools; otherwise
 * these heuristics are used.
 */

function humanise(identifier: string): string {
  return identifier
    .replace(/\.(tsx?|jsx?|css|json|md|html)$/, "")
    .replace(/(Screen|Page|View)$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

function routeName(url: string): string {
  const hash = url.split("#")[1];
  if (!hash || hash === "/") return "the start screen";
  const parts = hash.split("/").filter(Boolean);
  return `the ${parts.map(humanise).join(" › ")} screen`;
}

export function activityLabel(tool: string, input: Record<string, unknown>): string {
  const explicit = typeof input.activity === "string" ? input.activity.trim() : "";
  if (explicit) return explicit.slice(0, 80);
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");

  switch (tool) {
    case "read_file": {
      const p = str("path");
      if (/components?\//.test(p) && /\.(tsx?|jsx?)$/.test(p)) return `Looking at the ${humanise(basename(p))} component`;
      if (/tokens?/.test(p)) return "Checking the design tokens";
      if (!/\.[a-z]+$/.test(basename(p))) return "Looking around the project";
      return `Reading ${basename(p)}`;
    }
    case "write_file": {
      const p = str("path");
      const file = basename(p);
      if (/\/screens\//.test(p)) return `Building the ${humanise(file)} screen`;
      if (/\/mock\//.test(p)) return "Preparing sample data";
      if (/\/parts\//.test(p)) return `Assembling the ${humanise(file)} section`;
      if (file === "App.tsx") return "Wiring up navigation between screens";
      if (file.endsWith(".css")) return "Adjusting the page layout";
      if (file === "MISSING_COMPONENTS.md") return "Updating the missing components list";
      return `Updating ${humanise(file)}`;
    }
    case "run_command":
      switch (str("command")) {
        case "dev_server":
          return "Starting the live preview";
        case "typecheck":
          return "Checking the prototype for errors";
        case "lint":
          return "Tidying up the code";
      }
      return "Running a check";
    case "get_diagnostics":
      return "Checking for problems";
    case "preview": {
      const action = str("action");
      if (action === "reload") return "Refreshing the preview";
      if (action === "navigate") return `Showing ${routeName(`#${str("route")}`)}`;
      return "Opening the preview";
    }
    case "ask_user":
      return input.plan ? "Waiting for your OK on the plan" : "Waiting for your answer";
  }

  if (tool.startsWith("catalogue__")) {
    const name = str("name");
    if (name) return `Looking up the ${name} component`;
    if (/token/.test(tool)) return "Checking the design tokens";
    return "Browsing the component library";
  }
  if (tool.startsWith("figma__")) {
    if (/screenshot/.test(tool)) return "Taking a picture of the Figma frame";
    if (/variable/.test(tool)) return "Reading Figma colours and spacing";
    if (/metadata/.test(tool)) return "Reading the Figma frame's structure";
    return "Reading the Figma design";
  }
  if (tool.startsWith("playwright__")) {
    const t = tool.replace("playwright__", "");
    const element = str("element");
    switch (t) {
      case "browser_navigate":
        return `Visiting ${routeName(str("url"))}`;
      case "browser_click":
        return element ? `Clicking “${element.slice(0, 40)}”` : "Clicking through the flow";
      case "browser_type":
      case "browser_fill_form":
        return element ? `Typing into “${element.slice(0, 40)}”` : "Filling in a form";
      case "browser_take_screenshot":
        return "Taking a screenshot to compare";
      case "browser_snapshot":
        return "Looking at the page";
      case "browser_resize":
        return "Trying a different screen size";
      case "browser_press_key":
        return "Testing the keyboard";
      case "browser_console_messages":
        return "Checking for browser errors";
      default:
        return "Testing the prototype in a browser";
    }
  }
  return "Working";
}
