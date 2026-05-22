// Read VITE_API_URL in production, fallback to relative path (dev proxy) in development
export const API_BASE = (import.meta.env.VITE_API_URL as string) || '';
