// バックエンド API のレスポンス型。

export type LatLng = { lat: number; lng: number };

export type Emotion = {
  valence: number;
  arousal: number;
  route_theme: string;
  places_tags: string[];
  archetype: string;
  source: string;
};

export type Spot = {
  name: string;
  lat: number;
  lng: number;
  rating: number;
  user_ratings_total: number;
  place_id: string;
  tags: string[];
  source_tag: string;
};

export type RouteLeg = {
  kind: "shortest" | "detour";
  duration_sec: number;
  duration_min: number;
  distance_m: number;
  path: LatLng[];
};

export type SafetyInfo = {
  is_night: boolean;
  bad_weather: boolean;
  max_extra_minutes: number;
  max_extra_distance_m: number;
};

export type RouteResponse = {
  emotion: Emotion;
  intensity: Intensity;
  target_extra_minutes: number;
  safety: SafetyInfo;
  spots: Spot[];
  shortest: RouteLeg;
  detour: RouteLeg;
  extra_minutes: number;
  extra_distance_m: number;
  route_source: "google" | "fallback";
};

export type ResultResponse = {
  message: string;
  message_source: string;
  extra_minutes: number;
  emotion: Emotion;
};

export type Intensity = "light" | "medium" | "deep";

export type RouteRequest = {
  text: string;
  preset?: string | null;
  intensity: Intensity;
  origin: LatLng;
  destination: LatLng;
  is_night?: boolean | null;
  bad_weather?: boolean;
};
