// Shared by the news pages. USCIS publishes in Eastern time, so dates are shown in Eastern time too (the stored value is an exact instant).
export const OFFICIAL_ALL_NEWS_URL = "https://www.uscis.gov/newsroom/all-news";

const dateFormat = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });

export function formatNewsDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? dateFormat.format(date) : "";
}

// An ISO string for <time dateTime>; "" when there is no usable date.
export function isoDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

export const CATEGORY_FILTERS = [
  { value: "", label: "All" },
  { value: "news-release", label: "News Releases" },
  { value: "alert", label: "Alerts" },
];
