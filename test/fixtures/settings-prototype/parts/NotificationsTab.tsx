import { useState } from "react";
import { Card, Stack, Switch, Text } from "@ds";
import { notificationSettings, type NotificationSetting } from "../mock/data";

export function NotificationsTab() {
  const [settings, setSettings] = useState<NotificationSetting[]>(notificationSettings);
  const toggle = (id: string) => (enabled: boolean) => setSettings((all) => all.map((s) => (s.id === id ? { ...s, enabled } : s)));
  const group = (channel: NotificationSetting["channel"]) => settings.filter((s) => s.channel === channel);
  const enabledCount = settings.filter((s) => s.enabled).length;

  return (
    <Stack gap={5}>
      <Text tone="muted">
        Changes apply straight away. {enabledCount} of {settings.length} notifications are on.
      </Text>
      <Card title="Email" description="Sent to your work address">
        <Stack gap={4}>
          {group("email").map((s) => (
            <Switch key={s.id} label={s.label} description={s.description} checked={s.enabled} onChange={toggle(s.id)} />
          ))}
        </Stack>
      </Card>
      <Card title="Push" description="On the Acme mobile app">
        <Stack gap={4}>
          {group("push").map((s) => (
            <Switch key={s.id} label={s.label} description={s.description} checked={s.enabled} onChange={toggle(s.id)} />
          ))}
        </Stack>
      </Card>
    </Stack>
  );
}
