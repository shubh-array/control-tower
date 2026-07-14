function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function hasFileExtension(pathname: string): boolean {
  const basename = pathname.split("/").pop() ?? "";
  return /\.[^/]+$/.test(basename);
}

const REMOVED_CLIENT_PATHS = new Set(["/propose"]);

export function shouldServeSpaFallback(pathname: string): boolean {
  if (isApiPath(pathname)) {
    return false;
  }

  if (hasFileExtension(pathname)) {
    return false;
  }

  if (REMOVED_CLIENT_PATHS.has(pathname)) {
    return false;
  }

  return true;
}
