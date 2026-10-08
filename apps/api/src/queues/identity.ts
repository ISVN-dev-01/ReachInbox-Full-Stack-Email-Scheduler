// BullMQ custom IDs must not contain a colon.
export const emailJobId = (id: string) => `email-${id}`;
