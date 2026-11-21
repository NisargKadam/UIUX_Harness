export interface Profile {
  fullName: string;
  email: string;
  role: string;
  timeZone: string;
  bio: string;
}

export interface Option {
  value: string;
  label: string;
}

export interface NotificationSetting {
  id: string;
  label: string;
  description: string;
  channel: "email" | "push";
  enabled: boolean;
}

export const currentUser: Profile = {
  fullName: "Ada Lovelace",
  email: "ada.lovelace@acme.example",
  role: "designer",
  timeZone: "Europe/London",
  bio: "Product designer on the Payments team. I care about clear forms and calm error states.",
};

export const roles: Option[] = [
  { value: "designer", label: "Product designer" },
  { value: "researcher", label: "UX researcher" },
  { value: "engineer", label: "Frontend engineer" },
  { value: "pm", label: "Product manager" },
];

export const timeZones: Option[] = [
  { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  { value: "America/New_York", label: "Eastern Time (New York)" },
  { value: "Europe/London", label: "UK Time (London)" },
  { value: "Europe/Berlin", label: "Central European Time (Berlin)" },
  { value: "Asia/Kolkata", label: "India Standard Time (Mumbai)" },
  { value: "Asia/Tokyo", label: "Japan Time (Tokyo)" },
];

export const notificationSettings: NotificationSetting[] = [
  { id: "mentions", label: "Mentions and replies", description: "When someone @mentions you or replies to your comment", channel: "email", enabled: true },
  { id: "digest", label: "Weekly digest", description: "A Monday summary of activity in your projects", channel: "email", enabled: true },
  { id: "product", label: "Product updates", description: "New features and improvements, about once a month", channel: "email", enabled: false },
  { id: "push-mentions", label: "Mentions", description: "Instant alerts on your phone when you're mentioned", channel: "push", enabled: true },
  { id: "push-reviews", label: "Review requests", description: "When a teammate asks you to review a design", channel: "push", enabled: false },
];
