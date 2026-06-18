import { Route, Switch, Link, Router, useLocation } from "wouter";
import { useEffect } from "preact/hooks";
import { LayoutDashboard, Bot, KeyRound, Settings, Menu, X } from "lucide-react";
import { signal } from "@preact/signals";
import { ToastHost } from "./components/ToastHost";
import { ProvidersRoute } from "./routes/providers";

const sidebarOpen = signal(false);

const NAV: { path: string; label: string; icon: typeof Bot; match: (p: string) => boolean }[] = [
  { path: "/", label: "Overview", icon: LayoutDashboard, match: (p) => p === "/" },
  { path: "/bots", label: "Bots", icon: Bot, match: (p) => p.startsWith("/bots") },
  { path: "/providers", label: "LLM Providers", icon: KeyRound, match: (p) => p.startsWith("/providers") },
  { path: "/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/settings") },
];

export function App() {
  return (
    <Router>
      <AppInner />
    </Router>
  );
}

function AppInner() {
  const [location] = useLocation();

  // Close the mobile drawer on navigation.
  useEffect(() => {
    sidebarOpen.value = false;
  }, [location]);

  return (
    <div class="app-shell">
      <Sidebar location={location} />
      <main class="main">
        <Topbar location={location} />
        <div class="content">
          <Switch>
            <Route path="/">
              <Placeholder title="Overview" subtitle="Bot status cards + live token feed, todo" />
            </Route>
            <Route path="/bots">
              <Placeholder title="Bots" subtitle="Bot CRUD + character/behavior editors, todo." />
            </Route>
            <Route path="/providers">{() => <ProvidersRoute />}</Route>
            <Route path="/settings">
              <Placeholder title="Settings" subtitle="Global settings + log retention, soon:tm:" />
            </Route>
            <Route>
              <Placeholder title="Not found" subtitle="That route doesn't exist yet." />
            </Route>
          </Switch>
        </div>
      </main>
      {sidebarOpen.value && <div class="scrim" onClick={() => (sidebarOpen.value = false)} />}
      <ToastHost />
    </div>
  );
}

function Sidebar({ location }: { location: string }) {
  return (
    <aside class={`sidebar ${sidebarOpen.value ? "open" : ""}`}>
      <div class="brand">
        <span class="brand-mark">◈</span>
        <span class="brand-name">Nyxal</span>
      </div>
      <nav class="nav">
        {NAV.map(({ path, label, icon: Icon, match }) => (
          <Link key={path} href={path}>
            <button class={`nav-item ${match(location) ? "active" : ""}`}>
              <Icon size={18} />
              <span>{label}</span>
            </button>
          </Link>
        ))}
      </nav>
      <div class="sidebar-footer">
        <span class="phase-badge">V0.0.1</span>
      </div>
    </aside>
  );
}

function Topbar({ location }: { location: string }) {
  const current = NAV.find((n) => n.match(location));
  return (
    <header class="topbar">
      <button class="icon-btn mobile-only" onClick={() => (sidebarOpen.value = !sidebarOpen.value)}>
        {sidebarOpen.value ? <X size={20} /> : <Menu size={20} />}
      </button>
      <h1 class="topbar-title">{current?.label ?? "Nyxal"}</h1>
    </header>
  );
}

function Placeholder({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <section class="card placeholder">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </section>
  );
}
