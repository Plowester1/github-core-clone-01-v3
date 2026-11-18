import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isoOf, type Store, type User } from './store.ts';
import {
  advertiseV0,
  advertiseV2,
  fetchResponse,
  lsRefsV2,
  parseFetchRequest,
  parseLsRefsRequest,
  receivePack,
  type GitService,
} from './git.ts';
import { getRepo, handleRest, sendJson } from './rest.ts';
import { handleGraphQL } from './graphql.ts';
import { handleMcp } from './mcp.ts';

export interface RunningServer {
  server: Server;
  port: number;
}

function createStoreInstance(): Store {
  const epochSec = 1700000000;
  const viewer: User = { id: 1, login: 'adaiversen', name: 'Ada Iversen', email: 'adaiversen@example.invalid' };
  return {
    nextUserId: 2,
    nextRepoId: 1,
    nextIssueId: 1,
    nextPullId: 1,
    nextCommentId: 1,
    users: new Map<string, User>([[viewer.login, viewer]]),
    repos: new Map(),
    viewer,
    epochSec,
    nowIso: isoOf(epochSec),
  };
}

const store = createStoreInstance();

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 1) return chunks[0];
  return Buffer.concat(chunks);
}

function bearerToken(req: IncomingMessage): string {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string') return '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : authorization.trim();
}

function authorized(req: IncomingMessage): boolean {
  const expected = process.env.MAKEFUN_SHOP_TOKEN;
  return expected === undefined || expected === '' || bearerToken(req) === expected;
}

interface GitParts {
  owner: string;
  repo: string;
  operation: string;
}

function gitParts(pathname: string): GitParts | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  const operation = parts.slice(2).join('/');
  if (operation !== 'info/refs' && operation !== 'git-upload-pack' && operation !== 'git-receive-pack') return null;
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, ''), operation };
}

function sendGitBuffer(res: ServerResponse, status: number, contentType: string, body: Buffer): void {
  res.writeHead(status, { 'content-type': contentType, 'content-length': body.length });
  res.end(body);
}

function handleGitHttp(req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer, parts: GitParts): void {
  const repo = getRepo(store, parts.owner, parts.repo);
  if (repo === null) {
    sendJson(res, 404, { message: 'Not Found' });
    return;
  }
  const requestedService = parts.operation === 'git-receive-pack' ? 'git-receive-pack' : 'git-upload-pack';
  const protocol = req.headers['git-protocol'];
  const versionTwo = typeof protocol === 'string' && protocol.split(',').some((item) => item.trim() === 'version=2');
  if (parts.operation === 'info/refs') {
    const queryService = url.searchParams.get('service');
    const service: GitService = queryService === 'git-receive-pack' ? 'git-receive-pack' : requestedService;
    const advertisement = versionTwo ? advertiseV2(repo, service) : advertiseV0(repo, service);
    sendGitBuffer(res, 200, `application/x-${service}-advertisement`, advertisement);
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { message: 'Method Not Allowed' });
    return;
  }
  if (parts.operation === 'git-receive-pack') {
    const result = receivePack(repo, body);
    sendGitBuffer(res, 200, 'application/x-git-receive-pack-result', result);
    return;
  }
  const lsRefsArgs = parseLsRefsRequest(body);
  if (lsRefsArgs !== null) {
    sendGitBuffer(res, 200, 'application/x-git-upload-pack-result', lsRefsV2(repo, lsRefsArgs));
    return;
  }
  const request = parseFetchRequest(body, versionTwo);
  const response = fetchResponse(repo, request, versionTwo);
  sendGitBuffer(res, 200, 'application/x-git-upload-pack-result', response);
}

function restSegments(pathname: string): string[] {
  let path = pathname;
  if (path.startsWith('/api/v3')) path = path.slice('/api/v3'.length);
  else if (path.startsWith('/api/')) path = path.slice('/api/'.length);
  return path.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
}

let requestCounter = 0;

const server = createServer((req, res) => {
  void (async () => {
    res.setHeader('x-github-request-id', String(++requestCounter));
    const method = req.method ?? 'GET';
    const body = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE' ? await readBody(req) : Buffer.alloc(0);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    if (pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }
    if (pathname === '/done') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"ok":true}\n', () => {
        server.close(() => process.exit(0));
        server.closeAllConnections();
      });
      return;
    }
    if (!authorized(req)) {
      sendJson(res, 401, { message: 'Unauthorized' });
      return;
    }
    if (pathname === '/api/graphql' || pathname === '/graphql') {
      handleGraphQL(store, { method: req.method ?? 'GET', body: body.toString('utf8'), token: bearerToken(req) }, res);
      return;
    }
    if (pathname === '/mcp') {
      handleMcp(store, { method: req.method ?? 'GET', body: body.toString('utf8'), headers: req.headers }, res);
      return;
    }
    const git = gitParts(pathname);
    if (git !== null) {
      handleGitHttp(req, res, url, body, git);
      return;
    }
    if (pathname === '/api/v3' || pathname.startsWith('/api/') || pathname.startsWith('/user') || pathname.startsWith('/repos') || pathname.startsWith('/meta') || pathname.startsWith('/rate_limit')) {
      handleRest(store, { method: req.method ?? 'GET', segments: restSegments(pathname), query: url.searchParams, body: body.toString('utf8'), token: bearerToken(req), origin: `http://${req.headers.host ?? '127.0.0.1'}` }, res);
      return;
    }
    sendJson(res, 404, { message: 'Not Found' });
  })().catch(() => {
    if (!res.headersSent) sendJson(res, 400, { message: 'Bad Request' });
    else res.end();
  });
});

export function startServer(): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ server, port });
    });
  });
}
