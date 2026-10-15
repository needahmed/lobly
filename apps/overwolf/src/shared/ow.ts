export function owCall<T>(fn: (cb: (res: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((res: any) => {
      if (res && res.success === false) reject(new Error(res.error ?? "overwolf call failed"));
      else resolve(res);
    });
  });
}

export async function obtainWindow(name: string): Promise<string> {
  const res = await owCall<any>((cb) => overwolf.windows.obtainDeclaredWindow(name, cb));
  return res.window.id;
}

export async function restoreWindow(name: string) {
  const id = await obtainWindow(name);
  await owCall((cb) => overwolf.windows.restore(id, cb));
}

/** Show a window without grabbing focus from the League client. */
export async function showWindowBehind(name: string) {
  const id = await obtainWindow(name);
  const windows = overwolf.windows as typeof overwolf.windows & {
    bringToFront?: (windowId: string, grabFocus: boolean, cb: (res: unknown) => void) => void;
  };
  if (typeof windows.bringToFront === "function") {
    await owCall((cb) => windows.bringToFront!(id, false, cb));
    return;
  }
  await owCall((cb) => overwolf.windows.restore(id, cb));
}

export async function hideWindow(name: string) {
  const id = await obtainWindow(name);
  await owCall((cb) => overwolf.windows.hide(id, cb));
}

export function isLeagueLauncherId(id: number): boolean {
  return id === 10902 || Math.floor(id / 10) === 10902;
}

export function isLeagueGameId(id: number): boolean {
  return id === 5426 || Math.floor(id / 10) === 5426;
}

/** Position notifications window bottom-right of primary monitor work area. */
export async function positionNotificationsBottomRight() {
  try {
    const monitors = await owCall<any>((cb) => overwolf.utils.getMonitorsList(cb));
    const primary =
      monitors.displays?.find((d: any) => d.is_primary) ?? monitors.displays?.[0];
    if (!primary) return;
    const work = primary.work_area ?? {
      left: primary.x ?? 0,
      top: primary.y ?? 0,
      width: primary.width,
      height: primary.height,
    };
    const winW = 360;
    const winH = 120;
    const x = Math.round(work.left + work.width - winW - 24);
    const y = Math.round(work.top + work.height - winH - 48);
    const id = await obtainWindow("notifications");
    await owCall((cb) => overwolf.windows.changePosition(id, x, y, cb));
  } catch (e) {
    console.warn("[LOBLY] positionNotificationsBottomRight failed", e);
  }
}
