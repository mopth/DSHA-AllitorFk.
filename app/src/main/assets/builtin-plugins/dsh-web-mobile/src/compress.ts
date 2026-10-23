/**
 * TypeScript source of lib/compress.js (AllitorFk: realigned with the shipped
 * DSHA implementation; the canonical runtime file is tools/mobile-server/compress.js
 * deployed as lib/compress.js — keep both in step, see tools/test-mobile-compress-once.mjs).
 *
 * DSHA bounded compression for complete JSON responses.
 * Only a single end(data) can be compressed. Every write() is delegated at
 * once, with its original encoding, callback and backpressure. Headers alone
 * may wait one event-loop turn; no response body is ever accumulated here.
 * SSE, HEAD, already encoded bodies and oversized JSON remain native streams.
 *
 * AllitorFk defensive guard (download "Failed to fetch"; root cause NOT
 * confirmed): a response is compressed at most once. Any Content-Encoding
 * visible at end() time (headers set after writeHead, another layer such as
 * the host's compression middleware), a body that already looks encoded, or a
 * declared Content-Length that disagrees with the body passes through
 * byte-identical, so the declared length always describes the bytes sent.
 */
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import { ServerResponse as NodeServerResponse } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Headers = Record<string, string | number | string[] | undefined>;
type Encoding = 'br' | 'gzip';
interface Pending {
    args: unknown[];
    headers: Headers;
    timer?: ReturnType<typeof setImmediate>;
    onClose?: () => void;
}
interface Options {
    matches?: (req: IncomingMessage | undefined, res: ServerResponse) => boolean;
}
// Node keeps these on the instance; the patch only reads them.
type Response = ServerResponse & { req?: IncomingMessage; strictContentLength?: boolean };

const MIN_JSON_BYTES = 4 * 1024;
export const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_COMPRESSIONS = 2;
let inflight = 0;
const deferred = new WeakMap<ServerResponse, Pending>();

export function headerValue(headers: Headers, name: string): string | undefined {
    const key = Object.keys(headers).find(key => key.toLowerCase() === name);
    return key === undefined ? undefined : String(headers[key]);
}
export function isDeferrable(headers: Headers): boolean {
    return headerValue(headers, 'content-encoding') === undefined
        && /(?:^|\s|;)application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(headerValue(headers, 'content-type') ?? '')
        && !/\bno-transform\b/i.test(headerValue(headers, 'cache-control') ?? '')
        && headerValue(headers, 'content-range') === undefined
        && headerValue(headers, 'transfer-encoding') === undefined
        && headerValue(headers, 'content-md5') === undefined
        && !/^"/.test(headerValue(headers, 'etag') ?? '');
}
export function varyWithAcceptEncoding(headers: Headers): void {
    const key = Object.keys(headers).find(key => key.toLowerCase() === 'vary') ?? 'vary';
    const value = String(headers[key] ?? '');
    if (!value.split(',').some(token => /^(?:accept-encoding|\*)$/i.test(token.trim())))
        headers[key] = value ? `${value}, Accept-Encoding` : 'Accept-Encoding';
}
function pickEncoding(res: Response): Encoding | null {
    const values = new Map<string, number>();
    for (const part of String(res.req?.headers['accept-encoding'] ?? '').split(',')) {
        const [name, ...params] = part.trim().toLowerCase().split(';');
        const q = params.find(value => /^\s*q\s*=/.test(value));
        const quality = q === undefined ? 1 : Number(q.split('=')[1]);
        values.set(name, Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0);
    }
    const br = values.get('br') ?? values.get('*') ?? 0;
    const gzip = values.get('gzip') ?? values.get('*') ?? 0;
    return br > 0 && br >= gzip ? 'br' : gzip > 0 ? 'gzip' : null;
}
/** Defensive: JSON text never starts with a gzip or zstd frame magic. */
export function looksEncoded(body: Uint8Array): boolean {
    return body.byteLength >= 2 && body[0] === 0x1f && body[1] === 0x8b
        || body.byteLength >= 4 && body[0] === 0x28 && body[1] === 0xb5 && body[2] === 0x2f && body[3] === 0xfd;
}
/** Defensive: never re-frame a body whose declared length is not its real length. */
export function declaredLengthMatches(headers: Headers, body: Uint8Array): boolean {
    const declared = headerValue(headers, 'content-length');
    if (declared === undefined) return true;
    return /^\d+$/.test(declared.trim()) && Number(declared.trim()) === body.byteLength;
}
/** Defensive: another layer may have chosen an encoding after writeHead. */
export function alreadyEncoded(res: ServerResponse, headers: Headers): boolean {
    if (headerValue(headers, 'content-encoding') !== undefined) return true;
    try { return res.getHeader('content-encoding') !== undefined; }
    catch { return true; }
}
function hasBody(res: Response, status: number = res.statusCode): boolean {
    return res.req?.method !== 'HEAD' && status >= 200 && ![204, 205, 206, 304].includes(status);
}
function snapshotHeaders(headers: Headers): Headers {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value.slice() : value]));
}
function mergedHeaders(base: Headers, overlay: Headers): Headers {
    const headers: Headers = { ...base };
    for (const [name, value] of Object.entries(overlay)) {
        for (const key of Object.keys(headers))
            if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
        headers[name] = value;
    }
    return headers;
}

export function installResponseCompression({ matches = () => true }: Options = {}): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = NodeServerResponse.prototype as any;
    const origWriteHead = proto.writeHead;
    const origWrite = proto.write;
    const origEnd = proto.end;
    const origFlushHeaders = proto.flushHeaders;
    const active = new Set<Response>();
    const nativeBody = new WeakSet<Response>();
    function delegate(method: (...args: unknown[]) => unknown, res: Response, args: unknown[]): any {
        nativeBody.add(res);
        try { return method.apply(res, args); }
        finally { nativeBody.delete(res); }
    }
    function belongs(res: Response): boolean {
        try { return matches(res.req, res) === true; }
        catch { return false; }
    }
    // end() has accepted the complete body while libuv compresses it. Keep
    // Node's public end guard so a subsequent write/end follows its native
    // error path. Do not change any private stream/socket fields. The false
    // writableFinished view lasts only until the compressed native end.
    function reserveEnd(res: Response): ((closed?: boolean) => void) | undefined {
        const finished = Object.getOwnPropertyDescriptor(res, 'finished');
        if (!finished?.configurable || !finished.writable || finished.value !== false
            || Object.hasOwn(res, 'writableFinished')) return undefined;
        let value = finished.value;
        Object.defineProperty(res, 'finished', { configurable: true, enumerable: finished.enumerable,
            get: () => true, set: (next: boolean) => { value = next; } });
        Object.defineProperty(res, 'writableFinished', { configurable: true, get: () => false });
        return (closed = false) => {
            Object.defineProperty(res, 'finished', { ...finished, value: closed || value });
            delete (res as { writableFinished?: boolean }).writableFinished;
        };
    }

    function take(res: Response): Pending | undefined {
        const pending = deferred.get(res);
        if (pending !== undefined) {
            deferred.delete(res);
            active.delete(res);
            if (pending.timer !== undefined) clearImmediate(pending.timer);
            if (pending.onClose !== undefined) res.off('close', pending.onClose);
        }
        return pending;
    }
    function flush(res: Response): void {
        const pending = take(res);
        if (pending !== undefined && !res.destroyed)
            origWriteHead.apply(res, pending.args);
    }
    function patchedWriteHead(this: Response, ...args: unknown[]): Response {
        flush(this);
        const raw = typeof args[1] === 'string' ? args[2] : args[1];
        // Raw header arrays, including duplicate headers, keep Node's exact path.
        if (Array.isArray(raw) || (raw !== undefined && (raw === null || typeof raw !== 'object')))
            return origWriteHead.apply(this, args);
        const headers = mergedHeaders(this.getHeaders() as Headers, (raw ?? {}) as Headers);
        if (!belongs(this) || nativeBody.has(this) || this.headersSent || !hasBody(this, Number(args[0])) || !isDeferrable(headers) || pickEncoding(this) === null)
            return origWriteHead.apply(this, args);
        // Use Node itself to validate all overloads/status/header values now,
        // rather than deferring a native exception into an unrelated timer.
        const validation = new NodeServerResponse(this.req as IncomingMessage);
        for (const [name, value] of Object.entries(this.getHeaders())) validation.setHeader(name, value as string | number | readonly string[]);
        const copied = args.slice();
        if (raw !== undefined) copied[typeof args[1] === 'string' ? 2 : 1] = snapshotHeaders(raw as Headers);
        origWriteHead.apply(validation, copied);
        this.statusCode = validation.statusCode;
        this.statusMessage = validation.statusMessage;
        const pending: Pending = { args: copied, headers: (raw === undefined ? {} : copied[typeof args[1] === 'string' ? 2 : 1]) as Headers };
        pending.onClose = () => take(this);
        pending.timer = setImmediate(() => flush(this));
        deferred.set(this, pending);
        active.add(this);
        this.once('close', pending.onClose);
        return this;
    }
    function patchedWrite(this: Response, ...args: unknown[]): boolean {
        flush(this);
        return delegate(origWrite, this, args);
    }
    function patchedFlushHeaders(this: Response, ...args: unknown[]): void {
        flush(this);
        return delegate(origFlushHeaders, this, args);
    }
    function patchedEnd(this: Response, ...args: unknown[]): Response {
        const pending = deferred.get(this);
        const headers = mergedHeaders(this.getHeaders() as Headers, pending?.headers ?? {});
        const encoding = pickEncoding(this);
        const chunk = args[0];
        const textEncoding = typeof args[1] === 'string' ? args[1] : undefined;
        let body: Buffer | undefined;
        const validEncodingArgument = args[1] === undefined || typeof args[1] === 'string' || typeof args[1] === 'function';
        const validCallbackArgument = typeof args[1] === 'function' || args[2] === undefined || typeof args[2] === 'function';
        if (belongs(this) && inflight < MAX_COMPRESSIONS && !this.finished && !this.headersSent && !this.destroyed && !this.strictContentLength && validEncodingArgument && validCallbackArgument && hasBody(this) && isDeferrable(headers) && encoding !== null) {
            if (typeof chunk === 'string') {
                // Preserve invalid-encoding errors through the native end path.
                if (textEncoding === undefined || Buffer.isEncoding(textEncoding)) {
                    const bytes = Buffer.byteLength(chunk, textEncoding as BufferEncoding | undefined);
                    if (bytes >= MIN_JSON_BYTES && bytes <= MAX_JSON_BYTES) body = Buffer.from(chunk, textEncoding as BufferEncoding | undefined);
                }
            } else if (chunk instanceof Uint8Array && chunk.byteLength >= MIN_JSON_BYTES && chunk.byteLength <= MAX_JSON_BYTES) {
                body = Buffer.from(chunk);
            }
        }
        if (body !== undefined && (alreadyEncoded(this, headers) || looksEncoded(body)
            || !declaredLengthMatches(headers, body)))
            body = undefined;
        if (body === undefined) {
            flush(this);
            return delegate(origEnd, this, args);
        }
        const restoreEnd = reserveEnd(this);
        if (restoreEnd === undefined) {
            flush(this);
            return delegate(origEnd, this, args);
        }
        take(this);
        for (const key of Object.keys(headers))
            if (key.toLowerCase() === 'content-length') delete headers[key];
        headers['content-encoding'] = encoding as Encoding;
        varyWithAcceptEncoding(headers);
        this.removeHeader('content-length');
        // Commit the selected representation now. Its size is not known until
        // the worker finishes, so Node supplies its native chunked boundary.
        // This also preserves synchronous header validation and headersSent.
        try { origWriteHead.call(this, this.statusCode, this.statusMessage, headers); }
        catch (error) { restoreEnd(); throw error; }
        const callback = typeof args[1] === 'function' ? args[1] : args[2];
        let called = false, complete = false;
        const done = (error?: Error): void => {
            if (called) return;
            called = true;
            if (typeof callback === 'function') (callback as (error?: Error) => void)(error);
        };
        const finish = (error?: Error | null, compressed?: Buffer): void => {
            if (complete) return;
            complete = true;
            this.off('close', onClose);
            restoreEnd(Boolean(error) || this.destroyed);
            if (error || this.destroyed) {
                const failure: Error = error ?? Object.assign(new Error('response closed during compression'), { code: 'ERR_STREAM_PREMATURE_CLOSE' });
                this.destroy(failure);
                queueMicrotask(() => done(failure));
                return;
            }
            // The original encoding was consumed by Buffer.from; only end's
            // callback remains. Node still owns socket writes/backpressure.
            origEnd.call(this, compressed, done);
        };
        const onClose = () => finish();
        this.once('close', onClose);
        inflight++;
        const compressed = (error: Error | null, bytes: Buffer): void => { inflight--; finish(error, bytes); };
        try {
            if (encoding === 'br') brotliCompress(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } }, compressed);
            else gzip(body, { level: 4 }, compressed);
        } catch (error) { inflight--; finish(error as Error); }
        return this;
    }
    proto.writeHead = patchedWriteHead;
    proto.write = patchedWrite;
    proto.end = patchedEnd;
    proto.flushHeaders = patchedFlushHeaders;
    return () => {
        for (const res of active) flush(res);
        // Already accepted end bodies retain their worker and callback until
        // completion. Unload restores the hook immediately and never cancels
        // or resends a response that another route still owns.
        if (proto.writeHead === patchedWriteHead) proto.writeHead = origWriteHead;
        if (proto.write === patchedWrite) proto.write = origWrite;
        if (proto.end === patchedEnd) proto.end = origEnd;
        if (proto.flushHeaders === patchedFlushHeaders) proto.flushHeaders = origFlushHeaders;
    };
}
