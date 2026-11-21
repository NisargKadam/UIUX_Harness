import "./prototype.css";
import { Redirect, Router } from "./router";
import { SETTINGS_TABS, SettingsScreen, type SettingsTab } from "./screens/SettingsScreen";

export function App() {
  return (
    <Router
      routes={[
        { path: "/settings/profile", render: () => <SettingsScreen tab="profile" /> },
        {
          path: "/settings/:tab",
          render: ({ tab }) =>
            SETTINGS_TABS.includes(tab as SettingsTab) ? <SettingsScreen tab={tab as SettingsTab} /> : <Redirect to="/settings/profile" />,
        },
      ]}
    />
  );
}
