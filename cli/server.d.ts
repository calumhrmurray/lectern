import type { IncomingMessage, ServerResponse } from 'node:http';
export function mime(path: string): string;
export function safeJoin(root: string, urlPath: string): string | null;
export function send(res: ServerResponse, status: number, body: string, headers?: Record<string, string>): void;
export function serveFile(res: ServerResponse, filePath: string, head?: boolean): Promise<void>;
export function createWorkspaceHandler(rootDir: string, deckFile?: string | null, log?: (message: string) => void): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
