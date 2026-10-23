import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { DEFAULT_BASE_PATH, ENDPOINTS } from '../shared/constants';
import type { Manifest } from '../shared/types';

export interface ServeModulesOptions {
  /** Diretório com os bundles gerados (um `<nome>.js` por módulo). */
  modulesPath: string;
  /** Deve ser igual ao `appName` passado ao Modularize nos módulos. */
  appName: string;
  /** Prefixo de URL sob o qual manifesto e arquivos são servidos. */
  basePath?: string;
  /** Origens com permissão de CORS. `['*']` libera todas. Vazio = sem CORS. */
  corsOrigins?: string[];
}

type Next = (err?: unknown) => void;
export type ModulesMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next?: Next,
) => Promise<void>;

interface FileInfo {
  mtimeMs: number;
  size: number;
  hash: string;
}

function sha(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 10);
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha1');
    createReadStream(file)
      .on('data', (chunk) => h.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex').slice(0, 10)));
  });
}

export function serveModules(options: ServeModulesOptions): ModulesMiddleware {
  const { appName, corsOrigins = [] } = options;
  const root = path.resolve(options.modulesPath);
  const basePath = (options.basePath ?? DEFAULT_BASE_PATH).replace(/\/+$/, '');
  const manifestPath = `${basePath}${ENDPOINTS.modulesConfiguration}`;
  const fileCache = new Map<string, FileInfo>();

  async function buildManifest(): Promise<Manifest> {
    const entries = await readdir(root);
    const names = entries.filter((f) => f.endsWith('.js')).sort();
    const modules: Manifest['modules'] = {};
    const hashes: string[] = [];

    for (const file of names) {
      const full = path.join(root, file);
      const st = await stat(full);
      let info = fileCache.get(file);
      if (!info || info.mtimeMs !== st.mtimeMs || info.size !== st.size) {
        info = { mtimeMs: st.mtimeMs, size: st.size, hash: await hashFile(full) };
        fileCache.set(file, info);
      }
      const name = file.slice(0, -'.js'.length);
      modules[name] = { name, scripts: [`${basePath}/${file}?v=${info.hash}`] };
      hashes.push(`${file}:${info.hash}`);
    }

    return { appName, version: sha(hashes.join('|')), modules };
  }

  function applyCors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    if (!origin || corsOrigins.length === 0) return;
    if (corsOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }

  return async function modulesMiddleware(req, res, next) {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    const passThrough = () => {
      if (next) next();
      else {
        res.statusCode = 404;
        res.end();
      }
    };

    if (pathname !== manifestPath && !pathname.startsWith(`${basePath}/`)) {
      return passThrough();
    }
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      return passThrough();
    }

    applyCors(req, res);

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.end();
      return;
    }

    try {
      if (pathname === manifestPath) {
        const manifest = await buildManifest();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(method === 'HEAD' ? undefined : JSON.stringify(manifest));
        return;
      }

      let relative: string;
      try {
        relative = decodeURIComponent(pathname.slice(basePath.length + 1));
      } catch {
        res.statusCode = 400;
        res.end();
        return;
      }

      const full = path.resolve(root, relative);
      const insideRoot = full.startsWith(root + path.sep);
      const allowedExt = full.endsWith('.js') || full.endsWith('.js.map');
      if (!insideRoot || !allowedExt || relative.includes('\0')) {
        return passThrough();
      }

      const st = await stat(full).catch(() => null);
      if (!st?.isFile()) return passThrough();

      res.statusCode = 200;
      res.setHeader(
        'Content-Type',
        full.endsWith('.map') ? 'application/json; charset=utf-8' : 'application/javascript; charset=utf-8',
      );
      // Com ?v=<hash> o conteúdo é imutável; sem ele, sempre revalidar.
      res.setHeader(
        'Cache-Control',
        url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
      res.setHeader('Content-Length', String(st.size));
      if (method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(full).pipe(res);
    } catch (error) {
      if (next) return next(error);
      res.statusCode = 500;
      res.end();
    }
  };
}
