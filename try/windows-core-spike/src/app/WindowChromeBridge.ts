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
