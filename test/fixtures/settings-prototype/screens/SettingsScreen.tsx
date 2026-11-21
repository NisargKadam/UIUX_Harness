import { Stack, Tabs, Text } from "@ds";
import { navigate } from "../router";
import { NotificationsTab } from "../parts/NotificationsTab";
import { ProfileTab } from "../parts/ProfileTab";

export type SettingsTab = "profile" | "notifications";

export const SETTINGS_TABS: SettingsTab[] = ["profile", "notifications"];

export function SettingsScreen({ tab }: { tab: SettingsTab }) {
  return (
    <Stack gap={6} padding={7} className="page">
      <Stack gap={1}>
        <Text variant="title" as="h1">
          Settings
        </Text>
        <Text tone="muted">Manage your profile and how Acme keeps you in the loop.</Text>
      </Stack>
      <Tabs
        ariaLabel="Settings sections"
        items={[
          { id: "profile", label: "Profile" },
          { id: "notifications", label: "Notifications" },
        ]}
        selectedId={tab}
        onChange={(id) => navigate(`/settings/${id}`)}
      >
        {tab === "profile" ? <ProfileTab /> : <NotificationsTab />}
      </Tabs>
    </Stack>
  );
}
