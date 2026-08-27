/**
 * The two chat screens are app views rather than documents: they lock their own
 * height and scroll their transcript internally, so the shell's measured centre
 * column and page footer only cost them window. Every other page reads better
 * in that column, which is why the exception is listed by route — `saved`,
 * `conversations`, and `new` are ordinary list pages that happen to share the
 * `/workspace/chat` segment with a bot conversation.
 */
const CHAT_LIST_PAGES = new Set(["saved", "conversations", "new"]);

export function isChatSurface(pathname: string) {
  if (pathname === "/workspace/chat") return true;
  const child = /^\/workspace\/chat\/([^/]+)\/?$/.exec(pathname);
  return child ? !CHAT_LIST_PAGES.has(child[1]) : false;
}

export const WORKSPACE_SIDEBAR_COOKIE = "insightkm-sidebar";

/** The cookie records the exception: absent or unknown means expanded. */
export function isSidebarCollapsed(value: string | undefined) {
  return value === "collapsed";
}
