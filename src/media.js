import { DurableObject } from "cloudflare:workers";

export const MIB = 1024 * 1024;
export const PART = MIB;
export const UPLOAD_CHUNK = 4 * MIB;
export const AUDIO_LIMIT = 200 * MIB;
export const ACCOUNT_LIMIT = 750 * MIB;
export const COMMUNITY_LIMIT = 3 * 1024 * MIB;
export const UPLOAD_TTL = 24 * 60 * 60 * 1000;

export function streamAudio(ctx, start, end, getPart) {
  let offset = start;
  const source = new ReadableStream({
    pull(controller) {
      if (offset > end) {
        controller.close();
        return;
      }
      const part = getPart(Math.floor(offset / PART));
      if (!part) {
        controller.error(new Error("Archivo incompleto"));
        return;
      }
      const bytes = new Uint8Array(part);
      const from = offset % PART;
      const length = Math.min(end - offset + 1, bytes.length - from);
      controller.enqueue(bytes.subarray(from, from + length));
      offset += length;
    }
  });
  const { readable, writable } = new FixedLengthStream(end - start + 1);
  ctx.waitUntil(source.pipeTo(writable).catch(() => {}));
  return readable;
}

// Each upload gets its own database, so a long stream or a large file never
// competes for the legacy SQLite object's storage or holds its output gate.
export class LarpMediaV2 extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS progress (id TEXT PRIMARY KEY, received INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS parts (idx INTEGER PRIMARY KEY, data BLOB NOT NULL);`);
    });
  }

  current() {
    return this.sql.exec("SELECT id,received FROM progress").toArray()[0];
  }

  bytesReceived() {
    return this.current()?.received || 0;
  }

  async append(id, expires, offset, bytes) {
    if (Date.now() >= expires) return { expired:true };
    // Set the expiry before storing the first bytes, so a partial upload can
    // be removed even if the browser disconnects after the first request.
    if (!this.current()) await this.ctx.storage.setAlarm(expires + 60_000);
    return this.ctx.storage.transactionSync(() => {
      const progress = this.current();
      const received = progress?.received || 0;
      if (offset !== received) return { received };
      for (let i = 0; i < bytes.byteLength; i += PART) {
        const part = bytes.slice(i, i + PART);
        this.sql.exec("INSERT INTO parts VALUES(?,?)", (offset + i) / PART, part);
      }
      this.sql.exec("INSERT INTO progress VALUES(?,?) ON CONFLICT(id) DO UPDATE SET received=excluded.received",
        id, received + bytes.byteLength);
      return { received:received + bytes.byteLength };
    });
  }

  fetch(request) {
    const query = new URL(request.url).searchParams;
    const start = Number(query.get("start"));
    const end = Number(query.get("end"));
    return new Response(streamAudio(this.ctx, start, end,
      index => this.sql.exec("SELECT data FROM parts WHERE idx=?", index).toArray()[0]?.data));
  }

  async erase() {
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const item = this.current();
    if (!item) return;
    const registry = this.env.LARP.getByName("larp-player");
    const response = await registry.fetch(`https://larp.internal/media-retained/${item.id}`);
    if (!response.ok) throw new Error("No se pudo consultar el archivo registrado.");
    if (!(await response.json()).retained) await this.erase();
  }
}
