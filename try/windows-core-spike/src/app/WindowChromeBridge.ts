import { getCurrentWindow, type Window } from "@tauri-apps/api/window";

export interface WindowChromeBridge {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}

export class NoopWindowChromeBridge implements WindowChromeBridge {
  async minimize(): Promise<void> {}

  async toggleMaximize(): Promise<void> {}

  async close(): Promise<void> {}
}

export class TauriWindowChromeBridge implements WindowChromeBridge {
  private readonly window: Window;

  constructor(window: Window = getCurrentWindow()) {
    this.window = window;
  }

  minimize(): Promise<void> {
    return this.window.minimize();
  }

  toggleMaximize(): Promise<void> {
    return this.window.toggleMaximize();
  }

  close(): Promise<void> {
    return this.window.close();
  }
}
