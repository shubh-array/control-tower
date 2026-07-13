import { SafeText } from "./SafeText.js";
import { isSafeUrl } from "../lib/sanitize.js";

interface PrLinkProps {
  url: string;
  text: string;
  className?: string;
}

/** Renders the repo#PR identity as a link to GitHub when a safe URL is known, plain text otherwise. */
export function PrLink({ url, text, className }: PrLinkProps) {
  if (!url || !isSafeUrl(url) || !url.startsWith("https://")) {
    return <SafeText text={text} className={className} />;
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
      <SafeText text={text} />
    </a>
  );
}
