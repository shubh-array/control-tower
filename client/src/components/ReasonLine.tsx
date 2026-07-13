import { SafeText } from "./SafeText.js";

interface ReasonLineProps {
  text: string;
}

export function ReasonLine({ text }: ReasonLineProps) {
  return (
    <p className="reason-line">
      <SafeText text={text} />
    </p>
  );
}
