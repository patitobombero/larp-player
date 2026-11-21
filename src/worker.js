import { SCHEMA } from "./schema.js";
import { MIB as MB, PART, UPLOAD_CHUNK, UPLOAD_TTL, AUDIO_LIMIT, ACCOUNT_LIMIT, COMMUNITY_LIMIT, streamAudio } from "./media.js";
import { projectSamples, publicProfileSettings, removeSample } from "./preferences.js";

export { LarpMediaV2 } from "./media.js";

const DAY = 86_400_000;
const MAX_AUDIO = 20 * MB;
const MAX_STICKER = 2 * MB;
const PROJECT_LIMIT = 130 * MB;
const LEGACY_STORAGE_LIMIT = 740 * MB;
const COOKIE = "larp_session";
const STICKERS = new Set(["🔥", "🎧", "🎵", "🙌", "💜", "🎛️", "🥁", "🚀"]);
const TASTES = new Set(["Rock","Pop","Hip-hop","Electrónica","Jazz","Salsa","Reggaetón","Clásica","Metal","Indie","Lo-fi","Cumbia","R&B","Folk"]);
const AUDIO_TYPES = {
  mp3:"audio/mpeg", wav:"audio/wav", flac:"audio/flac", ogg:"audio/ogg", oga:"audio/ogg", opus:"audio/ogg",
  m4a:"audio/mp4", aac:"audio/aac", wma:"audio/x-ms-wma", aiff:"audio/aiff", aif:"audio/aiff",
  ape:"audio/x-ape", alac:"audio/mp4", amr:"audio/amr", mid:"audio/midi", midi:"audio/midi",
  mka:"audio/x-matroska", weba:"audio/webm", webm:"audio/webm", mp2:"audio/mpeg", ac3:"audio/ac3",
  dts:"audio/vnd.dts", wv:"audio/wavpack", caf:"audio/x-caf", au:"audio/basic", dsf:"audio/dsf", dff:"audio/dff"
};
const IMAGE_TYPES = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif" };
const STICKER_TYPES = {...IMAGE_TYPES,mp4:"video/mp4",webm:"video/webm"};
const profileFields = "id, handle, name, bio, tastes, avatar, theme";
const FILE_FIELDS = "id, name, mime, size, created";
const encoder = new TextEncoder();

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => { throw new RequestError(status, message); };
const json = (body, status = 200, extra = {}) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra }
});
const uid = () => crypto.randomUUID();
const validId = id => typeof id === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id);
const hex = bytes => [...bytes].map(n => n.toString(16).padStart(2, "0")).join("");
const secret = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const hash = async value => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));

function equal(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function passwordHash(password, salt = secret()) {
  let material = encoder.encode(password);
  // Workers caps each Web Crypto PBKDF2 call at 100,000 iterations.
  for (let round = 0; round < 6; round++) {
    const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
    material = new Uint8Array(await crypto.subtle.deriveBits({
      name:"PBKDF2", hash:"SHA-256", salt:encoder.encode(`larp:${round}:${salt}`), iterations:100_000
    }, key, 256));
  }
  return `${salt}:${hex(material)}`;
}

function cookie(request, token, age) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
}

async function readBytes(request, limit) {
  if (Number(request.headers.get("Content-Length")) > limit) fail(413, "El archivo supera el límite permitido.");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      fail(413, "El archivo supera el límite permitido.");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function body(request) {
  const bytes = await readBytes(request, MB);
  let result;
  try { result = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { fail(400, "Los datos enviados no son válidos."); }
  if (!result || typeof result !== "object" || Array.isArray(result)) fail(400, "Los datos enviados no son válidos.");
  return result;
}

function text(value, limit, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if ((required && !result) || result.length > limit) fail(400, "Revisa la longitud de los campos.");
  return result;
}

function passwordValue(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 128) fail(400, "Usa una contraseña de 10 a 128 caracteres.");
  return value;
}

function photo(value) {
  const data = text(value, 480_000);
  if (data && !/^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/]+={0,2}$/u.test(data)) fail(400, "La imagen no es válida.");
  return data;
}

function profile(row) {
  return { ...row, tastes: JSON.parse(row.tastes) };
}

function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function ascii(bytes, from, length) {
  return String.fromCharCode(...bytes.subarray(from, from + length));
}

function validSticker(bytes, mime) {
  if (mime === "video/mp4") return ascii(bytes,4,4)==="ftyp";
  if (mime === "video/webm") return [0x1a,0x45,0xdf,0xa3].every((byte,i)=>bytes[i]===byte);
  if (mime === "image/png") return [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n);
  if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/gif") return ["GIF87a","GIF89a"].includes(ascii(bytes, 0, 6));
  return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

function fileType(input, kind) {
  const name = text(typeof input === "string" ? input.replace(/[\\/\u0000-\u001f\u007f]/gu, "_") : "", 240, true);
  const extension = name.split(".").at(-1).toLowerCase();
  if (kind === "project") {
    if (!name.toLowerCase().endsWith(".larp.json")) fail(415,"Elige un proyecto .larp.json.");
    return {name,mime:"application/json"};
  }
  const types = kind === "sticker" ? STICKER_TYPES : AUDIO_TYPES;
  if (!Object.hasOwn(types, extension) || !name.includes(".")) fail(415, "El formato del archivo no es compatible.");
  return { name,mime:types[extension] };
}

async function upload(request, kind) {
  let filename;
  try { filename = decodeURIComponent(request.headers.get("X-File-Name") || ""); }
  catch { fail(400, "El nombre del archivo no es válido."); }
  const { name,mime } = fileType(filename,kind);
  const bytes = await readBytes(request, kind === "sticker" ? MAX_STICKER : MAX_AUDIO);
  if (!bytes.length || (kind === "sticker" && !validSticker(bytes, mime))) fail(400, "El archivo está vacío o dañado.");
  return { id:uid(), name, mime, bytes };
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!["GET","HEAD"].includes(request.method) &&
        (request.headers.get("Origin") !== url.origin || request.headers.get("X-Larp-Request") !== "1")) {
      return json({ error:"La solicitud debe iniciarse desde Larp Player." }, 403);
    }
    return env.LARP.getByName("larp-player").fetch(request);
  }
};

export class LarpStore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    ctx.storage.transactionSync(() => this.sql.exec(SCHEMA));
  }

  all(sql, ...args) { return this.sql.exec(sql, ...args).toArray(); }
  one(sql, ...args) { return this.all(sql, ...args)[0]; }
  run(sql, ...args) { return this.sql.exec(sql, ...args).rowsWritten; }
  transact(action) { return this.ctx.storage.transactionSync(action); }

  async session(request) {
    const token = /(?:^|;\s*)larp_session=([a-f0-9]{64})(?:;|$)/u.exec(request.headers.get("Cookie") || "")?.[1];
    if (!token) return null;
    const digest = await hash(token);
    return this.one("SELECT user_id id, token FROM sessions WHERE token=? AND expires>?", digest, Date.now()) || null;
  }

  async startSession(request, id) {
    const token = secret();
    const digest = await hash(token);
    this.run("DELETE FROM sessions WHERE expires<=?", Date.now());
    this.run("INSERT INTO sessions VALUES (?,?,?)", digest, id, Date.now() + 30 * DAY);
    return json({ profile: this.getProfile(id) }, 200, { "Set-Cookie":cookie(request, token, 30*86400) });
  }

  getProfile(id) { return profile(this.one(`SELECT ${profileFields} FROM users WHERE id=?`, id)); }

  async authorizeAttempt(request, type, handle) {
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    const key = await hash(`${type}:${ip}`);
    const accountKey = await hash(`${type}:login:${handle}`);
    this.transact(() => {
      const time = Date.now();
      this.run("DELETE FROM auth_limits WHERE expires<=?", time);
      for (const [entry, limit] of [[key,40], [accountKey,12]]) {
        const row = this.one("SELECT attempts FROM auth_limits WHERE key=?", entry);
        if (row?.attempts >= limit) fail(429, "Demasiados intentos. Prueba en 15 minutos.");
        this.run("INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1", entry, time+900_000);
      }
    });
  }

  invite(token) {
    return this.one(`SELECT i.owner,u.name FROM invites i JOIN users u ON i.owner=u.id
      WHERE i.token=? AND i.expires>? AND i.used_by IS NULL`, token, Date.now());
  }

  async auth(request, action) {
    const d = await body(request);
    const handle = text(d.handle, 24, true).toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/u.test(handle)) fail(400, "Usa de 3 a 24 letras, números o guiones bajos para tu usuario.");
    const password = passwordValue(d.password);
    await this.authorizeAttempt(request, action, handle);
    if (action === "login") {
      const user = this.one("SELECT id,password FROM users WHERE handle=?", handle);
      const derived = await passwordHash(password, user?.password.split(":")[0] || "larp-placeholder-salt");
      if (!user || !equal(derived, user.password)) fail(401, "Usuario o contraseña incorrectos.");
      return this.startSession(request, user.id);
    }
    const name = text(d.name, 40, true);
    const code = text(d.code, 128);
    const inviteHash = await hash(code);
    const setup = this.env.LARP_SETUP_CODE;
    const isSetup = typeof setup === "string" && setup.length >= 16 && equal(setup, code);
    let inviter = this.invite(inviteHash);
    if (!inviter && !(isSetup && !this.one("SELECT id FROM users LIMIT 1"))) {
      fail(403, "Necesitas una invitación válida para crear la cuenta.");
    }
    const derived = await passwordHash(password);
    const id = uid();
    this.transact(() => {
      inviter = this.invite(inviteHash);
      if (!inviter && !(isSetup && !this.one("SELECT id FROM users LIMIT 1"))) fail(403, "El código ya no está disponible.");
      if (this.one("SELECT id FROM users WHERE handle=?", handle)) fail(409, "Ese usuario ya existe.");
      this.run("INSERT INTO users(id,handle,password,name) VALUES(?,?,?,?)", id, handle, derived, name);
      if (inviter) {
        this.run("UPDATE invites SET used_by=? WHERE token=?", id, inviteHash);
        this.run("INSERT INTO friendships VALUES(?,?)", ...pair(id, inviter.owner));
      }
    });
    return this.startSession(request, id);
  }

  async recover(request) {
    const d = await body(request);
    const handle = text(d.handle,24,true).toLowerCase();
    const code = text(d.code,64,true).replace(/[ -]/gu,"").toLowerCase();
    const replacement = passwordValue(d.password);
    await this.authorizeAttempt(request,"recovery",handle);
    const digest = await hash(code);
    const row = this.one("SELECT u.id,r.digest FROM users u JOIN recovery_codes r ON r.owner=u.id WHERE u.handle=?",handle);
    if (!row || !equal(row.digest,digest)) fail(401,"El usuario o el código de recuperación no son válidos.");
    const password = await passwordHash(replacement);
    this.transact(() => {
      if (!this.run("DELETE FROM recovery_codes WHERE owner=? AND digest=?",row.id,digest)) fail(401,"El código de recuperación ya se usó.");
      this.run("UPDATE users SET password=? WHERE id=?",password,row.id);
      this.run("DELETE FROM sessions WHERE user_id=?",row.id);
    });
    return this.startSession(request,row.id);
  }

  async recoveryCode(request,user) {
    const {current} = await body(request);
    const password = passwordValue(current);
    const row = this.one("SELECT handle,password FROM users WHERE id=?",user);
    await this.authorizeAttempt(request,"recovery-code",row.handle);
    if (!equal(row.password,await passwordHash(password,row.password.split(":")[0]))) fail(401,"La contraseña actual es incorrecta.");
    const code = hex(crypto.getRandomValues(new Uint8Array(16)));
    const digest = await hash(code);
    this.transact(() => {
      if (!this.one("SELECT id FROM users WHERE id=? AND password=?",user,row.password)) fail(409,"La contraseña ya cambió.");
      this.run("INSERT INTO recovery_codes VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET digest=excluded.digest",user,digest);
    });
    return json({code:code.match(/.{4}/gu).join("-")},201);
  }

  friendship(a, b) {
    if (!this.one(`SELECT a FROM friendships f WHERE a=? AND b=? AND NOT EXISTS
      (SELECT 1 FROM removed_friendships r WHERE r.a=f.a AND r.b=f.b)`, ...pair(a,b))) fail(404, "No se encontró esta conversación.");
    return pair(a,b);
  }

  writeFile(owner, kind, file) {
    const size = file.bytes.length;
    this.quota(owner,size);
    const legacy = this.one("SELECT coalesce(sum(size),0) bytes FROM files WHERE id NOT IN(SELECT id FROM media_files)").bytes;
    if (size + legacy > LEGACY_STORAGE_LIMIT) fail(413, "Se llenó el almacenamiento de stickers y archivos antiguos.");
    this.run("INSERT INTO files VALUES(?,?,?,?,?,?,?)", file.id, owner, file.name, file.mime, size, kind, Date.now());
    for (let i = 0; i * PART < size; i++) {
      this.run("INSERT INTO file_parts VALUES(?,?,?)", file.id, i, file.bytes.slice(i * PART,(i+1)*PART).buffer);
    }
    return this.one(`SELECT ${FILE_FIELDS} FROM files WHERE id=?`, file.id);
  }

  async media(request, id, fileId) {
    const file = this.one(`SELECT f.* FROM files f WHERE f.id=? AND
      (f.owner=? OR EXISTS(SELECT 1 FROM post_files pf WHERE pf.file=f.id)
      OR EXISTS(SELECT 1 FROM messages m WHERE m.file=f.id AND (m.a=? OR m.b=?)
        AND NOT EXISTS (SELECT 1 FROM removed_friendships r WHERE r.a=m.a AND r.b=m.b)))`, fileId, id, id, id);
    if (!file || file.kind === "project" && file.owner !== id) fail(404, "Archivo no encontrado.");
    const range = request.headers.get("Range");
    let start = 0;
    let end = file.size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status:416, headers:{"Content-Range":`bytes */${file.size}`} });
      start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
      if (start > end) return new Response(null, { status:416, headers:{"Content-Range":`bytes */${file.size}`} });
    }
    const headers = {
      "Content-Type":file.mime, "Content-Length":String(end - start + 1), "Accept-Ranges":"bytes",
      "Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff",
      "Content-Disposition":`${file.kind==="project"||new URL(request.url).searchParams.has("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/gu, c => "%" + c.charCodeAt(0).toString(16))}`
    };
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
    const status = range ? 206 : 200;
    if (request.method === "HEAD") return new Response(null, { status, headers });
    if (this.one("SELECT id FROM media_files WHERE id=?",fileId)) {
      const source = await this.mediaObject(fileId).fetch(`https://larp.internal/file?start=${start}&end=${end}`);
      return new Response(source.body,{ status,headers });
    }
    const source = streamAudio(this.ctx,start,end,part =>
      this.one("SELECT data FROM file_parts WHERE file=? AND part=?", fileId,part)?.data);
    return new Response(source,{ status,headers });
  }

  quota(owner, size) {
    const sql = `SELECT coalesce(sum(size),0) bytes FROM (
      SELECT owner,size FROM files
      UNION ALL SELECT owner,size FROM media_uploads WHERE expires>?
      UNION ALL SELECT owner,size FROM media_cleanup
    )`;
    const now = Date.now();
    const own = this.one(sql + " WHERE owner=?", now, owner).bytes;
    if (own + size > ACCOUNT_LIMIT) fail(413, "Alcanzaste los 750 MiB de almacenamiento de tu cuenta.");
    if (size && this.one(sql, now).bytes + size > COMMUNITY_LIMIT) {
      fail(413, "Se llenó el almacenamiento compartido del grupo (3 GiB).");
    }
    return own;
  }

  mediaObject(id) {
    return this.env.MEDIA.getByName(id);
  }

  completedUpload(id, owner) {
    return this.one(`SELECT ${FILE_FIELDS} FROM files WHERE id=? AND owner=? AND id IN(SELECT id FROM media_files)`, id, owner);
  }

  activeUpload(id, owner) {
    return this.one("SELECT * FROM media_uploads WHERE id=? AND owner=? AND expires>?", id, owner, Date.now());
  }

  async largeUpload(request, owner, id, action) {
    const method = request.method;
    if (!id && method === "POST") {
      const d = await body(request);
      if (!validId(d.id)) fail(400, "La carga no es válida.");
      const destination = d.destination || "library";
      const projectFile=destination==="project";
      const { name,mime } = fileType(d.name, projectFile?"project":"audio");
      if (destination !== "library" && !projectFile) {
        if (!validId(destination)) fail(400, "La conversación no es válida.");
        this.friendship(owner, destination);
      }
      if (!Number.isSafeInteger(d.size) || d.size < 1 || d.size > (projectFile?PROJECT_LIMIT:AUDIO_LIMIT)) {
        fail(413, projectFile?"El proyecto no puede superar 130 MiB.":"El audio debe pesar entre 1 byte y 200 MiB.");
      }
      return this.transact(() => {
        const existing = this.completedUpload(d.id, owner);
        if (existing) {
          if(existing.name!==name||existing.size!==d.size||existing.mime!==mime)fail(409,"Este identificador pertenece a otro archivo.");
          return json({ id:d.id,file:existing });
        }
        const active = this.activeUpload(d.id, owner);
        if (active) {
          if (active.name !== name || active.size !== d.size || active.destination !== destination) {
            fail(409, "Este identificador pertenece a otro archivo.");
          }
          return json({ id:d.id,expires:active.expires });
        }
        if (this.one("SELECT id FROM files WHERE id=?", d.id) ||
            this.one("SELECT id FROM media_cleanup WHERE id=?", d.id) ||
            this.one("SELECT id FROM media_uploads WHERE id=?", d.id)) {
          fail(410, "Esta carga caducó. Selecciona el archivo de nuevo.");
        }
        this.quota(owner, d.size);
        if (this.one("SELECT count(*) count FROM media_uploads WHERE owner=? AND expires>?", owner,Date.now()).count >= 20) {
          fail(429, "Termina o cancela tus cargas pendientes antes de iniciar otra.");
        }
        const expires = Date.now() + UPLOAD_TTL;
        this.run("INSERT INTO media_uploads VALUES(?,?,?,?,?,?,?)", d.id,owner,name,mime,d.size,destination,expires);
        return json({ id:d.id,expires }, 201);
      });
    }
    if (!id && method === "GET") {
      return json(this.all("SELECT id,name,size,expires,destination FROM media_uploads WHERE owner=? AND expires>? ORDER BY expires", owner,Date.now()));
    }
    if (!validId(id)) fail(404, "No se encontró la carga.");
    const existing = this.completedUpload(id, owner);
    if (existing && ["GET","POST"].includes(method)) return json({ id,file:existing });
    const pending = this.activeUpload(id, owner);
    if (!pending && method === "DELETE") return json({ ok:true });
    if (!pending) fail(410, "Esta carga caducó. Selecciona el archivo de nuevo.");
    const object = this.mediaObject(id);
    if (method === "GET") return json({ id,received:await object.bytesReceived(),expires:pending.expires });
    if (method === "PUT" && action === "part") {
      const offsetHeader = request.headers.get("X-Larp-Offset");
      const offset = /^\d+$/u.test(offsetHeader || "") ? Number(offsetHeader) : -1;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset % UPLOAD_CHUNK || offset >= pending.size) {
        fail(400, "La posición de la carga no es válida.");
      }
      const expected = Math.min(UPLOAD_CHUNK,pending.size-offset);
      const bytes = await readBytes(request,expected);
      if (bytes.length !== expected) fail(400, "La parte del archivo está incompleta.");
      if (!this.activeUpload(id, owner)) fail(410, "Esta carga ya no está activa.");
      const written = await object.append(id,pending.expires,offset,bytes.buffer);
      if (written.expired) fail(410, "Esta carga caducó.");
      if (written.received < offset + expected) fail(409, "Reanuda la carga desde la última parte guardada.");
      return json(written);
    }
    if (method === "POST" && action === "complete") {
      if (await object.bytesReceived() !== pending.size) fail(409, "Todavía faltan partes del archivo.");
      return this.transact(() => {
        const completed = this.completedUpload(id, owner);
        if (completed) return json({ id,file:completed });
        if (!this.activeUpload(id, owner)) fail(410, "Esta carga ya no está activa.");
        const kind = pending.destination === "library" ? "library" : pending.destination === "project" ? "project" : "audio";
        const now = Date.now();
        this.run("INSERT INTO files VALUES(?,?,?,?,?,?,?)", id,owner,pending.name,pending.mime,pending.size,kind,now);
        this.run("INSERT INTO media_files VALUES(?)", id);
        this.run("DELETE FROM media_uploads WHERE id=?", id);
        if (kind === "audio") {
          this.run("INSERT INTO messages(a,b,sender,body,sticker,file,created) VALUES(?,?,?,?,?,?,?)",
            ...this.friendship(owner,pending.destination),owner,"","",id,now);
        }
        return json({ id,file:this.completedUpload(id, owner) }, 201);
      });
    }
    if (method === "DELETE") {
      this.transact(() => {
        this.run("INSERT OR IGNORE INTO media_cleanup VALUES(?,?,?)", id,owner,pending.size);
        this.run("DELETE FROM media_uploads WHERE id=?", id);
      });
      await this.scheduleCleanup();
      return json({ ok:true });
    }
    fail(404, "Ruta no encontrada.");
  }

  async scheduleCleanup() {
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  async alarm() {
    const rows = this.all("SELECT id FROM media_cleanup LIMIT 10");
    await Promise.allSettled(rows.map(async ({ id }) => {
      await this.mediaObject(id).erase();
      this.run("DELETE FROM media_cleanup WHERE id=?", id);
    }));
    if (this.one("SELECT id FROM media_cleanup LIMIT 1")) await this.ctx.storage.setAlarm(Date.now()+60_000);
  }

  async preferences(request, owner, section) {
    if (request.method === "GET") {
      const rows = this.all("SELECT section,settings FROM user_preferences WHERE owner=?", owner);
      return json(Object.fromEntries(rows.map(row => [row.section,JSON.parse(row.settings)])));
    }
    if (request.method !== "PUT" || !["appearance","audio","ddj","profile-card","notices"].includes(section)) fail(404, "Ruta no encontrada.");
    const data = await body(request);
    let value=data;
    if(section==="profile-card") {
      value=publicProfileSettings(data);
      for(const network of ["instagram","soundcloud","spotify","linkedin"]) {
        if(typeof data.links?.[network]==="string"&&data.links[network].trim()&&!value.links[network]) fail(400,"Usa un enlace HTTPS del servicio elegido.");
      }
    }
    if(section==="notices") {
      const old=this.one("SELECT settings FROM user_preferences WHERE owner=? AND section='notices'",owner);
      const saved=old?JSON.parse(old.settings):{};
      value={seen:Math.max(saved.seen||0,Math.min(Date.now(),Number(data.seen)||0)),muted:data.muted===true};
    }
    const settings = JSON.stringify(value);
    if (settings.length > 30_000) fail(413, "La configuración es demasiado grande.");
    this.run(`INSERT INTO user_preferences VALUES(?,?,?) ON CONFLICT(owner,section)
      DO UPDATE SET settings=excluded.settings`, owner,section,settings);
    return json(value);
  }

  memberProfile(target,viewer) {
    if (!validId(target)) fail(404,"Perfil no encontrado.");
    const row=this.one("SELECT id,handle,name,bio,tastes,avatar FROM users WHERE id=?",target);
    if (!row) fail(404,"Perfil no encontrado.");
    const saved=this.one("SELECT settings FROM user_preferences WHERE owner=? AND section='profile-card'",target);
    const settings=publicProfileSettings(saved?JSON.parse(saved.settings):{});
    const {country,gender,links}=settings;
    const posts=this.all("SELECT id,title FROM posts WHERE owner=? ORDER BY created DESC LIMIT 100",target);
    const playlists=this.all("SELECT id,name,json_array_length(tracks) tracks FROM playlists WHERE owner=? ORDER BY created DESC LIMIT 50",target);
    return json({profile:profile(row),settings:viewer===target?settings:{country,gender,links},
      posts:viewer===target?posts:posts.filter(post=>settings.posts.includes(post.id)),
      playlists:viewer===target?playlists:playlists.filter(list=>settings.playlists.includes(list.id))});
  }

  notices(user) {
    const saved=this.one("SELECT settings FROM user_preferences WHERE owner=? AND section='notices'",user);
    const {seen=0,muted=false}=saved?JSON.parse(saved.settings):{};
    const rows=this.all(`SELECT * FROM (
      SELECT 'message' kind,m.created,u.name author,m.sender peer,
        CASE WHEN m.file IS NOT NULL THEN coalesce(f.name,'Adjunto') WHEN m.sticker<>'' THEN m.sticker ELSE m.body END title,m.file file
      FROM messages m JOIN users u ON u.id=m.sender LEFT JOIN files f ON f.id=m.file
      WHERE (m.a=?1 OR m.b=?1) AND m.sender<>?1 AND NOT EXISTS
        (SELECT 1 FROM removed_friendships r WHERE r.a=m.a AND r.b=m.b)
      UNION ALL
      SELECT 'comment',c.created,u.name,c.author,p.title,NULL FROM comments c
      JOIN posts p ON p.id=c.post JOIN users u ON u.id=c.author WHERE p.owner=?1 AND c.author<>?1
      UNION ALL
      SELECT 'post',p.created,u.name,p.owner,p.title,NULL FROM posts p JOIN users u ON u.id=p.owner WHERE p.owner<>?1
      UNION ALL
      SELECT 'rating',a.created,u.name,a.author,p.title,NULL FROM post_rating_activity a
      JOIN ratings r ON r.post=a.post AND r.user_id=a.author JOIN posts p ON p.id=a.post
      JOIN users u ON u.id=a.author WHERE p.owner=?1 AND a.author<>?1
    ) ORDER BY created DESC LIMIT 40`,user);
    return json({rows,seen,muted,now:Date.now()});
  }

  async djTracks(request, owner, id) {
    if (request.method === "GET" && !id) {
      return json(this.all(`SELECT d.id,json_extract(d.settings,'$.grid[0].bpm') bpm,
        json_extract(d.settings,'$.key') key,json_extract(d.settings,'$.loudness') loudness
        FROM dj_tracks d JOIN files f ON f.id=d.id WHERE d.owner=? AND f.owner=d.owner AND f.kind='library'`,owner));
    }
    if (request.method === "GET" && id) {
      this.libraryIds(owner,[id],1);
      const row=this.one("SELECT settings FROM dj_tracks WHERE owner=? AND id=?",owner,id);
      return json(row ? JSON.parse(row.settings) : {});
    }
    if (request.method === "PUT") {
      const d=await body(request);
      const items=id ? [{id,settings:d}] : d.items;
      if (!Array.isArray(items) || !items.length || items.length>150) fail(400,"La colección DJ no es válida.");
      const prepared=items.map(item=>{
        if (!validId(item?.id) || !item.settings || Array.isArray(item.settings) || typeof item.settings!=="object") {
          fail(400,"Los datos de la pista no son válidos.");
        }
        const data=JSON.stringify(item.settings);
        if (data.length>25000) fail(413,"La cuadrícula de esta pista es demasiado grande.");
        return [item.id,data];
      });
      this.transact(()=>{
        this.libraryIds(owner,prepared.map(([key])=>key),150);
        for(const [key,data] of prepared) this.run(`INSERT INTO dj_tracks VALUES(?,?,?)
          ON CONFLICT(owner,id) DO UPDATE SET settings=excluded.settings`,owner,key,data);
      });
      return json({saved:prepared.length});
    }
    fail(404,"Ruta no encontrada.");
  }

  libraryIds(owner, ids, limit) {
    if (!Array.isArray(ids) || ids.length > limit || !ids.every(id => typeof id === "string" && id.length === 36)) {
      fail(400, "La selección de pistas no es válida.");
    }
    const unique = [...new Set(ids)];
    for (const id of unique) {
      if (!this.one("SELECT id FROM files WHERE id=? AND owner=? AND kind='library'", id, owner)) {
        fail(400, "Selecciona pistas de tu propia biblioteca.");
      }
    }
    return unique;
  }

  async friends(request, user, rest, url) {
    const [other, action] = rest;
    const method = request.method;
    if (!other && method === "GET") {
      return json(this.all(`SELECT u.id,u.handle,u.name,u.bio,u.avatar,u.tastes,
        (SELECT count(*) FROM messages m WHERE m.a=f.a AND m.b=f.b AND m.sender=u.id
         AND m.id>coalesce((SELECT last_id FROM chat_reads WHERE owner=? AND peer=u.id),0)) unread,
        coalesce((SELECT max(id) FROM messages m WHERE m.a=f.a AND m.b=f.b),0) latest
        FROM users u JOIN friendships f ON u.id=CASE WHEN f.a=? THEN f.b ELSE f.a END
        WHERE (f.a=? OR f.b=?) AND NOT EXISTS (SELECT 1 FROM removed_friendships r WHERE r.a=f.a AND r.b=f.b)
        ORDER BY latest DESC,u.name COLLATE NOCASE`, user,user,user,user).map(profile));
    }
    const [a,b] = this.friendship(user, other);
    if (!action && method === "DELETE") {
      this.run("INSERT OR IGNORE INTO removed_friendships VALUES(?,?)",a,b);
      return json({ok:true});
    }
    if (action === "read" && method === "PUT") {
      const {last} = await body(request);
      this.friendship(user,other);
      if (!Number.isSafeInteger(last) || !this.one("SELECT id FROM messages WHERE a=? AND b=? AND id=?",a,b,last)) fail(400,"Mensaje no válido.");
      this.run(`INSERT INTO chat_reads VALUES(?,?,?) ON CONFLICT(owner,peer)
        DO UPDATE SET last_id=max(last_id,excluded.last_id)`,user,other,last);
      return json({ok:true});
    }
    if (action === "audio" && method === "GET") {
      const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
      return json(this.all(`SELECT m.id,m.sender,m.created,f.id file,f.name,f.size FROM messages m JOIN files f ON f.id=m.file
        WHERE m.a=? AND m.b=? AND m.id<? AND f.kind='audio' ORDER BY m.id DESC LIMIT 30`,a,b,before));
    }
    if (!action && method === "GET") {
      const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
      const after = Number(url.searchParams.get("after")) || 0;
      const messages = this.all(`SELECT m.id,m.sender,m.body,m.sticker,m.created,m.file,f.name,f.mime
        FROM messages m LEFT JOIN files f ON f.id=m.file
        WHERE m.a=? AND m.b=? AND m.id>? AND m.id<? ORDER BY m.id ${after ? "ASC" : "DESC"} LIMIT 50`,
        a,b,after,before);
      return json(after ? messages : messages.reverse());
    }
    if (method === "POST" && !action) {
      const d = await body(request);
      const message = text(d.body, 2000);
      const sticker = text(d.sticker, 12);
      this.friendship(user,other);
      if ((!message && !sticker) || (sticker && !STICKERS.has(sticker))) fail(400, "Escribe un mensaje o elige un sticker.");
      this.run("INSERT INTO messages(a,b,sender,body,sticker,created) VALUES(?,?,?,?,?,?)", a,b,user,message,sticker,Date.now());
      return json({ ok:true }, 201);
    }
    if (method === "POST" && ["audio","sticker"].includes(action)) {
      const file = await upload(request, action);
      this.transact(() => {
        this.friendship(user,other);
        this.writeFile(user, action, file);
        this.run("INSERT INTO messages(a,b,sender,body,sticker,file,created) VALUES(?,?,?,?,?,?,?)", a,b,user,"","",file.id,Date.now());
      });
      return json({ ok:true }, 201);
    }
    fail(404, "Ruta no encontrada.");
  }

  async community(request, user, rest, url) {
    const [id, action, item] = rest;
    const method = request.method;
    if (!id && method === "GET") {
      const page = Math.max(0, Math.min(1_000_000, Number.parseInt(url.searchParams.get("page"), 10) || 0));
      const order = new Map([["old","p.created ASC"],["name","p.title COLLATE NOCASE"],["popular","average DESC, votes DESC"]]);
      const sort = order.get(url.searchParams.get("sort")) || "p.created DESC";
      const query = text(url.searchParams.get("q"), 80);
      const posts = this.all(`SELECT p.*,u.name author,(SELECT count(*) FROM ratings WHERE post=p.id) votes,
        (SELECT avg(stars) FROM ratings WHERE post=p.id) average,
        (SELECT stars FROM ratings WHERE post=p.id AND user_id=?) my_rating,
        (SELECT count(*) FROM comments WHERE post=p.id) comment_count
        FROM posts p JOIN users u ON p.owner=u.id WHERE instr(lower(p.title),lower(?))>0 ORDER BY ${sort},p.id LIMIT 16 OFFSET ?`,
        user, query, page*15);
      const hasMore = posts.length > 15;
      if (hasMore) posts.pop();
      for (const post of posts) {
        post.tracks = this.all("SELECT f.id,f.name,f.mime FROM post_files p JOIN files f ON p.file=f.id WHERE p.post=? ORDER BY p.position", post.id);
      }
      return json({ posts, hasMore });
    }
    if (!id && method === "POST") {
      const d = await body(request);
      const title = text(d.title, 80, true);
      const description = text(d.body, 1000);
      const cover = photo(d.cover);
      const post = uid();
      this.transact(() => {
        const tracks = this.libraryIds(user, d.tracks, 20);
        if (!tracks.length) fail(400, "Elige al menos una pista.");
        this.run("INSERT INTO posts VALUES(?,?,?,?,?,?)", post,user,title,description,cover,Date.now());
        tracks.forEach((file, index) => this.run("INSERT INTO post_files VALUES(?,?,?)", post,file,index));
      });
      return json({ id:post }, 201);
    }
    const post = this.one("SELECT owner FROM posts WHERE id=?", id);
    if (!post) fail(404, "Publicación no encontrada.");
    if (!action && method === "DELETE") {
      if (post.owner !== user) fail(403, "Solo el autor puede borrar esta publicación.");
      this.run("DELETE FROM posts WHERE id=?", id);
      return json({ ok:true });
    }
    if (action === "rating" && method === "PUT") {
      const { stars } = await body(request);
      if (!Number.isInteger(stars) || stars < 0 || stars > 5) fail(400, "Elige una calificación de 1 a 5.");
      if (!stars) this.run("DELETE FROM ratings WHERE post=? AND user_id=?", id,user);
      else this.transact(()=>{
        this.run("INSERT INTO ratings VALUES(?,?,?) ON CONFLICT(post,user_id) DO UPDATE SET stars=excluded.stars", id,user,stars);
        this.run("INSERT INTO post_rating_activity VALUES(?,?,?) ON CONFLICT(post,author) DO UPDATE SET created=excluded.created",id,user,Date.now());
      });
      return json(this.one("SELECT count(*) votes,avg(stars) average FROM ratings WHERE post=?", id));
    }
    if (action === "comments" && method === "GET") {
      const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
      return json(this.all(`SELECT c.*,u.name,t.file,t.seconds FROM comments c JOIN users u ON c.author=u.id
        LEFT JOIN comment_positions t ON t.comment=c.id
        WHERE c.post=? AND c.id<? ORDER BY c.id DESC LIMIT 30`, id,before).reverse());
    }
    if (action === "comments" && method === "POST") {
      const d = await body(request);
      const message = text(d.body, 1000, true);
      this.transact(() => {
        if (!this.one("SELECT id FROM posts WHERE id=?",id)) fail(404,"Publicación no encontrada.");
        if (d.position != null && (!validId(d.position.file) || !Number.isFinite(d.position.seconds) ||
          d.position.seconds<0 || d.position.seconds>86400 ||
          !this.one("SELECT file FROM post_files WHERE post=? AND file=?",id,d.position.file))) {
          fail(400,"El momento debe corresponder a una pista de esta publicación.");
        }
        const row=this.one("INSERT INTO comments(post,author,body,created) VALUES(?,?,?,?) RETURNING id",id,user,message,Date.now());
        if (d.position != null) this.run("INSERT INTO comment_positions VALUES(?,?,?)",
          row.id,d.position.file,Math.round(d.position.seconds*1000)/1000);
      });
      return json({ ok:true }, 201);
    }
    if (action === "comments" && item && method === "DELETE") {
      this.run("DELETE FROM comments WHERE post=? AND id=? AND author=?", id,item,user);
      return json({ ok:true });
    }
    fail(404, "Ruta no encontrada.");
  }

  async collections(request, owner, group, item) {
    const method = request.method;
    const isPlaylist = group === "playlists";
    const parse = isPlaylist ? row => ({ ...row, tracks:JSON.parse(row.tracks) }) : row => ({ ...row, state:JSON.parse(row.state) });
    const order = isPlaylist ? "created" : "updated";
    if (!item && method === "GET") return json(this.all(`SELECT * FROM ${group} WHERE owner=? ORDER BY ${order} DESC`, owner).map(parse));
    if (item && !this.one(`SELECT id FROM ${group} WHERE owner=? AND id=?`, owner,item)) fail(404, "Elemento no encontrado.");
    if (item && method === "DELETE") {
      this.run(`DELETE FROM ${group} WHERE owner=? AND id=?`, owner,item);
      return json({ ok:true });
    }
    if ((!item && method === "POST") || (item && method === "PUT")) {
      const d = await body(request);
      const name = text(d.name, 60, true);
      const id = item || uid();
      const now = Date.now();
      this.transact(() => {
        if (!item && this.one(`SELECT count(*) n FROM ${group} WHERE owner=?`, owner).n >= 50) fail(413, "Puedes guardar hasta 50 elementos de este tipo.");
        if (isPlaylist) {
          const tracks = this.libraryIds(owner, d.tracks, 400);
          const cover = photo(d.cover);
          this.run(`INSERT INTO playlists VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE
            SET name=excluded.name,cover=excluded.cover,tracks=excluded.tracks`, id,owner,name,cover,JSON.stringify(tracks),now);
        } else {
          const state = d.state;
          if (!state || typeof state !== "object" || Array.isArray(state) || JSON.stringify(state).length > 180_000) {
            fail(400, "El proyecto no es válido.");
          }
          this.libraryIds(owner, projectSamples(state), 8);
          this.run(`INSERT INTO projects VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE
            SET name=excluded.name,state=excluded.state,updated=excluded.updated`, id,owner,name,JSON.stringify(state),now);
        }
      });
      return json(parse(this.one(`SELECT * FROM ${group} WHERE id=?`, id)), item ? 200 : 201);
    }
    fail(404, "Ruta no encontrada.");
  }

  async route(request) {
    const url = new URL(request.url);
    const [group, ...rest] = url.pathname.split("/").slice(2);
    const [item, action] = rest;
    const method = request.method;
    if (group === "recover" && method === "POST") return this.recover(request);
    if (["register","login"].includes(group) && method === "POST") return this.auth(request, group);
    if (group === "invite" && method === "GET") {
      if (!/^[a-f0-9]{64}$/u.test(item || "")) fail(404, "Invitación no válida.");
      const invite = this.invite(await hash(item));
      if (!invite) fail(404, "Invitación usada o caducada.");
      return json({ name:invite.name });
    }
    const session = await this.session(request);
    if (group === "session" && method === "GET") return json({ profile:session ? this.getProfile(session.id) : null });
    if (!session) fail(401, "Entra con tu cuenta para continuar.");
    const user = session.id;
    if (group === "member-profile" && method === "GET") return this.memberProfile(item,user);
    if (group === "notices" && method === "GET") return this.notices(user);
    if (group === "uploads") return this.largeUpload(request,user,item,action);
    if (group === "preferences") return this.preferences(request,user,item);
    if (group === "dj-tracks") return this.djTracks(request,user,item);
    if (group === "storage" && method === "GET") return json({
      used:this.quota(user,0), limit:ACCOUNT_LIMIT, fileLimit:AUDIO_LIMIT, groupLimit:COMMUNITY_LIMIT
    });
    if (group === "logout" && method === "POST") {
      this.run("DELETE FROM sessions WHERE token=?", session.token);
      return json({ ok:true }, 200, { "Set-Cookie":cookie(request,"",0) });
    }
    if (group === "recovery-code" && method === "POST") return this.recoveryCode(request,user);
    if (group === "password" && method === "PUT") {
      const d = await body(request);
      const current = passwordValue(d.current);
      const replacement = passwordValue(d.replacement);
      const row = this.one("SELECT handle,password FROM users WHERE id=?", user);
      await this.authorizeAttempt(request, "change", row.handle);
      if (!equal(row.password, await passwordHash(current, row.password.split(":")[0]))) fail(401, "La contraseña actual es incorrecta.");
      const password = await passwordHash(replacement);
      this.transact(() => {
        if (!this.run("UPDATE users SET password=? WHERE id=? AND password=?", password,user,row.password)) fail(409, "La contraseña ya cambió.");
        this.run("DELETE FROM sessions WHERE user_id=? AND token<>?", user,session.token);
      });
      return json({ ok:true });
    }
    if (group === "profile" && method === "PUT") {
      const d = await body(request);
      const name = text(d.name, 40, true);
      const bio = text(d.bio, 280);
      const avatar = photo(d.avatar);
      const tastes = [...new Set(Array.isArray(d.tastes) ? d.tastes.filter(t => TASTES.has(t)) : [])];
      const theme = ["system","dark","light"].includes(d.theme) ? d.theme : "system";
      this.run("UPDATE users SET name=?,bio=?,avatar=?,tastes=?,theme=? WHERE id=?", name,bio,avatar,JSON.stringify(tastes),theme,user);
      return json({ profile:this.getProfile(user) });
    }
    if (group === "invite" && !item && method === "POST") {
      const token = secret();
      const digest = await hash(token);
      const expires = Date.now() + 7 * DAY;
      this.transact(() => {
        this.run("DELETE FROM invites WHERE expires<=?", Date.now());
        if (this.one("SELECT count(*) n FROM invites WHERE owner=? AND used_by IS NULL", user).n >= 10) fail(429, "Ya tienes diez invitaciones activas.");
        this.run("INSERT INTO invites(token,owner,expires) VALUES(?,?,?)", digest,user,expires);
      });
      return json({ token,expires }, 201);
    }
    if (group === "invite" && item && method === "PUT") {
      const digest = await hash(item);
      const inviter = this.invite(digest);
      if (!inviter) fail(404, "Invitación usada o caducada.");
      if (inviter.owner === user) fail(400, "Comparte este enlace con tu amigo.");
      this.transact(() => {
        this.run("UPDATE invites SET used_by=? WHERE token=?", user,digest);
        this.run("INSERT OR IGNORE INTO friendships VALUES(?,?)", ...pair(user,inviter.owner));
        this.run("DELETE FROM removed_friendships WHERE a=? AND b=?", ...pair(user,inviter.owner));
      });
      return json({ name:inviter.name });
    }
    if (group === "library" && !item && method === "GET") {
      return json(this.all(`SELECT f.id,f.name,f.mime,f.size,f.created,t.title,t.artist,t.album
        FROM files f LEFT JOIN library_tags t ON t.file=f.id WHERE f.owner=? AND f.kind='library' ORDER BY f.created,f.id`, user));
    }
    if(group==="project-files"&&!item&&method==="GET") {
      return json(this.all(`SELECT ${FILE_FIELDS} FROM files WHERE owner=? AND kind='project' ORDER BY created DESC,id`,user));
    }
    if(group==="project-files"&&item&&method==="DELETE") {
      this.transact(()=>{
        const file=this.one("SELECT id FROM files WHERE id=? AND owner=? AND kind='project'",item,user);
        if(!file)fail(404,"Proyecto no encontrado.");
        this.run("INSERT OR IGNORE INTO media_cleanup SELECT id,owner,size FROM files WHERE id=?",item);
        this.run("DELETE FROM media_files WHERE id=?",item);
        this.run("DELETE FROM files WHERE id=?",item);
      });
      await this.scheduleCleanup();
      return json({ok:true});
    }
    if (group === "library" && !item && method === "POST") {
      const file = await upload(request, "library");
      return json(this.transact(() => this.writeFile(user, "library", file)), 201);
    }
    if (group === "library" && item && action === "tags" && method === "PUT") {
      const d=await body(request);
      const title=text(d.title,160),artist=text(d.artist,160),album=text(d.album,160);
      this.transact(() => {
        this.libraryIds(user,[item],1);
        this.run(`INSERT INTO library_tags VALUES(?,?,?,?) ON CONFLICT(file) DO UPDATE
          SET title=excluded.title,artist=excluded.artist,album=excluded.album`,item,title,artist,album);
      });
      return json({title,artist,album});
    }
    if (group === "library" && item && method === "DELETE") {
      const cleanup = this.transact(() => {
        if (!this.one("SELECT id FROM files WHERE id=? AND owner=? AND kind='library'", item,user)) fail(404, "Archivo no encontrado.");
        if (this.one("SELECT post FROM post_files WHERE file=? LIMIT 1", item)) fail(409, "Retira las publicaciones que usan esta pista antes de borrarla.");
        for (const list of this.all("SELECT id,tracks FROM playlists WHERE owner=?", user)) {
          const tracks = JSON.parse(list.tracks);
          if (tracks.includes(item)) this.run("UPDATE playlists SET tracks=? WHERE id=?", JSON.stringify(tracks.filter(id => id !== item)),list.id);
        }
        for (const project of this.all("SELECT id,state FROM projects WHERE owner=?", user)) {
          const state = JSON.parse(project.state);
          if (projectSamples(state).includes(item)) {
            removeSample(state,item);
            this.run("UPDATE projects SET state=? WHERE id=?", JSON.stringify(state),project.id);
          }
        }
        const external = this.one("SELECT id FROM media_files WHERE id=?",item);
        if (external) {
          this.run("INSERT OR IGNORE INTO media_cleanup SELECT id,owner,size FROM files WHERE id=?",item);
          this.run("DELETE FROM media_files WHERE id=?",item);
        }
        this.run("DELETE FROM files WHERE id=?", item);
        return Boolean(external);
      });
      if (cleanup) await this.scheduleCleanup();
      return json({ ok:true });
    }
    if (group === "media" && item && ["GET","HEAD"].includes(method)) return this.media(request,user,item);
    if (group === "friends") return this.friends(request,user,rest,url);
    if (group === "community") return this.community(request,user,rest,url);
    if (group === "playlists" || group === "projects") return this.collections(request,user,group,item);
    fail(404, "Ruta no encontrada.");
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (url.origin === "https://larp.internal" && url.pathname.startsWith("/media-retained/")) {
        const id = url.pathname.split("/").at(-1);
        const retained = !!this.one("SELECT id FROM media_files WHERE id=?", id);
        if (!retained) this.run("DELETE FROM media_uploads WHERE id=? AND expires<=?", id,Date.now());
        return json({ retained });
      }
      return await this.route(request);
    } catch (error) {
      if (error instanceof RequestError) return json({ error:error.message }, error.status);
      console.error(error.stack);
      return json({ error:"El servidor no pudo completar la operación." }, 500);
    }
  }
}
