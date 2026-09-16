import type { Session } from "./session";
export function activateTab(session: Session, id: string): Session {
  if (!session.tabs.includes(id)) return session;
  return {
    ...session,
    active: id,
    recentTabs: [id, ...session.recentTabs.filter((t) => t !== id)].slice(
      0,
      100,
    ),
  };
}
export function closeTab(session: Session, id = session.active): Session {
  if (!session.tabs.includes(id)) return session;
  const tabs = session.tabs.filter((t) => t !== id);
  const recentTabs = session.recentTabs.filter((t) => t !== id);
  const viewports = { ...session.viewports };
  delete viewports[id];
  return {
    ...session,
    tabs,
    viewports,
    recentTabs,
    closedTabs: [id, ...session.closedTabs.filter((t) => t !== id)].slice(
      0,
      20,
    ),
    active:
      session.active === id
        ? (recentTabs.find((t) => tabs.includes(t)) ?? tabs[0] ?? "")
        : session.active,
  };
}
export function restoreTab(session: Session, validIds: string[]): Session {
  const id = session.closedTabs.find(
    (t) => validIds.includes(t) && !session.tabs.includes(t),
  );
  if (!id) return session;
  return activateTab(
    {
      ...session,
      tabs: [...session.tabs, id],
      closedTabs: session.closedTabs.filter((t) => t !== id),
    },
    id,
  );
}
export function moveTab(session: Session, direction: -1 | 1): Session {
  const index = session.tabs.indexOf(session.active),
    next = index + direction;
  if (index < 0 || next < 0 || next >= session.tabs.length) return session;
  const tabs = [...session.tabs];
  [tabs[index], tabs[next]] = [tabs[next], tabs[index]];
  return { ...session, tabs };
}
export function cycleTab(session: Session, direction: -1 | 1): Session {
  const order = [
    ...new Set([
      ...session.recentTabs.filter((t) => session.tabs.includes(t)),
      ...session.tabs,
    ]),
  ];
  if (!order.length) return session;
  // Do not reorder MRU during a keyboard cycle, otherwise successive presses oscillate.
  return {
    ...session,
    active:
      order[
        (order.indexOf(session.active) + direction + order.length) %
          order.length
      ],
  };
}
