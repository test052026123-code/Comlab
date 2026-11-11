import { z } from 'zod';

// Legacy reports used Firestore auto IDs. Report-and-close uses the session UUID.
export const issueIdSchema = z.union([z.string().regex(/^[a-zA-Z0-9]{20}$/), z.uuid()]);
