"use client";

import Image from "next/image";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, ImageUp, MessageCircle, Sparkles } from "lucide-react";
import { saveBotAppearanceAction } from "@/features/knowledge/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useWorkspaceLocale } from "@/components/layout/workspace-locale";
import {
  StandardBotIcon,
  standardBotIconChoices,
} from "@/components/knowledge/standard-bot-icon";
import { standardBotIconId, type StandardBotIconId } from "@/lib/bot-icons";

type AppearanceValue = {
  id: string;
  name: string;
  welcomeMessage: string;
  placeholder: string;
  avatarUrl: string | null;
  launcherIcon: string | null;
  primaryColor: string;
  headerColor: string;
  chatBubbleColor: string;
  fontFamily: "system" | "sans" | "serif" | "mono";
  colorMode: "LIGHT" | "DARK" | "AUTO";
  widgetSize: "COMPACT" | "STANDARD" | "LARGE";
  launcherSize: number;
  windowPosition: "LEFT" | "RIGHT";
  brandingEnabled: boolean;
};

type AppearanceState =
  | {
      ok: true;
      data: {
        avatarUrl: string | null;
        launcherIcon: string | null;
        version: number;
      };
    }
  | { ok: false; error: { message: string } }
  | null;

const presets = [
  {
    name: "Indigo",
    primary: "#4f46e5",
    header: "#312e81",
    bubble: "#eef2ff",
  },
  {
    name: "Ocean",
    primary: "#0369a1",
    header: "#0c4a6e",
    bubble: "#e0f2fe",
  },
  {
    name: "Emerald",
    primary: "#047857",
    header: "#064e3b",
    bubble: "#d1fae5",
  },
  {
    name: "Rose",
    primary: "#be123c",
    header: "#881337",
    bubble: "#ffe4e6",
  },
] as const;

const dimensions = {
  COMPACT: { width: 320, height: 480 },
  STANDARD: { width: 390, height: 650 },
  LARGE: { width: 460, height: 720 },
} as const;

const fontStacks = {
  system: "system-ui, sans-serif",
  sans: "Arial, sans-serif",
  serif: "Georgia, serif",
  mono: "ui-monospace, monospace",
} as const;

function readableTextColor(color: string) {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114 > 160
    ? "#172033"
    : "#ffffff";
}

function imagePreview(file: File | undefined, update: (value: string) => void) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    if (typeof reader.result === "string") update(reader.result);
  });
  reader.readAsDataURL(file);
}

export function BotAppearanceForm({ bot }: { bot: AppearanceValue }) {
  const router = useRouter();
  const { locale, t } = useWorkspaceLocale();
  const [state, action, pending] = useActionState<AppearanceState, FormData>(
    saveBotAppearanceAction,
    null,
  );
  const [primaryColor, setPrimaryColor] = useState(bot.primaryColor);
  const [headerColor, setHeaderColor] = useState(bot.headerColor);
  const [chatBubbleColor, setChatBubbleColor] = useState(bot.chatBubbleColor);
  const [fontFamily, setFontFamily] = useState(bot.fontFamily);
  const [colorMode, setColorMode] = useState(bot.colorMode);
  const [widgetSize, setWidgetSize] = useState(bot.widgetSize);
  const [launcherSize, setLauncherSize] = useState(bot.launcherSize);
  const [windowPosition, setWindowPosition] = useState(bot.windowPosition);
  const [brandingEnabled, setBrandingEnabled] = useState(bot.brandingEnabled);
  const initialAvatarIcon = standardBotIconId(bot.avatarUrl);
  const initialLauncherIcon = standardBotIconId(bot.launcherIcon);
  const [avatarPreview, setAvatarPreview] = useState(
    initialAvatarIcon ? null : bot.avatarUrl,
  );
  const [launcherPreview, setLauncherPreview] = useState(
    initialLauncherIcon ? null : bot.launcherIcon,
  );
  const [avatarStandardIcon, setAvatarStandardIcon] = useState<
    StandardBotIconId | undefined
  >(initialAvatarIcon);
  const [launcherStandardIcon, setLauncherStandardIcon] = useState<
    StandardBotIconId | undefined
  >(initialLauncherIcon);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [removeLauncherIcon, setRemoveLauncherIcon] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const launcherFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [router, state]);

  const dark = colorMode === "DARK";
  const selectedPreset = presets.find(
    (preset) =>
      preset.primary === primaryColor &&
      preset.header === headerColor &&
      preset.bubble === chatBubbleColor,
  )?.name;
  const size = dimensions[widgetSize];

  return (
    <form
      action={action}
      className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]"
    >
      <input type="hidden" name="botId" value={bot.id} />
      <input
        type="hidden"
        name="avatarStandardIcon"
        value={avatarStandardIcon ?? ""}
      />
      <input
        type="hidden"
        name="launcherStandardIcon"
        value={launcherStandardIcon ?? ""}
      />
      <div className="space-y-6">
        <fieldset className="space-y-4 rounded-2xl border p-4 sm:p-5">
          <legend className="px-2 text-base font-semibold">
            {t("Theme & colors")}
          </legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {presets.map((preset) => (
              <button
                key={preset.name}
                type="button"
                aria-pressed={selectedPreset === preset.name}
                onClick={() => {
                  setPrimaryColor(preset.primary);
                  setHeaderColor(preset.header);
                  setChatBubbleColor(preset.bubble);
                }}
                className="min-h-20 cursor-pointer rounded-xl border p-3 text-left text-sm font-medium transition hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 aria-pressed:border-indigo-500 aria-pressed:ring-2 aria-pressed:ring-indigo-100"
              >
                <span className="mb-2 flex gap-1" aria-hidden="true">
                  {[preset.primary, preset.header, preset.bubble].map(
                    (color) => (
                      <span
                        key={color}
                        className="size-5 rounded-full border border-black/10"
                        style={{ backgroundColor: color }}
                      />
                    ),
                  )}
                </span>
                {preset.name}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["primaryColor", "Primary color", primaryColor, setPrimaryColor],
              ["headerColor", "Header color", headerColor, setHeaderColor],
              [
                "chatBubbleColor",
                "Bot bubble color",
                chatBubbleColor,
                setChatBubbleColor,
              ],
            ].map(([name, label, value, setValue]) => (
              <Field
                key={name as string}
                label={label as string}
                htmlFor={`appearance-${name}`}
              >
                <div className="flex items-center gap-2 rounded-lg border bg-card p-1.5">
                  <input
                    id={`appearance-${name}`}
                    name={name as string}
                    type="color"
                    value={value as string}
                    onChange={(event) =>
                      (setValue as (value: string) => void)(event.target.value)
                    }
                    className="size-10 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
                  />
                  <output className="font-mono text-xs uppercase">
                    {value as string}
                  </output>
                </div>
              </Field>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Theme mode" htmlFor="appearance-color-mode">
              <Select
                id="appearance-color-mode"
                name="colorMode"
                value={colorMode}
                onChange={(event) =>
                  setColorMode(
                    event.target.value as AppearanceValue["colorMode"],
                  )
                }
              >
                <option value="LIGHT">{t("Light")}</option>
                <option value="DARK">{t("Dark")}</option>
                <option value="AUTO">{t("Follow device")}</option>
              </Select>
            </Field>
            <Field label="Font" htmlFor="appearance-font">
              <Select
                id="appearance-font"
                name="fontFamily"
                value={fontFamily}
                onChange={(event) =>
                  setFontFamily(
                    event.target.value as AppearanceValue["fontFamily"],
                  )
                }
              >
                <option value="system">{t("System")}</option>
                <option value="sans">{t("Sans")}</option>
                <option value="serif">{t("Serif")}</option>
                <option value="mono">{t("Mono")}</option>
              </Select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border p-4 sm:p-5">
          <legend className="px-2 text-base font-semibold">
            {t("Size & position")}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Widget size" htmlFor="appearance-widget-size">
              <Select
                id="appearance-widget-size"
                name="widgetSize"
                value={widgetSize}
                onChange={(event) =>
                  setWidgetSize(
                    event.target.value as AppearanceValue["widgetSize"],
                  )
                }
              >
                <option value="COMPACT">{t("Compact")} · 320 × 480</option>
                <option value="STANDARD">{t("Standard")} · 390 × 650</option>
                <option value="LARGE">{t("Large")} · 460 × 720</option>
              </Select>
            </Field>
            <Field label="Window position" htmlFor="appearance-position">
              <Select
                id="appearance-position"
                name="windowPosition"
                value={windowPosition}
                onChange={(event) =>
                  setWindowPosition(
                    event.target.value as AppearanceValue["windowPosition"],
                  )
                }
              >
                <option value="RIGHT">{t("Bottom right")}</option>
                <option value="LEFT">{t("Bottom left")}</option>
              </Select>
            </Field>
          </div>
          <Field
            label="Launcher icon size"
            htmlFor="appearance-launcher-size"
            hint="Choose a size between 40 and 80 pixels."
          >
            <div className="flex items-center gap-4">
              <input
                id="appearance-launcher-size"
                name="launcherSize"
                type="range"
                min="40"
                max="80"
                value={launcherSize}
                onChange={(event) =>
                  setLauncherSize(Number(event.target.value))
                }
                className="min-h-11 flex-1 accent-indigo-600"
              />
              <output className="w-16 rounded-lg border bg-muted px-2 py-2 text-center text-sm font-semibold">
                {launcherSize}px
              </output>
            </div>
          </Field>
        </fieldset>

        <fieldset className="space-y-5 rounded-2xl border p-4 sm:p-5">
          <legend className="px-2 text-base font-semibold">
            {t("Bot images")}
          </legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Bot profile image"
              htmlFor="appearance-avatar"
              hint="PNG, JPEG, or WebP. Maximum 2 MB."
            >
              <div className="space-y-3">
                <div className="flex size-20 items-center justify-center overflow-hidden rounded-2xl border bg-muted">
                  {avatarStandardIcon ? (
                    <StandardBotIcon
                      id={avatarStandardIcon}
                      className="size-9 text-indigo-700"
                    />
                  ) : avatarPreview ? (
                    <Image
                      src={avatarPreview}
                      alt="Bot profile preview"
                      width={80}
                      height={80}
                      className="size-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <Bot
                      size={30}
                      className="text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {t("Choose a standard icon")}
                  </p>
                  <div
                    className="grid grid-cols-6 gap-2"
                    aria-label={t("Standard profile icons")}
                  >
                    {standardBotIconChoices.map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        aria-label={t(label)}
                        aria-pressed={avatarStandardIcon === id}
                        title={t(label)}
                        onClick={() => {
                          setAvatarStandardIcon(id);
                          setAvatarPreview(null);
                          setRemoveAvatar(false);
                          if (avatarFileRef.current)
                            avatarFileRef.current.value = "";
                        }}
                        className="grid min-h-11 place-items-center rounded-xl border bg-card text-muted-foreground transition hover:border-indigo-300 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 aria-pressed:border-indigo-500 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-700"
                      >
                        <StandardBotIcon id={id} className="size-5" />
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  ref={avatarFileRef}
                  id="appearance-avatar"
                  name="avatarFile"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) =>
                    imagePreview(event.target.files?.[0], (value) => {
                      setAvatarStandardIcon(undefined);
                      setAvatarPreview(value);
                      setRemoveAvatar(false);
                    })
                  }
                  className="file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-indigo-700"
                />
                {bot.avatarUrl ? (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      name="removeAvatar"
                      type="checkbox"
                      checked={removeAvatar}
                      onChange={(event) => {
                        setRemoveAvatar(event.target.checked);
                        setAvatarStandardIcon(
                          event.target.checked ? undefined : initialAvatarIcon,
                        );
                        setAvatarPreview(
                          event.target.checked || initialAvatarIcon
                            ? null
                            : bot.avatarUrl,
                        );
                        if (event.target.checked && avatarFileRef.current)
                          avatarFileRef.current.value = "";
                      }}
                    />
                    {t("Remove current profile image")}
                  </label>
                ) : null}
              </div>
            </Field>
            <Field
              label="Launcher icon"
              htmlFor="appearance-launcher-icon"
              hint="Square PNG, JPEG, or WebP works best. Maximum 2 MB."
            >
              <div className="space-y-3">
                <div
                  className="grid place-items-center overflow-hidden rounded-full text-white shadow-lg"
                  style={{
                    width: launcherSize,
                    height: launcherSize,
                    backgroundColor: primaryColor,
                  }}
                >
                  {launcherStandardIcon ? (
                    <StandardBotIcon
                      id={launcherStandardIcon}
                      width={Math.round(launcherSize * 0.42)}
                      height={Math.round(launcherSize * 0.42)}
                    />
                  ) : launcherPreview ? (
                    <Image
                      src={launcherPreview}
                      alt="Launcher icon preview"
                      width={launcherSize}
                      height={launcherSize}
                      className="size-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <Sparkles
                      size={Math.round(launcherSize * 0.42)}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {t("Choose a standard icon")}
                  </p>
                  <div
                    className="grid grid-cols-6 gap-2"
                    aria-label={t("Standard launcher icons")}
                  >
                    {standardBotIconChoices.map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        aria-label={t(label)}
                        aria-pressed={launcherStandardIcon === id}
                        title={t(label)}
                        onClick={() => {
                          setLauncherStandardIcon(id);
                          setLauncherPreview(null);
                          setRemoveLauncherIcon(false);
                          if (launcherFileRef.current)
                            launcherFileRef.current.value = "";
                        }}
                        className="grid min-h-11 place-items-center rounded-xl border bg-card text-muted-foreground transition hover:border-indigo-300 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 aria-pressed:border-indigo-500 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-700"
                      >
                        <StandardBotIcon id={id} className="size-5" />
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  ref={launcherFileRef}
                  id="appearance-launcher-icon"
                  name="launcherIconFile"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) =>
                    imagePreview(event.target.files?.[0], (value) => {
                      setLauncherStandardIcon(undefined);
                      setLauncherPreview(value);
                      setRemoveLauncherIcon(false);
                    })
                  }
                  className="file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-indigo-700"
                />
                {bot.launcherIcon ? (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      name="removeLauncherIcon"
                      type="checkbox"
                      checked={removeLauncherIcon}
                      onChange={(event) => {
                        setRemoveLauncherIcon(event.target.checked);
                        setLauncherStandardIcon(
                          event.target.checked
                            ? undefined
                            : initialLauncherIcon,
                        );
                        setLauncherPreview(
                          event.target.checked || initialLauncherIcon
                            ? null
                            : bot.launcherIcon,
                        );
                        if (event.target.checked && launcherFileRef.current)
                          launcherFileRef.current.value = "";
                      }}
                    />
                    {t("Remove current launcher icon")}
                  </label>
                ) : null}
              </div>
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-2 rounded-xl border p-3 text-sm">
            <input
              name="brandingEnabled"
              type="checkbox"
              checked={brandingEnabled}
              onChange={(event) => setBrandingEnabled(event.target.checked)}
            />
            {t("Show “Powered by InsightKM” branding")}
          </label>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending}>
            <ImageUp size={17} aria-hidden="true" />
            {t(pending ? "Saving appearance…" : "Save appearance")}
          </Button>
          <p
            aria-live="polite"
            className={
              state?.ok
                ? "text-sm text-emerald-700"
                : "text-sm text-destructive"
            }
          >
            {state?.ok
              ? locale === "th"
                ? `บันทึกรูปลักษณ์เป็นเวอร์ชัน ${state.data.version} แล้ว`
                : `Appearance saved as version ${state.data.version}.`
              : state?.error.message}
          </p>
        </div>
      </div>

      <aside className="self-start xl:sticky xl:top-24">
        <div className="rounded-2xl border bg-slate-100 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">{t("Live preview")}</h2>
              <p className="text-xs text-muted-foreground">
                {size.width} × {size.height}px · {launcherSize}px icon
              </p>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium">
              {colorMode === "AUTO" ? t("Device") : t(colorMode.toLowerCase())}
            </span>
          </div>
          <div className="flex max-h-[650px] justify-center overflow-auto rounded-xl bg-white/70 p-3">
            <div
              className="flex origin-top flex-col overflow-hidden rounded-2xl border shadow-xl"
              style={{
                width: `min(${size.width}px, 100%)`,
                height: Math.min(size.height, 560),
                backgroundColor: dark ? "#111827" : "#ffffff",
                color: dark ? "#f8fafc" : "#172033",
                fontFamily: fontStacks[fontFamily],
              }}
            >
              <header
                className="flex items-center gap-3 p-4"
                style={{
                  backgroundColor: headerColor,
                  color: readableTextColor(headerColor),
                }}
              >
                <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/15">
                  {avatarStandardIcon ? (
                    <StandardBotIcon
                      id={avatarStandardIcon}
                      className="size-5"
                    />
                  ) : avatarPreview ? (
                    <Image
                      src={avatarPreview}
                      alt=""
                      width={40}
                      height={40}
                      className="size-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <Bot size={20} aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{bot.name}</p>
                  {brandingEnabled ? (
                    <p className="text-[11px] opacity-75">
                      Powered by InsightKM
                    </p>
                  ) : null}
                </div>
              </header>
              <div className="flex-1 space-y-3 overflow-hidden p-4">
                <div
                  className="max-w-[88%] rounded-2xl rounded-bl-md p-3 text-sm"
                  style={{
                    backgroundColor: chatBubbleColor,
                    color: readableTextColor(chatBubbleColor),
                  }}
                >
                  {bot.welcomeMessage}
                </div>
                <div
                  className="ml-auto max-w-[78%] rounded-2xl rounded-br-md p-3 text-sm"
                  style={{
                    backgroundColor: primaryColor,
                    color: readableTextColor(primaryColor),
                  }}
                >
                  ช่วยค้นหาข้อมูลให้หน่อย
                </div>
              </div>
              <div className="flex items-center gap-2 border-t p-3">
                <div className="min-h-10 flex-1 rounded-xl border px-3 py-2 text-xs text-muted-foreground">
                  {bot.placeholder}
                </div>
                <div
                  className="grid size-10 place-items-center rounded-xl"
                  style={{
                    backgroundColor: primaryColor,
                    color: readableTextColor(primaryColor),
                  }}
                >
                  <MessageCircle size={17} aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
          <div
            className={`mt-4 flex ${windowPosition === "LEFT" ? "justify-start" : "justify-end"}`}
          >
            <div
              className="grid place-items-center overflow-hidden rounded-full text-white shadow-lg"
              style={{
                width: launcherSize,
                height: launcherSize,
                backgroundColor: primaryColor,
              }}
            >
              {launcherStandardIcon ? (
                <StandardBotIcon
                  id={launcherStandardIcon}
                  width={Math.round(launcherSize * 0.42)}
                  height={Math.round(launcherSize * 0.42)}
                />
              ) : launcherPreview ? (
                <Image
                  src={launcherPreview}
                  alt=""
                  width={launcherSize}
                  height={launcherSize}
                  className="size-full object-cover"
                  unoptimized
                />
              ) : (
                <Sparkles
                  size={Math.round(launcherSize * 0.42)}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        </div>
      </aside>
    </form>
  );
}
