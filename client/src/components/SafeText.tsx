interface SafeTextProps {
  text: string;
  className?: string;
  as?: "span" | "p" | "div";
}

export function SafeText({ text, className, as: Tag = "span" }: SafeTextProps) {
  return <Tag className={className}>{text}</Tag>;
}
