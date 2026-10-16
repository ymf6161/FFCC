import { ulid } from "ulid";

/** Text ULID ids everywhere (portability rule). */
export const newId = (): string => ulid();
