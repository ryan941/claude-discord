export interface ChatChannel {
  send(text: string): Promise<void>;
  sendTyping(): void;
}

export interface ReplyHandler {
  sendResult(chunk: string, isFirst: boolean): Promise<void>;
  sendError(errorMsg: string): Promise<void>;
}

export interface PlatformAdapter {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}
