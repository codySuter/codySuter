import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/crimson-pro";
import "@fontsource-variable/cinzel";
import "@fontsource-variable/jetbrains-mono";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./styles/global.css";
import App from "./App";
import { ConnectScreen } from "./components/onboarding/ConnectScreen";
import { DataProvider, createDemoClient, createRealClient, type LoreClient } from "./lib/data";

declare global {
  interface Window {
    loreforge?: {
      isElectron: boolean;
      platform: string;
      onMenu: (cb: (msg: { action: string; payload?: string }) => void) => () => void;
    };
  }
}

const root = ReactDOM.createRoot(document.getElementById("root")!);

function renderApp(client: LoreClient) {
  root.render(
    <React.StrictMode>
      <DataProvider client={client}>
        <App />
      </DataProvider>
    </React.StrictMode>,
  );
}

function renderConnect(error?: string) {
  root.render(
    <React.StrictMode>
      <ConnectScreen
        error={error}
        onConnect={(url) => {
          localStorage.setItem("loreforge-convex-url", url);
          localStorage.removeItem("loreforge-demo");
          boot();
        }}
        onDemo={() => {
          localStorage.setItem("loreforge-demo", "1");
          boot();
        }}
      />
    </React.StrictMode>,
  );
}

async function boot() {
  const params = new URLSearchParams(window.location.search);
  const demoRequested = params.get("demo") === "1" || localStorage.getItem("loreforge-demo") === "1";
  const url =
    (import.meta.env.VITE_CONVEX_URL as string | undefined) ||
    localStorage.getItem("loreforge-convex-url") ||
    undefined;

  if (demoRequested) {
    try {
      renderApp(await createDemoClient());
    } catch (error) {
      console.error(error);
      renderConnect(`Demo mode failed to start: ${String(error)}`);
    }
    return;
  }
  if (url) {
    try {
      renderApp(createRealClient(url));
    } catch (error) {
      console.error(error);
      localStorage.removeItem("loreforge-convex-url");
      renderConnect(`Couldn't connect to ${url}: ${String(error)}`);
    }
    return;
  }
  renderConnect();
}

void boot();
