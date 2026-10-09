// Helpers shared by the db:* scripts: describe which database we are about to
// touch (without printing the password) and refuse destructive work on anything
// that is not the local development database.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function describeTarget() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in."
    );
  }
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    user: decodeURIComponent(url.username),
  };
}

export function formatTarget(t) {
  return `${t.user}@${t.host}:${t.port}/${t.database}`;
}

// Throws unless DATABASE_URL clearly points at the local Docker dev database.
export function assertDevDatabase(t = describeTarget()) {
  const problems = [];
  if (process.env.NODE_ENV === "production") {
    problems.push("NODE_ENV is 'production'");
  }
  if (!LOCAL_HOSTS.has(t.host)) {
    problems.push(`host '${t.host}' is not local`);
  }
  if (!process.env.POSTGRES_DB || !process.env.POSTGRES_PORT) {
    problems.push("POSTGRES_DB / POSTGRES_PORT are not set, so the dev database cannot be identified");
  } else {
    if (t.database !== process.env.POSTGRES_DB) {
      problems.push(`database '${t.database}' is not the dev database '${process.env.POSTGRES_DB}'`);
    }
    if (t.port !== process.env.POSTGRES_PORT) {
      problems.push(`port ${t.port} is not the Docker dev port ${process.env.POSTGRES_PORT}`);
    }
  }
  if (["postgres", "template0", "template1"].includes(t.database)) {
    problems.push(`'${t.database}' is a system database`);
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to run against ${formatTarget(t)}:\n  - ${problems.join("\n  - ")}`
    );
  }
  return t;
}
