import createClient from "openapi-fetch";
import type { paths } from "./generated/sevdesk-api.js";

export function createSevdeskClient(apiToken: string) {
  return createClient<paths>({
    baseUrl: "https://my.sevdesk.de/api/v1",
    headers: {
      Authorization: apiToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
}

export type SevdeskClient = ReturnType<typeof createSevdeskClient>;
