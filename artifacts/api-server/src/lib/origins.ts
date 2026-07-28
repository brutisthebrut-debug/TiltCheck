const normalizeOrigin = (value: string): string => value.trim().replace(/\/$/, "");

export function getAllowedOrigins(): Set<string> {
  const configured = [
    process.env.APP_ORIGIN,
    ...(process.env.CORS_ALLOWED_ORIGINS ?? "").split(","),
  ]
    .filter((origin): origin is string => Boolean(origin?.trim()))
    .map(normalizeOrigin);

  if (process.env.NODE_ENV !== "production") {
    configured.push("http://localhost:5173", "http://127.0.0.1:5173");
  }

  return new Set(configured);
}

export function isAllowedAppUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      getAllowedOrigins().has(normalizeOrigin(url.origin))
    );
  } catch {
    return false;
  }
}
