import type { ComponentType, SVGProps } from "react";
import {
  Bot,
  BookOpen,
  BrainCircuit,
  Headphones,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import type { StandardBotIconId } from "@/lib/bot-icons";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export const standardBotIconChoices: ReadonlyArray<{
  id: StandardBotIconId;
  label: string;
  Icon: IconComponent;
}> = [
  { id: "bot", label: "Robot", Icon: Bot },
  { id: "sparkles", label: "Sparkles", Icon: Sparkles },
  { id: "brain", label: "Knowledge", Icon: BrainCircuit },
  { id: "book", label: "Book", Icon: BookOpen },
  { id: "headset", label: "Support", Icon: Headphones },
  { id: "message", label: "Chat", Icon: MessageCircle },
];

export function StandardBotIcon({
  id,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { id: StandardBotIconId }) {
  const choice = standardBotIconChoices.find((item) => item.id === id);
  const Icon = choice?.Icon ?? Bot;
  return <Icon className={className} aria-hidden="true" {...props} />;
}
