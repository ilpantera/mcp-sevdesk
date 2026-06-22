import createClient from "openapi-fetch";
import type { paths } from "./generated/sevdesk-api.js";

export const SEVDESK_API_BASE_URL = "https://my.sevdesk.de/api/v1";

type SevdeskClientMetadata = {
  baseUrl: string;
  defaultHeaders: Record<string, string>;
};

export function createSevdeskClient(apiToken: string) {
  const defaultHeaders = {
    Authorization: apiToken,
    Accept: "application/json",
  };

  return Object.assign(createClient<paths>({
    baseUrl: SEVDESK_API_BASE_URL,
    headers: {
      ...defaultHeaders,
    },
  }), {
    baseUrl: SEVDESK_API_BASE_URL,
    defaultHeaders,
  });
}

export type SevdeskClient = ReturnType<typeof createClient<paths>> & SevdeskClientMetadata;
