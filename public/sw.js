const OPFS_MARKER = '_game_ready';

const REMOTE_BASES = {
    vcsky: 'https://cdn.dos.zone/vcsky/',
    vcbr: 'https://br.cdn.dos.zone/vcsky/',
};

const CONTENT_TYPES = new Map([
    ['.wasm', 'application/wasm'],
    ['.js', 'application/javascript'],
    ['.json', 'application/json'],
    ['.html', 'text/html; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.txt', 'text/plain; charset=utf-8'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.svg', 'image/svg+xml'],
    ['.wav', 'audio/wav'],
    ['.mp3', 'audio/mpeg'],
    ['.ogg', 'audio/ogg'],
    ['.adf', 'application/octet-stream'],
    ['.dat', 'application/octet-stream'],
    ['.dff', 'application/octet-stream'],
    ['.txd', 'application/octet-stream'],
    ['.col', 'application/octet-stream'],
    ['.ipl', 'application/octet-stream'],
    ['.ide', 'application/octet-stream'],
    ['.ifp', 'application/octet-stream'],
    ['.img', 'application/octet-stream'],
    ['.dir', 'application/octet-stream'],
    ['.raw', 'application/octet-stream'],
    ['.bin', 'application/octet-stream'],
]);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const path = url.pathname;

    if ((path.startsWith('/vcsky/') || path.startsWith('/vcbr/')) &&
        (event.request.method === 'GET' || event.request.method === 'HEAD')) {
        event.respondWith(handleGameAssetRequest(event, url));
    }
});

function getContentType(filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.wasm.br')) return 'application/wasm';
    if (lower.endsWith('.js.br')) return 'application/javascript';
    if (lower.endsWith('.json.br')) return 'application/json';
    if (lower.endsWith('.css.br')) return 'text/css; charset=utf-8';
    if (lower.endsWith('.html.br')) return 'text/html; charset=utf-8';

    for (const [ext, type] of CONTENT_TYPES) {
        if (lower.endsWith(ext)) return type;
    }
    return 'application/octet-stream';
}

function buildHeaders(filename, size) {
    const headers = new Headers();
    headers.set('Content-Type', getContentType(filename));
    headers.set('Content-Length', String(size));
    headers.set('Accept-Ranges', 'bytes');
    if (filename.toLowerCase().endsWith('.br')) {
        headers.set('Content-Encoding', 'br');
    }
    return headers;
}

function parseRange(rangeHeader, size) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader || '');
    if (!match) return null;

    let start = match[1] === '' ? null : Number(match[1]);
    let end = match[2] === '' ? null : Number(match[2]);

    if (start === null && end === null) return null;
    if (start === null) {
        start = Math.max(0, size - end);
        end = size - 1;
    } else if (end === null || end >= size) {
        end = size - 1;
    }

    if (start > end || start < 0 || end >= size) return null;
    return { start, end };
}

function splitSafePath(pathname) {
    const parts = pathname.replace(/^\//, '').split('/').map(decodeURIComponent);
    if (!parts.length || !['vcsky', 'vcbr'].includes(parts[0])) {
        throw new Error('Unsupported asset path');
    }
    if (parts.some(part => !part || part === '.' || part === '..')) {
        throw new Error('Unsafe asset path');
    }
    return parts;
}

async function serveFromOPFS(request, pathname) {
    try {
        const root = await navigator.storage.getDirectory();
        const parts = splitSafePath(pathname);
        let dir = root;

        for (let i = 0; i < parts.length - 1; i++) {
            dir = await dir.getDirectoryHandle(parts[i]);
        }

        const filename = parts[parts.length - 1];
        const fileHandle = await dir.getFileHandle(filename);
        const file = await fileHandle.getFile();
        const headers = buildHeaders(filename, file.size);

        if (request.method === 'HEAD') {
            return new Response(null, { status: 200, headers });
        }

        const range = parseRange(request.headers.get('Range'), file.size);
        if (range) {
            headers.set('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
            headers.set('Content-Length', String(range.end - range.start + 1));
            return new Response(file.slice(range.start, range.end + 1), {
                status: 206,
                headers,
            });
        }

        return new Response(file, { status: 200, headers });
    } catch {
        return null;
    }
}

function getRemoteUrl(url) {
    if (url.pathname.startsWith('/vcsky/')) {
        const remote = new URL(url.pathname.slice('/vcsky/'.length), REMOTE_BASES.vcsky);
        remote.search = url.search;
        return remote.href;
    }

    if (url.pathname.startsWith('/vcbr/')) {
        const remote = new URL(url.pathname.slice('/vcbr/'.length), REMOTE_BASES.vcbr);
        remote.search = url.search;
        return remote.href;
    }

    throw new Error('Unsupported remote asset path');
}

async function cacheResponseInOPFS(pathname, response) {
    if (!response.body || response.status !== 200) return;

    const parts = splitSafePath(pathname);
    const root = await navigator.storage.getDirectory();
    let dir = root;

    for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
    }

    const filename = parts[parts.length - 1];
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    const reader = response.body.getReader();
    let written = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || value.byteLength === 0) continue;
            await writable.write(value);
            written += value.byteLength;
        }

        if (written === 0) {
            throw new Error('Remote asset returned an empty body');
        }

        await writable.close();
    } catch (error) {
        try { await writable.abort?.(); } catch {}
        try { await dir.removeEntry(filename); } catch {}
        throw error;
    }
}

async function fetchRemoteAsset(event, request, url) {
    const remoteUrl = getRemoteUrl(url);
    const headers = new Headers();
    const range = request.headers.get('Range');
    const ifRange = request.headers.get('If-Range');

    if (range) headers.set('Range', range);
    if (ifRange) headers.set('If-Range', ifRange);

    let response;
    try {
        response = await fetch(remoteUrl, {
            method: request.method,
            headers,
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'follow',
        });
    } catch (error) {
        return new Response(`Streaming fetch failed: ${error.message}`, {
            status: 502,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }

    if (!response.ok && response.status !== 206) {
        return response;
    }

    // Only complete non-range GETs are cached. Partial responses are never
    // written to the final OPFS path, preventing corrupt local assets.
    if (request.method === 'GET' && !range && response.status === 200 && response.body) {
        const cacheCopy = response.clone();
        event.waitUntil(
            cacheResponseInOPFS(url.pathname, cacheCopy).catch(error => {
                console.warn('[sw] OPFS stream cache failed:', url.pathname, error);
            }),
        );
    }

    return response;
}

async function handleGameAssetRequest(event, url) {
    const local = await serveFromOPFS(event.request, url.pathname);
    if (local) return local;
    return fetchRemoteAsset(event, event.request, url);
}

self.addEventListener('message', async event => {
    if (event.data?.type === 'IS_READY') {
        const ready = await isGameReady();
        const port = event.ports[0] || event.source;
        if (port) port.postMessage({ type: 'IS_READY', ready });
    }
});

async function isGameReady() {
    try {
        const root = await navigator.storage.getDirectory();
        await root.getFileHandle(OPFS_MARKER);
        return true;
    } catch {
        return false;
    }
}
