import { useState } from "react";
import { Alert, Avatar, Button, Card, Select, Stack, Text, TextField } from "@ds";
import { currentUser, roles, timeZones, type Profile } from "../mock/data";

type Errors = Partial<Record<keyof Profile, string>>;

function validate(p: Profile): Errors {
  const errors: Errors = {};
  if (p.fullName.trim() === "") errors.fullName = "Enter your name so teammates can find you.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) errors.email = "Enter an email address like name@company.com.";
  return errors;
}

export function ProfileTab() {
  const [profile, setProfile] = useState<Profile>(currentUser);
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoNote, setPhotoNote] = useState(false);

  const update = (field: keyof Profile) => (value: string) => {
    setProfile((p) => ({ ...p, [field]: value }));
    setSaved(false);
  };

  const save = () => {
    const found = validate(profile);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
    }, 600);
  };

  return (
    <Stack gap={5}>
      {saved && (
        <Alert tone="success" title="Changes saved" onDismiss={() => setSaved(false)}>
          Your profile is up to date.
        </Alert>
      )}
      <Card
        title="Profile"
        description="How others see you across Acme"
        footer={
          <>
            <Button variant="ghost" onClick={() => setProfile(currentUser)}>
              Cancel
            </Button>
            <Button variant="tertiary" loading={saving} onClick={save}>
              Save changes
            </Button>
          </>
        }
      >
        <Stack gap={5}>
          <Stack direction="row" gap={4} align="center">
            <Avatar name={profile.fullName || "?"} size="lg" />
            <Stack gap={1}>
              <Text variant="heading">{profile.fullName || "Your name"}</Text>
              <Button variant="secondary" size="sm" onClick={() => setPhotoNote(true)}>
                Change photo
              </Button>
              {photoNote && <Text variant="caption" tone="muted">Photo upload isn't part of this prototype.</Text>}
            </Stack>
          </Stack>
          <Stack direction="row" gap={4} wrap>
            <div className="field-half">
              <TextField label="Full name" value={profile.fullName} onChange={update("fullName")} required error={errors.fullName} autoComplete="name" />
            </div>
            <div className="field-half">
              <TextField label="Email" type="email" value={profile.email} onChange={update("email")} required error={errors.email} autoComplete="email" />
            </div>
          </Stack>
          <Stack direction="row" gap={4} wrap>
            <div className="field-half">
              <Select label="Role" value={profile.role} onChange={update("role")} options={roles} />
            </div>
            <div className="field-half">
              <Select label="Time zone" value={profile.timeZone} onChange={update("timeZone")} options={timeZones} helperText="Used for notification timing" />
            </div>
          </Stack>
          <TextField label="Bio" multiline rows={4} value={profile.bio} onChange={update("bio")} helperText="A sentence or two about what you work on." />
        </Stack>
      </Card>
    </Stack>
  );
}
