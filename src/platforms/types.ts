export type VerbosityMode = "quiet" | "normal" | "verbose";

export interface ChatChannel {
  /** Send a message, return message ID for later edit/react */
  send(text: string): Promise<string | undefined>;
  /** Show typing indicator */
  sendTyping(): void;
  /** Edit an already-sent message in place */
  edit(messageId: string, text: string): Promise<void>;
  /** Add emoji reaction to a message */
  react(messageId: string, emoji: string): Promise<void>;
  /** Remove emoji reaction from a message */
  removeReact(messageId: string, emoji: string): Promise<void>;
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
