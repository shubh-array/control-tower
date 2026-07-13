function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function hasFileExtension(pathname: string): boolean {
  const basename = pathname.split("/").pop() ?? "";
  return /\.[^/]+$/.test(basename);
}

export function shouldServeSpaFallback(pathname: string): boolean {
  if (isApiPath(pathname)) {
    return false;
  }

  if (hasFileExtension(pathname)) {
    return false;
  }

  return true;
}
