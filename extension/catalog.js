export const DATA_CATEGORIES = [
  { id: "identity", label: "Identity & contact details", hint: "Name, email, account details" },
  { id: "browser_location", label: "Browser location", hint: "Location requested from this browser" },
  { id: "approximate_location", label: "Approximate location", hint: "Area inferred from your IP address" },
  { id: "identifiers", label: "Device & cookie identifiers", hint: "Browser, device, and session identifiers" },
  { id: "activity", label: "Activity & searches", hint: "Pages, searches, clicks, and study activity" },
  { id: "content", label: "Text & uploaded files", hint: "Messages, notes, documents, and typed places" },
  { id: "media", label: "Audio & video", hint: "Microphone, camera, and uploaded recordings" },
  { id: "payment", label: "Payment information", hint: "Billing details when you make a purchase" }
];

export const PURPOSES = [
  { id: "analytics", label: "Analytics", hint: "Measuring how a service is used" },
  { id: "advertising", label: "Advertising & profiling", hint: "Personalizing or measuring ads" },
  { id: "training", label: "AI model training", hint: "Using content to improve models" },
  { id: "sharing", label: "Third-party sharing", hint: "Disclosing information to other organizations" }
];

export const SERVICES = [
  {
    id: "maps", name: "Google Maps", short: "Maps", topic: "Location",
    homeUrl: "https://www.google.com/maps",
    aliases: ["google maps", "googlemaps", "maps"],
    sources: [
      { id: "google-privacy", title: "Google Privacy Policy", url: "https://policies.google.com/privacy?hl=en-US" },
      { id: "google-location", title: "How Google uses location information", url: "https://policies.google.com/technologies/location-data" }
    ],
    actions: [
      { id: "block-location", kind: "browser", label: "Block browser location", detail: "Applies to all https://www.google.com pages, not just Maps. It stays active until restored. Typed places and IP-based location are not hidden.", url: null },
      { id: "maps-directions", kind: "guide", label: "Use a typed starting point", detail: "Opens Google's directions guide. Anything you type into Maps still reaches Google.", url: "https://support.google.com/maps/answer/144339" }
    ]
  },
  {
    id: "quizlet", name: "Quizlet", short: "Quizlet", topic: "Tracking",
    homeUrl: "https://quizlet.com/",
    aliases: ["quizlet"],
    sources: [
      { id: "quizlet-privacy", title: "Quizlet Privacy Policy", url: "https://quizlet.com/privacy" }
    ],
    actions: [
      { id: "quizlet-cookies", kind: "guide", label: "Review ads & cookie settings", detail: "Opens Quizlet's privacy page. Where available, review optional analytics and advertising choices. Essential processing remains; a change here is not automatically verified.", url: "https://quizlet.com/privacy#your_choice_personal_information_title" }
    ]
  },
  {
    id: "chatgpt", name: "ChatGPT", short: "ChatGPT", topic: "Data use",
    homeUrl: "https://chatgpt.com/",
    aliases: ["chatgpt", "chat gpt", "openai"],
    sources: [
      { id: "openai-privacy", title: "OpenAI US Privacy Policy", url: "https://openai.com/policies/privacy-policy/" },
      { id: "openai-controls", title: "ChatGPT Data Controls FAQ", url: "https://help.openai.com/en/articles/7730893-data-controls-faq" }
    ],
    actions: [
      { id: "chatgpt-training", kind: "guide", label: "Review model-training choices", detail: "Opens OpenAI's Data Controls guide. Turning off model training does not prevent submitted content reaching ChatGPT.", url: "https://help.openai.com/en/articles/7730893-data-controls-faq" },
      { id: "chatgpt-temporary", kind: "guide", label: "Review Temporary Chat", detail: "Opens OpenAI's guide. Temporary Chat changes history, training, and retention behavior; it is not zero collection.", url: "https://help.openai.com/en/articles/8914046-temporary-chat-faq" }
    ]
  }
];

export const getService = (id) => SERVICES.find((service) => service.id === id) ?? null;
export const emptyPreferences = () => ({ allowedData: [], allowedPurposes: [] });
