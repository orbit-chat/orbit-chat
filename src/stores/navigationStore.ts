import { create } from "zustand";

export type SettingsSection = "profile" | "privacy" | "notifications" | "keybinds" | "updates" | "about";

/**
 * The one answer to "what is on screen". Every page — settings included — is a
 * route, so navigating anywhere replaces whatever was showing. The old UI kept
 * `mainView` and `navTab` as separate flags, which is why settings stayed open
 * on top of whatever nav item you clicked.
 */
export type Route =
  | { page: "home" }
  | { page: "dm"; conversationId: string | null }
  | { page: "groups"; conversationId: string | null }
  | { page: "friends" }
  | { page: "archive"; conversationId: string | null }
  | { page: "settings"; section: SettingsSection };

export type Page = Route["page"];

const HISTORY_LIMIT = 50;

type NavigationState = {
  route: Route;
  /** Routes before the current one, oldest first. */
  past: Route[];
  /** Routes undone by `back()`, next first. */
  future: Route[];
  /** Last conversation open on each conversation page, restored when you return to that tab. */
  lastConversationByPage: Partial<Record<"dm" | "groups" | "archive", string>>;

  /** Go to an exact route. No-op if it is already the current one. */
  navigate: (route: Route) => void;
  /** Switch tab; conversation pages reopen the conversation you last had open there. */
  goToPage: (page: Page) => void;
  /** Open a conversation on the page matching its type. */
  openConversation: (conversation: { id: string; type: "dm" | "group" }, options?: { archived?: boolean }) => void;
  openSettings: (section?: SettingsSection) => void;
  /** Leave settings for the last non-settings route, or Home. */
  closeSettings: () => void;
  back: () => void;
  forward: () => void;
  /** Drop a deleted/left conversation from the current route, history and tab memory. */
  forgetConversation: (conversationId: string) => void;
  /** Reset to Home with empty history (sign-out, account switch). */
  reset: () => void;
};

export function routesEqual(a: Route, b: Route): boolean {
  if (a.page !== b.page) return false;
  if ("conversationId" in a && "conversationId" in b) return a.conversationId === b.conversationId;
  if (a.page === "settings" && b.page === "settings") return a.section === b.section;
  return true;
}

export function routeConversationId(route: Route): string | null {
  return "conversationId" in route ? route.conversationId : null;
}

function rememberConversation(state: NavigationState, route: Route): NavigationState["lastConversationByPage"] {
  if ((route.page === "dm" || route.page === "groups" || route.page === "archive") && route.conversationId) {
    return { ...state.lastConversationByPage, [route.page]: route.conversationId };
  }
  return state.lastConversationByPage;
}

function routeForPage(page: Page, state: NavigationState): Route {
  switch (page) {
    case "dm":
    case "groups":
    case "archive":
      return { page, conversationId: state.lastConversationByPage[page] ?? null };
    case "settings":
      return { page, section: "profile" };
    default:
      return { page };
  }
}

const initialRoute: Route = { page: "home" };

export const useNavigationStore = create<NavigationState>((set, get) => ({
  route: initialRoute,
  past: [],
  future: [],
  lastConversationByPage: {},

  navigate: (route) => {
    const state = get();
    if (routesEqual(state.route, route)) return;
    set({
      route,
      past: [...state.past, state.route].slice(-HISTORY_LIMIT),
      future: [],
      lastConversationByPage: rememberConversation(state, route)
    });
  },

  goToPage: (page) => {
    get().navigate(routeForPage(page, get()));
  },

  openConversation: (conversation, options) => {
    const page = options?.archived ? "archive" : conversation.type === "dm" ? "dm" : "groups";
    get().navigate({ page, conversationId: conversation.id });
  },

  openSettings: (section = "profile") => {
    get().navigate({ page: "settings", section });
  },

  closeSettings: () => {
    const state = get();
    if (state.route.page !== "settings") return;
    const previous = [...state.past].reverse().find((route) => route.page !== "settings");
    state.navigate(previous ?? initialRoute);
  },

  back: () => {
    const state = get();
    const previous = state.past[state.past.length - 1];
    if (!previous) return;
    set({
      route: previous,
      past: state.past.slice(0, -1),
      future: [state.route, ...state.future].slice(0, HISTORY_LIMIT),
      lastConversationByPage: rememberConversation(state, previous)
    });
  },

  forward: () => {
    const state = get();
    const next = state.future[0];
    if (!next) return;
    set({
      route: next,
      past: [...state.past, state.route].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
      lastConversationByPage: rememberConversation(state, next)
    });
  },

  forgetConversation: (conversationId) => {
    const state = get();
    const keep = (route: Route) => routeConversationId(route) !== conversationId;
    const clear = (route: Route): Route =>
      keep(route) ? route : { ...(route as Extract<Route, { conversationId: string | null }>), conversationId: null };

    const lastConversationByPage = { ...state.lastConversationByPage };
    for (const key of Object.keys(lastConversationByPage) as Array<keyof typeof lastConversationByPage>) {
      if (lastConversationByPage[key] === conversationId) delete lastConversationByPage[key];
    }

    set({
      route: clear(state.route),
      past: state.past.filter(keep),
      future: state.future.filter(keep),
      lastConversationByPage
    });
  },

  reset: () => set({ route: initialRoute, past: [], future: [], lastConversationByPage: {} })
}));
