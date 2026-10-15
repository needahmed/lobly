export function getBridge() {
    try {
        const g = globalThis;
        // Electron (and any single-window host): preload sets window.lobly
        // directly on the same window the UI runs in.
        if (g.lobly)
            return g.lobly;
        // Overwolf: background window sets window.lobly on itself; the desktop
        // window is a separate JS realm and must reach across via getMainWindow().
        const ow = g.overwolf;
        if (ow?.windows?.getMainWindow) {
            const main = ow.windows.getMainWindow();
            if (main?.lobly)
                return main.lobly;
        }
    }
    catch {
        /* ignore */
    }
    return null;
}
