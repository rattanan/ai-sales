"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  translateWorkspaceText,
  WORKSPACE_LOCALE_COOKIE,
  type WorkspaceLocale,
} from "@/lib/workspace-i18n";

type WorkspaceLocaleContextValue = {
  locale: WorkspaceLocale;
  setLocale: (locale: WorkspaceLocale) => void;
  t: (text: string) => string;
};

const WorkspaceLocaleContext = createContext<WorkspaceLocaleContextValue>({
  locale: "en",
  setLocale: () => undefined,
  t: (text) => text,
});

export function WorkspaceLocaleProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale: WorkspaceLocale;
}) {
  const [locale, setLocaleState] = useState(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((nextLocale: WorkspaceLocale) => {
    setLocaleState(nextLocale);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${WORKSPACE_LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }, []);

  const t = useCallback(
    (text: string) => translateWorkspaceText(text, locale),
    [locale],
  );
  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return (
    <WorkspaceLocaleContext.Provider value={value}>
      {children}
    </WorkspaceLocaleContext.Provider>
  );
}

export function useWorkspaceLocale() {
  return useContext(WorkspaceLocaleContext);
}
