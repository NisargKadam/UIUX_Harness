/** Figma URL parsing: figma.com/design/:fileKey/:name?node-id=1-2 -> { fileKey, nodeId: "1:2" }. */
export interface FigmaRef {
  url: string;
  fileKey: string;
  nodeId?: string;
  kind: "design" | "file" | "proto" | "make" | "board";
}

export function parseFigmaUrl(raw: string): FigmaRef | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  const kind = parts[0] as FigmaRef["kind"] | undefined;
  if (!kind || !["design", "file", "proto", "make", "board"].includes(kind) || !parts[1]) return undefined;
  // Branch URLs: /design/:fileKey/branch/:branchKey/:name -> the branch key is the file key.
  const fileKey = parts[2] === "branch" && parts[3] ? parts[3] : parts[1];
  const node = url.searchParams.get("node-id");
  const ref: FigmaRef = { url: url.toString(), fileKey, kind };
  if (node) ref.nodeId = node.replace(/-/g, ":");
  return ref;
}

/** Find the first Figma URL in free text. */
export function findFigmaUrl(text: string): FigmaRef | undefined {
  for (const m of text.matchAll(/https?:\/\/(?:www\.)?figma\.com\/[^\s)>\]]+/g)) {
    const ref = parseFigmaUrl(m[0]);
    if (ref) return ref;
  }
  return undefined;
}
