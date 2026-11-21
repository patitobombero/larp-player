export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  tastes TEXT NOT NULL DEFAULT '[]',
  avatar TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'system'
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id),
  used_by TEXT REFERENCES users(id),
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_owner ON invites(owner, expires);
CREATE TABLE IF NOT EXISTS friendships (
  a TEXT NOT NULL REFERENCES users(id),
  b TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY(a,b)
);
CREATE INDEX IF NOT EXISTS friends_b ON friendships(b);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS files_owner ON files(owner, kind, created);
CREATE TABLE IF NOT EXISTS file_parts (
  file TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY(file, part)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  sender TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  sticker TEXT NOT NULL,
  file TEXT REFERENCES files(id),
  created INTEGER NOT NULL,
  FOREIGN KEY(a,b) REFERENCES friendships(a,b)
);
CREATE INDEX IF NOT EXISTS conversation ON messages(a,b,id);
CREATE INDEX IF NOT EXISTS message_file ON messages(file);
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  cover TEXT NOT NULL,
  tracks TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS playlists_owner ON playlists(owner,created);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner,updated);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  cover TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_created ON posts(created);
CREATE TABLE IF NOT EXISTS post_files (
  post TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  file TEXT NOT NULL REFERENCES files(id),
  position INTEGER NOT NULL,
  PRIMARY KEY(post,file)
);
CREATE INDEX IF NOT EXISTS published_file ON post_files(file);
CREATE TABLE IF NOT EXISTS ratings (
  post TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  PRIMARY KEY(post,user_id)
);
CREATE TABLE IF NOT EXISTS post_rating_activity (
  post TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author TEXT NOT NULL REFERENCES users(id),
  created INTEGER NOT NULL,
  PRIMARY KEY(post,author)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  post TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS post_comments ON comments(post,id);

CREATE TABLE IF NOT EXISTS user_preferences (
  owner TEXT NOT NULL REFERENCES users(id),
  section TEXT NOT NULL,
  settings TEXT NOT NULL,
  PRIMARY KEY(owner,section)
);
CREATE TABLE IF NOT EXISTS media_uploads (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  destination TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS media_uploads_owner ON media_uploads(owner,expires);
CREATE TABLE IF NOT EXISTS media_files (
  id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS dj_tracks (
  owner TEXT NOT NULL REFERENCES users(id),
  id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  settings TEXT NOT NULL,
  PRIMARY KEY(owner,id)
);
CREATE TABLE IF NOT EXISTS media_cleanup (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  size INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS removed_friendships (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  PRIMARY KEY(a,b),
  FOREIGN KEY(a,b) REFERENCES friendships(a,b)
);
CREATE TABLE IF NOT EXISTS chat_reads (
  owner TEXT NOT NULL REFERENCES users(id),
  peer TEXT NOT NULL REFERENCES users(id),
  last_id INTEGER NOT NULL,
  PRIMARY KEY(owner,peer)
);
CREATE TABLE IF NOT EXISTS comment_positions (
  comment INTEGER PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
  file TEXT NOT NULL REFERENCES files(id),
  seconds REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_codes (
  owner TEXT PRIMARY KEY REFERENCES users(id),
  digest TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS library_tags (
  file TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL
);
`;
