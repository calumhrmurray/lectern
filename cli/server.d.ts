import type { IncomingMessage, ServerResponse } from 'node:http';
export function mime(path: string): string;
export function safeJoin(root: string, urlPath: string): string | null;
/** Real path of `p` (symlinks resolved, missing trailing segments kept) when it lies inside `root`, else null. */
export function realInside(root: string, p: string): Promise<string | null>;
export function isLoopbackHost(host: string | null | undefined): boolean;
/** null when the request's Host/Origin are acceptable for a server bound to `bindHost`, else the reason. */
export function requestAllowed(headers: { host?: string; origin?: string }, bindHost?: string): string | null;
export function send(res: ServerResponse, status: number, body: string, headers?: Record<string, string>): void;
export function serveFile(res: ServerResponse, filePath: string, head?: boolean): Promise<void>;
export function createWorkspaceHandler(rootDir: string, deckFile?: string | null, log?: (message: string) => void, options?: { host?: string }): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
