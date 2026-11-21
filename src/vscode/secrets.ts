import * as vscode from "vscode";

const KEY = "uiuxHarness.anthropicApiKey";

/**
 * The Anthropic API key lives only in VS Code SecretStorage, encrypted by the OS
 * keychain. It is never written to settings, logs or the workspace.
 */
export class ApiKeyStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  get onDidChange(): vscode.Event<vscode.SecretStorageChangeEvent> {
    return this.secrets.onDidChange;
  }

  async get(): Promise<string | undefined> {
    const key = await this.secrets.get(KEY);
    return key && key.trim() !== "" ? key : undefined;
  }

  async has(): Promise<boolean> {
    return (await this.get()) !== undefined;
  }

  /** Ask for the key with a password box and store it. Returns true when a key was saved. */
  async prompt(): Promise<boolean> {
    const value = await vscode.window.showInputBox({
      title: "Anthropic API key",
      prompt: "Paste your Anthropic API key. It is stored securely in VS Code's secret storage, not in settings or your project.",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "sk-ant-…",
      validateInput: (v) => (v.trim().length < 20 ? "That doesn't look like an API key." : undefined),
    });
    if (!value) return false;
    await this.secrets.store(KEY, value.trim());
    return true;
  }

  async clear(): Promise<void> {
    await this.secrets.delete(KEY);
  }
}
